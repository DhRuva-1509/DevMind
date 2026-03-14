export interface PRSummaryAgentConfig {
  foundryAgentId?: string;
  foundryProjectId?: string;
  deployment?: string;
  maxOutputTokens?: number;
  largeprThreshold?: number;
  chunkSize?: number;
  enableCaching?: boolean;
  cacheTtlMs?: number;
  refreshOnUpdate?: boolean;
  enableLogging?: boolean;
  cacheContainer?: string;
}

export type SummaryTrigger = 'command' | 'webhook' | 'manual';

export type SummaryStatus = 'pending' | 'complete' | 'failed' | 'partial';

export interface ChunkSummary {
  chunkIndex: number;
  files: string[];
  content: string;
  tokenCount: number;
}

export interface PRSummary {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prState: string;
  summary: string;
  chunkSummaries: ChunkSummary[];
  wasChunked: boolean;
  foundryAgentId: string | null;
  foundryThreadId: string | null;
  templateVersion: string;
  abVariant: string | null;
  status: SummaryStatus;
  errorMessage: string | null;
  trigger: SummaryTrigger;
  generatedAt: string;
  expiresAt: string;
  prUpdatedAt: string;
}

export interface GenerationResult {
  summary: PRSummary;
  fromCache: boolean;
  durationMs: number;
  contextFromCache: boolean;
}

export interface FoundryRunResult {
  threadId: string;
  content: string;
  tokenCount: number;
  durationMs: number;
}

export class PRSummaryError extends Error {
  constructor(
    message: string,
    public readonly prNumber: number,
    public readonly repo: string
  ) {
    super(message);
    this.name = 'PRSummaryError';
  }
}

export class PRSummaryFoundryError extends PRSummaryError {
  constructor(prNumber: number, repo: string, cause: string) {
    super(`Foundry agent run failed for PR #${prNumber}: ${cause}`, prNumber, repo);
    this.name = 'PRSummaryFoundryError';
  }
}

export class PRSummaryContextError extends PRSummaryError {
  constructor(prNumber: number, repo: string, cause: string) {
    super(`Context extraction failed for PR #${prNumber}: ${cause}`, prNumber, repo);
    this.name = 'PRSummaryContextError';
  }
}
