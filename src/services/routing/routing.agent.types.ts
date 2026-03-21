export type AgentRoute =
  | 'version-guard'
  | 'pr-summary'
  | 'conflict-explainer'
  | 'nitpick-fixer'
  | 'unknown';

export const AGENT_ROUTES: ReadonlyArray<AgentRoute> = [
  'version-guard',
  'pr-summary',
  'conflict-explainer',
  'nitpick-fixer',
];

/** Human-readable display names for each route */
export const ROUTE_DISPLAY_NAMES: Record<AgentRoute, string> = {
  'version-guard': 'Version Guard',
  'pr-summary': 'PR Summary',
  'conflict-explainer': 'Conflict Explainer',
  'nitpick-fixer': 'Nitpick Fixer',
  unknown: 'Unknown',
};

/** Example commands shown in the fallback message */
export const ROUTE_EXAMPLE_COMMANDS: Record<Exclude<AgentRoute, 'unknown'>, string[]> = {
  'version-guard': ['analyze this file', 'check for deprecated APIs', 'scan for version warnings'],
  'pr-summary': ['summarize PR #76', 'what changed in this pull request', 'generate PR summary'],
  'conflict-explainer': [
    'explain this conflict',
    'what does this merge conflict mean',
    'help me understand this conflict in auth.ts',
  ],
  'nitpick-fixer': ['fix nitpicks', 'run linter', 'fix code style issues'],
};

export interface RoutingAgentConfig {
  deployment?: string;
  maxOutputTokens?: number;
  confidenceThreshold?: number;
  enableLogging?: boolean;
  enableConsoleLogging?: boolean;
}

export interface ClassificationResult {
  route: AgentRoute;
  confidence: number;
  rawLabel: string;
  isFallback: boolean;
  durationMs: number;
}

export interface RoutingRequest {
  input: string;
  fileContext?: string;
}

export interface RoutingResponse {
  classification: ClassificationResult;
  displayMessage: string;
  routedAt: string;
  telemetryId?: string;
}

export interface ClassifierAdapter {
  complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

export interface RoutingLoggingAdapter {
  log(entry: RoutingTelemetryEntry): Promise<void>;
}

export interface RoutingTelemetryEntry {
  id: string;
  partitionKey: string;
  type: 'routing-decision';
  input: string;
  route: AgentRoute;
  confidence: number;
  isFallback: boolean;
  durationMs: number;
  timestamp: string;
}

export interface RawClassification {
  route: string;
  confidence: number;
}

export class RoutingAgentError extends Error {
  constructor(
    message: string,
    public readonly code: RoutingErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'RoutingAgentError';
  }
}

export type RoutingErrorCode =
  | 'INVALID_INPUT'
  | 'CLASSIFICATION_FAILED'
  | 'PARSE_FAILED'
  | 'LOGGING_FAILED';
