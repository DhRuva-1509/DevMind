import { ConflictContext, ConflictBlock } from '../conflict-parser/conflict.parser.types';

export interface ConflictExplainerConfig {
  deployment?: string;
  maxOutputTokens?: number;
  confidenceThreshold?: number;
  maxRetries?: number;
  enableLogging?: boolean;
  enableConsoleLogging?: boolean;
}

export interface ConflictSideExplanation {
  intent: string;
  keyChanges: string[];
}

export interface ConflictExplanation {
  conflictIndex: number;
  filePath: string;
  startLine: number;
  endLine: number;
  currentSide: ConflictSideExplanation;
  incomingSide: ConflictSideExplanation;
  resolutionStrategy: string;
  confidenceScore: number;
  retriesUsed: number;
  readonly autoResolved: false;
}

export type ExplainerStatus = 'complete' | 'partial' | 'failed';

export interface ExplainerResult {
  explanations: ConflictExplanation[];
  status: ExplainerStatus;
  successCount: number;
  failureCount: number;
  durationMs: number;
  generatedAt: string;
  telemetryId?: string;
  errorMessage?: string;
}

export interface OpenAIAdapter {
  complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

export interface LoggingAdapter {
  log(entry: TelemetryEntry): Promise<void>;
}

export interface TelemetryEntry {
  id: string;
  partitionKey: string;
  type: 'conflict-explanation';
  filePath: string;
  conflictCount: number;
  successCount: number;
  failureCount: number;
  totalRetries: number;
  durationMs: number;
  timestamp: string;
}

export interface RawExplanationResponse {
  currentIntent: string;
  currentKeyChanges: string[];
  incomingIntent: string;
  incomingKeyChanges: string[];
  resolutionStrategy: string;
  confidenceScore: number;
}

export class ConflictExplainerError extends Error {
  constructor(
    message: string,
    public readonly code: ConflictExplainerErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ConflictExplainerError';
  }
}

export type ConflictExplainerErrorCode =
  | 'INVALID_INPUT'
  | 'NO_CONFLICTS'
  | 'LLM_FAILED'
  | 'PARSE_FAILED'
  | 'REFLECTION_EXHAUSTED'
  | 'LOGGING_FAILED';

export type { ConflictContext, ConflictBlock };
