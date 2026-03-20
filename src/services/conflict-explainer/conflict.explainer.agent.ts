import {
  ConflictExplainerConfig,
  ConflictExplanation,
  ConflictSideExplanation,
  ExplainerResult,
  ExplainerStatus,
  OpenAIAdapter,
  LoggingAdapter,
  RawExplanationResponse,
  ConflictExplainerError,
  TelemetryEntry,
} from './conflict.explainer.types';
import { ConflictContext, ConflictBlock } from '../conflict-parser/conflict.parser.types';

const DEFAULT_DEPLOYMENT = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 1000;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
const DEFAULT_MAX_RETRIES = 2;

export class ConflictExplainerAgent {
  private readonly deployment: string;
  private readonly maxOutputTokens: number;
  private readonly confidenceThreshold: number;
  private readonly maxRetries: number;
  private readonly enableLogging: boolean;
  private readonly enableConsoleLogging: boolean;

  constructor(
    private readonly config: ConflictExplainerConfig = {},
    private readonly openaiAdapter: OpenAIAdapter,
    private readonly loggingAdapter?: LoggingAdapter
  ) {
    this.deployment = config.deployment ?? DEFAULT_DEPLOYMENT;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.enableLogging = config.enableLogging ?? true;
    this.enableConsoleLogging = config.enableConsoleLogging ?? true;
  }

  /**
   * Explain all conflicts in the given ConflictContext.
   *
   * HUMAN-IN-THE-LOOP CONTRACT:
   * This method generates explanations and suggests resolution strategies.
   * It NEVER applies any resolution automatically. The developer must
   * explicitly act via the VS Code UI (Accept Current / Accept Incoming / Edit).
   * The returned ConflictExplanation objects have autoResolved: false always.
   */
  async explain(context: ConflictContext): Promise<ExplainerResult> {
    if (!context || typeof context !== 'object') {
      throw new ConflictExplainerError('context must be a ConflictContext object', 'INVALID_INPUT');
    }
    if (!context.filePath || context.filePath.trim() === '') {
      throw new ConflictExplainerError('context.filePath is required', 'INVALID_INPUT');
    }
    if (context.conflictCount === 0) {
      throw new ConflictExplainerError(`No conflicts found in ${context.filePath}`, 'NO_CONFLICTS');
    }

    const startTime = Date.now();
    const explanations: ConflictExplanation[] = [];
    let successCount = 0;
    let failureCount = 0;
    let totalRetries = 0;

    for (let i = 0; i < context.conflicts.length; i++) {
      const block = context.conflicts[i];
      const contextBefore = context.contextLinesBefore[i] ?? [];
      const contextAfter = context.contextLinesAfter[i] ?? [];

      try {
        const explanation = await this._explainSingleConflict(
          i,
          block,
          context.filePath,
          contextBefore,
          contextAfter
        );
        explanations.push(explanation);
        totalRetries += explanation.retriesUsed;
        successCount++;
      } catch (err) {
        failureCount++;
        if (this.enableConsoleLogging) {
          console.error(
            `[ConflictExplainer] Failed to explain conflict #${i + 1} in ${context.filePath}:`,
            err
          );
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const status: ExplainerStatus =
      failureCount === 0 ? 'complete' : successCount > 0 ? 'partial' : 'failed';

    if (this.enableConsoleLogging) {
      console.log(
        `[ConflictExplainer] ${context.filePath}: ${successCount}/${context.conflictCount} conflicts explained in ${durationMs}ms`
      );
    }

    const result: ExplainerResult = {
      explanations,
      status,
      successCount,
      failureCount,
      durationMs,
      generatedAt: new Date().toISOString(),
    };

    // Log telemetry to Cosmos DB (non-fatal)
    if (this.enableLogging && this.loggingAdapter) {
      try {
        const entry: TelemetryEntry = {
          id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          partitionKey: context.filePath,
          type: 'conflict-explanation',
          filePath: context.filePath,
          conflictCount: context.conflictCount,
          successCount,
          failureCount,
          totalRetries,
          durationMs,
          timestamp: result.generatedAt,
        };
        await this.loggingAdapter.log(entry);
        result.telemetryId = entry.id;
      } catch (err) {
        if (this.enableConsoleLogging) {
          console.warn('[ConflictExplainer] Telemetry logging failed:', err);
        }
      }
    }

    return result;
  }

  private async _explainSingleConflict(
    conflictIndex: number,
    block: ConflictBlock,
    filePath: string,
    contextBefore: string[],
    contextAfter: string[]
  ): Promise<ConflictExplanation> {
    let retriesUsed = 0;
    let lastRaw: RawExplanationResponse | null = null;
    let lastValidationError = '';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const isRetry = attempt > 0;
      const systemPrompt = this._buildSystemPrompt();
      const userPrompt = this._buildUserPrompt(
        block,
        contextBefore,
        contextAfter,
        filePath,
        isRetry ? lastValidationError : undefined
      );

      let raw: RawExplanationResponse;
      try {
        const response = await this.openaiAdapter.complete(
          systemPrompt,
          userPrompt,
          this.maxOutputTokens
        );
        raw = this._parseResponse(response);
      } catch (err) {
        if (attempt === this.maxRetries) {
          throw new ConflictExplainerError(
            `LLM call failed after ${attempt + 1} attempts: ${(err as Error).message}`,
            'LLM_FAILED',
            err as Error
          );
        }
        retriesUsed++;
        continue;
      }

      const validation = this._reflectionValidate(raw);
      if (validation.isValid) {
        return this._buildExplanation(conflictIndex, filePath, block, raw, retriesUsed);
      }

      lastRaw = raw;
      lastValidationError = validation.reason;

      // Only count as a retry if we're going to attempt again
      if (attempt < this.maxRetries) {
        retriesUsed++;
      }

      if (this.enableConsoleLogging) {
        console.log(
          `[ConflictExplainer] Reflection failed (attempt ${attempt + 1}): ${validation.reason}. Retrying...`
        );
      }
    }

    // Retries exhausted — return best-effort result if we have something
    if (lastRaw) {
      if (this.enableConsoleLogging) {
        console.warn(
          `[ConflictExplainer] Reflection exhausted for conflict #${conflictIndex + 1}. Returning best-effort result.`
        );
      }
      return this._buildExplanation(conflictIndex, filePath, block, lastRaw, retriesUsed);
    }

    throw new ConflictExplainerError(
      `Could not generate explanation for conflict #${conflictIndex + 1} after ${this.maxRetries + 1} attempts`,
      'REFLECTION_EXHAUSTED'
    );
  }

  private _reflectionValidate(raw: RawExplanationResponse): { isValid: boolean; reason: string } {
    if (!raw.currentIntent || raw.currentIntent.trim() === '') {
      return { isValid: false, reason: 'currentIntent is missing or empty' };
    }
    if (!raw.incomingIntent || raw.incomingIntent.trim() === '') {
      return { isValid: false, reason: 'incomingIntent is missing or empty' };
    }
    if (!raw.resolutionStrategy || raw.resolutionStrategy.trim() === '') {
      return { isValid: false, reason: 'resolutionStrategy is missing or empty' };
    }
    if (typeof raw.confidenceScore !== 'number' || isNaN(raw.confidenceScore)) {
      return { isValid: false, reason: 'confidenceScore is not a valid number' };
    }
    if (raw.confidenceScore < this.confidenceThreshold) {
      return {
        isValid: false,
        reason: `confidenceScore ${raw.confidenceScore.toFixed(2)} is below threshold ${this.confidenceThreshold}`,
      };
    }
    return { isValid: true, reason: '' };
  }

  private _buildSystemPrompt(): string {
    return `You are a senior software engineer helping developers understand merge conflicts.

Your task is to analyze a git merge conflict and explain:
1. The INTENT of the current (HEAD) changes — what the developer was trying to accomplish
2. The INTENT of the incoming changes — what the other developer was trying to accomplish
3. A suggested resolution strategy in plain English

IMPORTANT RULES:
- Explain intent, NOT just what the code does line by line
- Be concise and clear — developers need to make a decision quickly
- Do NOT resolve the conflict yourself — only suggest a strategy
- Assign a confidenceScore between 0.0 and 1.0 based on how clear the intent is

Respond ONLY with a valid JSON object. No markdown, no explanation outside the JSON.
The JSON must have exactly these fields:
{
  "currentIntent": "<what the HEAD changes are trying to accomplish>",
  "currentKeyChanges": ["<key change 1>", "<key change 2>"],
  "incomingIntent": "<what the incoming changes are trying to accomplish>",
  "incomingKeyChanges": ["<key change 1>", "<key change 2>"],
  "resolutionStrategy": "<plain English strategy for resolving this conflict>",
  "confidenceScore": <number between 0.0 and 1.0>
}`;
  }

  private _buildUserPrompt(
    block: ConflictBlock,
    contextBefore: string[],
    contextAfter: string[],
    filePath: string,
    retryReason?: string
  ): string {
    const lines: string[] = [];

    lines.push(`File: ${filePath}`);
    lines.push(`Conflict location: lines ${block.startLine}–${block.endLine}`);
    lines.push('');

    if (contextBefore.length > 0) {
      lines.push('=== Context before conflict ===');
      lines.push(contextBefore.join('\n'));
      lines.push('');
    }

    lines.push('=== Current (HEAD) changes ===');
    lines.push(block.current.length > 0 ? block.current.join('\n') : '(empty — deletion)');
    lines.push('');

    if (block.base !== null) {
      lines.push('=== Common base (before both changes) ===');
      lines.push(block.base.length > 0 ? block.base.join('\n') : '(empty)');
      lines.push('');
    }

    lines.push('=== Incoming changes ===');
    lines.push(block.incoming.length > 0 ? block.incoming.join('\n') : '(empty — deletion)');

    if (contextAfter.length > 0) {
      lines.push('');
      lines.push('=== Context after conflict ===');
      lines.push(contextAfter.join('\n'));
    }

    if (block.currentLabel) {
      lines.push('');
      lines.push(`Current branch label: ${block.currentLabel}`);
    }
    if (block.incomingLabel) {
      lines.push(`Incoming branch label: ${block.incomingLabel}`);
    }

    if (retryReason) {
      lines.push('');
      lines.push(`PREVIOUS ATTEMPT WAS REJECTED: ${retryReason}`);
      lines.push('Please provide a more complete and confident explanation.');
    }

    return lines.join('\n');
  }

  _parseResponse(raw: string): RawExplanationResponse {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new ConflictExplainerError(
        `Failed to parse GPT-4o response as JSON: ${(err as Error).message}`,
        'PARSE_FAILED',
        err as Error
      );
    }

    const obj = parsed as Record<string, unknown>;
    return {
      currentIntent: String(obj.currentIntent ?? ''),
      currentKeyChanges: Array.isArray(obj.currentKeyChanges)
        ? obj.currentKeyChanges.map(String)
        : [],
      incomingIntent: String(obj.incomingIntent ?? ''),
      incomingKeyChanges: Array.isArray(obj.incomingKeyChanges)
        ? obj.incomingKeyChanges.map(String)
        : [],
      resolutionStrategy: String(obj.resolutionStrategy ?? ''),
      confidenceScore: typeof obj.confidenceScore === 'number' ? obj.confidenceScore : 0,
    };
  }

  private _buildExplanation(
    conflictIndex: number,
    filePath: string,
    block: ConflictBlock,
    raw: RawExplanationResponse,
    retriesUsed: number
  ): ConflictExplanation {
    const currentSide: ConflictSideExplanation = {
      intent: raw.currentIntent,
      keyChanges: raw.currentKeyChanges,
    };
    const incomingSide: ConflictSideExplanation = {
      intent: raw.incomingIntent,
      keyChanges: raw.incomingKeyChanges,
    };

    return {
      conflictIndex,
      filePath,
      startLine: block.startLine,
      endLine: block.endLine,
      currentSide,
      incomingSide,
      resolutionStrategy: raw.resolutionStrategy,
      confidenceScore: raw.confidenceScore,
      retriesUsed,
      autoResolved: false,
    };
  }
}
