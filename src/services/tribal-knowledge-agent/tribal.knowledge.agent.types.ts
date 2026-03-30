import {
  CommentCategory,
  TribalKnowledgeSearchResult,
} from '../tribal-knowledge-indexer/tribal.knowledge.indexer.types';

export interface TribalKnowledgeAgentConfig {
  sensitivityThreshold?: number;
  maxWarnings?: number;
  topK?: number;
  deployment?: string;
  maxOutputTokens?: number;
  enableLogging?: boolean;
  enableWarningGeneration?: boolean;
  cosmosContainer?: string;
}

export type AgentTrigger = 'pr_open' | 'file_change' | 'manual';

export interface AgentTriggerContext {
  trigger: AgentTrigger;
  owner: string;
  repo: string;
  prNumber?: number;
  prTitle?: string;
  changedFiles: string[];
  detectedPatterns: string[];
  codeSnippets: CodeSnippet[];
}

export interface CodeSnippet {
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
}

export type WarningSeverity = 'high' | 'medium' | 'low';

export interface TribalKnowledgeWarning {
  id: string;
  filePath: string | null;
  message: string;
  severity: WarningSeverity;
  category: CommentCategory;
  confidence: number;
  relatedPRs: RelatedPR[];
  sourceMatch: Omit<TribalKnowledgeSearchResult, never>;
}

export interface RelatedPR {
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  commentExcerpt: string;
  url: string;
}

export type AgentStatus = 'complete' | 'partial' | 'no_matches' | 'failed';

export interface TribalKnowledgeAgentResult {
  owner: string;
  repo: string;
  prNumber: number | null;
  trigger: AgentTrigger;
  warnings: TribalKnowledgeWarning[];
  status: AgentStatus;
  patternsSearched: number;
  rawMatchesFound: number;
  durationMs: number;
  generatedAt: string;
  telemetryId?: string;
  errorMessage?: string;
}

export interface TribalSearchAdapter {
  search(
    owner: string,
    repo: string,
    query: string,
    options: { topK: number; category?: CommentCategory; filePath?: string }
  ): Promise<TribalKnowledgeSearchResult[]>;
}

export interface WarningGenerationAdapter {
  generate(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string>;
}

export interface TribalKnowledgeLoggingAdapter {
  log(entry: TribalKnowledgeTelemetryEntry): Promise<void>;
}

export interface TribalKnowledgeTelemetryEntry {
  id: string;
  partitionKey: string;
  type: 'tribal-knowledge-alert';
  owner: string;
  repo: string;
  prNumber: number | null;
  trigger: AgentTrigger;
  patternsSearched: number;
  rawMatchesFound: number;
  warningsGenerated: number;
  durationMs: number;
  timestamp: string;
}

export type TribalKnowledgeAgentErrorCode =
  | 'INVALID_INPUT'
  | 'SEARCH_FAILED'
  | 'WARNING_GENERATION_FAILED'
  | 'LOGGING_FAILED';

export class TribalKnowledgeAgentError extends Error {
  constructor(
    message: string,
    public readonly code: TribalKnowledgeAgentErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TribalKnowledgeAgentError';
  }
}

export const DEFAULT_AGENT_CONFIG: Required<TribalKnowledgeAgentConfig> = {
  sensitivityThreshold: 0.7,
  maxWarnings: 5,
  topK: 10,
  deployment: 'gpt-4o',
  maxOutputTokens: 500,
  enableLogging: true,
  enableWarningGeneration: true,
  cosmosContainer: 'telemetry',
};

export const HIGH_SEVERITY_CATEGORIES: readonly CommentCategory[] = Object.freeze([
  'bug',
  'security',
]);

export const MEDIUM_SEVERITY_CATEGORIES: readonly CommentCategory[] = Object.freeze([
  'performance',
  'architecture',
]);
