import {
  AgentRoute,
  AGENT_ROUTES,
  ROUTE_DISPLAY_NAMES,
  ROUTE_EXAMPLE_COMMANDS,
  RoutingAgentConfig,
  RoutingRequest,
  RoutingResponse,
  ClassificationResult,
  ClassifierAdapter,
  RoutingLoggingAdapter,
  RawClassification,
  RoutingAgentError,
  RoutingTelemetryEntry,
} from './routing.agent.types';

const DEFAULT_DEPLOYMENT = 'gpt-4o';
const DEFAULT_MAX_TOKENS = 50;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5;

export class RoutingAgentService {
  private readonly deployment: string;
  private readonly maxOutputTokens: number;
  private readonly confidenceThreshold: number;
  private readonly enableLogging: boolean;
  private readonly enableConsoleLogging: boolean;

  constructor(
    private readonly config: RoutingAgentConfig = {},
    private readonly classifierAdapter: ClassifierAdapter,
    private readonly loggingAdapter?: RoutingLoggingAdapter
  ) {
    this.deployment = config.deployment ?? DEFAULT_DEPLOYMENT;
    this.maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    this.confidenceThreshold = config.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
    this.enableLogging = config.enableLogging ?? true;
    this.enableConsoleLogging = config.enableConsoleLogging ?? true;
  }

  /**
   * Classify a natural language input and return the appropriate agent route.
   * No agent internals are invoked here — the caller is responsible for
   * dispatching to the correct agent entry point.
   */
  async route(request: RoutingRequest): Promise<RoutingResponse> {
    if (!request || typeof request !== 'object') {
      throw new RoutingAgentError('request must be an object', 'INVALID_INPUT');
    }
    if (!request.input || typeof request.input !== 'string' || request.input.trim() === '') {
      throw new RoutingAgentError('request.input must be a non-empty string', 'INVALID_INPUT');
    }

    const startTime = Date.now();
    const trimmedInput = request.input.trim();

    let classification: ClassificationResult;
    try {
      classification = await this._classify(trimmedInput, request.fileContext, startTime);
    } catch (err) {
      throw new RoutingAgentError(
        `Classification failed: ${(err as Error).message}`,
        'CLASSIFICATION_FAILED',
        err as Error
      );
    }

    const displayMessage = this._buildDisplayMessage(trimmedInput, classification);

    if (this.enableConsoleLogging) {
      console.log(
        `[RoutingAgent] "${trimmedInput}" → ${classification.route} (confidence: ${classification.confidence.toFixed(2)}, ${classification.durationMs}ms)`
      );
    }

    const response: RoutingResponse = {
      classification,
      displayMessage,
      routedAt: new Date().toISOString(),
    };

    // Log telemetry to Cosmos DB (non-fatal)
    if (this.enableLogging && this.loggingAdapter) {
      try {
        const entry: RoutingTelemetryEntry = {
          id: `routing-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          partitionKey: classification.route,
          type: 'routing-decision',
          input: trimmedInput,
          route: classification.route,
          confidence: classification.confidence,
          isFallback: classification.isFallback,
          durationMs: classification.durationMs,
          timestamp: response.routedAt,
        };
        await this.loggingAdapter.log(entry);
        response.telemetryId = entry.id;
      } catch (err) {
        if (this.enableConsoleLogging) {
          console.warn('[RoutingAgent] Telemetry logging failed:', err);
        }
      }
    }

    return response;
  }

  private async _classify(
    input: string,
    fileContext: string | undefined,
    startTime: number
  ): Promise<ClassificationResult> {
    const systemPrompt = this._buildSystemPrompt();
    const userPrompt = this._buildUserPrompt(input, fileContext);

    let rawResponse: string;
    try {
      rawResponse = await this.classifierAdapter.complete(
        systemPrompt,
        userPrompt,
        this.maxOutputTokens
      );
    } catch (err) {
      throw new RoutingAgentError(
        `Classifier adapter failed: ${(err as Error).message}`,
        'CLASSIFICATION_FAILED',
        err as Error
      );
    }

    const durationMs = Date.now() - startTime;
    const raw = this._parseClassification(rawResponse);
    const route = this._resolveRoute(raw.route, raw.confidence);

    return {
      route,
      confidence: raw.confidence,
      rawLabel: raw.route,
      isFallback: route === 'unknown',
      durationMs,
    };
  }

  private _buildSystemPrompt(): string {
    return `You are a routing agent for DevMind, an AI-powered VS Code extension.

Your job is to classify a developer's natural language input into exactly one of these routes:
- version-guard: Analyzing files for deprecated APIs, version warnings, library compatibility, checking dependencies, scanning code for outdated usage. Examples: "analyze this file", "check for deprecated APIs", "scan for version warnings", "analyze current file", "check my dependencies", "any deprecated usage here"
- pr-summary: Summarizing pull requests, explaining PR changes, generating PR descriptions, reviewing what changed. Examples: "summarize PR #76", "what changed in this pull request", "generate PR summary", "explain this PR"
- conflict-explainer: Explaining git merge conflicts, understanding conflict intent, decoding what both sides are trying to do. Examples: "explain this conflict", "what does this merge conflict mean", "help me understand this conflict"
- nitpick-fixer: Running linters, fixing code style, ESLint/Prettier/formatting issues, auto-fixing style warnings. Examples: "fix nitpicks", "run linter", "fix code style", "run eslint", "run prettier"
- unknown: The input does not clearly match any of the above

When the intent is reasonably clear, prefer a specific route over unknown and use a confidence of 0.8 or higher.
Only use unknown when the input is genuinely ambiguous or unrelated to the above features.

Respond ONLY with a valid JSON object. No markdown, no explanation outside the JSON.
{
  "route": "<one of: version-guard | pr-summary | conflict-explainer | nitpick-fixer | unknown>",
  "confidence": <number between 0.0 and 1.0>
}`;
  }

  private _buildUserPrompt(input: string, fileContext?: string): string {
    const lines: string[] = [];
    lines.push(`Developer input: "${input}"`);
    if (fileContext) {
      lines.push(`Current file context: ${fileContext}`);
    }
    return lines.join('\n');
  }

  _parseClassification(raw: string): RawClassification {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new RoutingAgentError(
        `Failed to parse classification response as JSON: ${(err as Error).message}`,
        'PARSE_FAILED',
        err as Error
      );
    }

    const obj = parsed as Record<string, unknown>;
    return {
      route: typeof obj.route === 'string' ? obj.route : 'unknown',
      confidence: typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0,
    };
  }

  private _resolveRoute(rawLabel: string, confidence: number): AgentRoute {
    // Below confidence threshold — treat as unknown regardless of label
    if (confidence < this.confidenceThreshold) {
      return 'unknown';
    }

    const normalised = rawLabel.toLowerCase().trim() as AgentRoute;
    if ((AGENT_ROUTES as ReadonlyArray<string>).includes(normalised)) {
      return normalised as AgentRoute;
    }

    return 'unknown';
  }

  private _buildDisplayMessage(input: string, classification: ClassificationResult): string {
    if (classification.isFallback || classification.route === 'unknown') {
      return this._buildFallbackMessage(input);
    }

    const displayName = ROUTE_DISPLAY_NAMES[classification.route];
    return `Routing to **${displayName}** for: "${input}"`;
  }

  private _buildFallbackMessage(input: string): string {
    const lines: string[] = [];
    lines.push(`I couldn't determine what you'd like to do with: "${input}"`);
    lines.push('');
    lines.push('Here are some things I can help with:');
    lines.push('');

    for (const route of AGENT_ROUTES) {
      const name = ROUTE_DISPLAY_NAMES[route];
      const examples = ROUTE_EXAMPLE_COMMANDS[route as Exclude<AgentRoute, 'unknown'>];
      lines.push(`**${name}** — e.g. "${examples[0]}"`);
    }

    return lines.join('\n');
  }

  /**
   * Returns the fallback help message without making any LLM call.
   * Used by the chat panel to show available commands on first open.
   */
  buildHelpMessage(): string {
    const lines: string[] = [];
    lines.push('**DevMind Chat** — what would you like to do?');
    lines.push('');

    for (const route of AGENT_ROUTES) {
      const name = ROUTE_DISPLAY_NAMES[route];
      const examples = ROUTE_EXAMPLE_COMMANDS[route as Exclude<AgentRoute, 'unknown'>];
      lines.push(`**${name}**`);
      for (const ex of examples) {
        lines.push(`  • ${ex}`);
      }
      lines.push('');
    }

    return lines.join('\n').trim();
  }
}
