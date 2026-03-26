export interface PRCommentExporterConfig {
  pageSize?: number;
  maxPages?: number;
  enableLogging?: boolean;
  enableStorage?: boolean;
  botPatterns?: string[];
  containerName?: string;
  databaseName?: string;
}

export type CommentSource = 'pr_review' | 'pr_review_comment' | 'pr_issue_comment';

export interface ExportedPRComment {
  id: string;
  partitionKey: string;
  commentId: number;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  body: string;
  author: string;
  source: CommentSource;
  filePath: string | null;
  diffLine: number | null;
  createdAt: string;
  updatedAt: string;
  exportedAt: string;
}

export interface RepoSyncState {
  id: string;
  partitionKey: string;
  owner: string;
  repo: string;
  lastSyncedAt: string | null;
  totalExported: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExportResult {
  owner: string;
  repo: string;
  prsProcessed: number;
  commentsExported: number;
  commentsSkipped: number;
  commentsAlreadySynced: number;
  isIncremental: boolean;
  wasPaginated: boolean;
  durationMs: number;
  exportedAt: string;
  errorMessage?: string;
}

export interface GitHubCommentFetchAdapter {
  listPRs(owner: string, repo: string, page: number, perPage: number): Promise<PRSummaryItem[]>;
  listPRComments(owner: string, repo: string, prNumber: number): Promise<RawComment[]>;
}

export interface CosmosExportAdapter {
  upsertComment(comment: ExportedPRComment): Promise<void>;
  readComment(id: string, partitionKey: string): Promise<ExportedPRComment | null>;
  readSyncState(owner: string, repo: string): Promise<RepoSyncState | null>;
  upsertSyncState(state: RepoSyncState): Promise<void>;
}

export interface ExporterLoggingAdapter {
  log(entry: ExporterTelemetryEntry): Promise<void>;
}

export interface PRSummaryItem {
  number: number;
  title: string;
  updatedAt: string;
  state: 'open' | 'closed';
}

export interface RawComment {
  id: number;
  body: string | null;
  user: string;
  createdAt: string;
  updatedAt: string;
  path?: string | null;
  line?: number | null;
  source: CommentSource;
}

export interface ExporterTelemetryEntry {
  id: string;
  partitionKey: string;
  type: 'pr-comment-export';
  owner: string;
  repo: string;
  prsProcessed: number;
  commentsExported: number;
  commentsSkipped: number;
  isIncremental: boolean;
  durationMs: number;
  timestamp: string;
}

export type PRCommentExporterErrorCode =
  | 'INVALID_INPUT'
  | 'GITHUB_FETCH_FAILED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'COSMOS_WRITE_FAILED'
  | 'SYNC_STATE_FAILED';

export class PRCommentExporterError extends Error {
  constructor(
    message: string,
    public readonly code: PRCommentExporterErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PRCommentExporterError';
  }
}

export const DEFAULT_BOT_PATTERNS: readonly string[] = Object.freeze([
  '[bot]',
  'github-actions',
  'dependabot',
  'renovate',
  'codecov',
  'snyk',
  'sonarcloud',
  'stale',
  'mergify',
]);

export const DEFAULT_CONFIG: Required<PRCommentExporterConfig> = {
  pageSize: 100,
  maxPages: 50,
  enableLogging: true,
  enableStorage: true,
  botPatterns: [...DEFAULT_BOT_PATTERNS],
  containerName: 'pr-comments',
  databaseName: 'devmind-db',
};
