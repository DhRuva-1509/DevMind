// ─────────────────────────────────────────────────────────────
// GitHub MCP Types
// TICKET-06 | DevMind – GitHub MCP Client
// ─────────────────────────────────────────────────────────────

export type GitHubAuthType = 'pat' | 'oauth';

export interface GitHubMCPConfig {
  /** Personal Access Token – resolved from Key Vault at runtime */
  token: string;
  authType?: GitHubAuthType;
  /** Requests per hour ceiling before proactive back-off (default: 4500) */
  rateLimitThreshold?: number;
  /** Maximum retries on transient / rate-limit errors (default: 3) */
  maxRetries?: number;
  /** Base delay (ms) for exponential back-off (default: 1000) */
  retryBaseDelayMs?: number;
}

// ── Pull Requests ─────────────────────────────────────────────

export interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed' | 'merged';
  author: string;
  headBranch: string;
  baseBranch: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  draft: boolean;
  labels: string[];
  linkedIssues: number[];
}

export interface GitHubPRDiffFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface GitHubPRDiff {
  prNumber: number;
  totalAdditions: number;
  totalDeletions: number;
  totalChanges: number;
  files: GitHubPRDiffFile[];
}

// ── Issues ────────────────────────────────────────────────────

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  author: string;
  labels: string[]; // ← was `string` in your local file, must be `string[]`
  url: string;
  createdAt: string;
  updatedAt: string;
}

// ── Comments ──────────────────────────────────────────────────

export interface GitHubComment {
  id: number;
  body: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface CreateCommentInput {
  body: string;
}

export interface UpdateCommentInput {
  body: string;
}

// ── Search ────────────────────────────────────────────────────

export interface CodeSearchResult {
  path: string;
  repository: string;
  url: string;
  /** Matched line snippet (may be undefined for binary files) */
  fragment?: string;
}

export interface SearchCodeOptions {
  /** Max results to return (default: 30, max: 100) */
  perPage?: number;
}

// ── Rate Limit ────────────────────────────────────────────────

export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  resetAt: Date;
  /** True when remaining < rateLimitThreshold */
  isNearLimit: boolean;
}

// ── Errors ────────────────────────────────────────────────────

export class GitHubMCPError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'GitHubMCPError';
  }
}

export class GitHubRateLimitError extends GitHubMCPError {
  constructor(public readonly resetAt: Date) {
    super(`GitHub rate limit exceeded. Resets at ${resetAt.toISOString()}`, 429);
    this.name = 'GitHubRateLimitError';
  }
}

export class GitHubAuthError extends GitHubMCPError {
  constructor() {
    super('GitHub authentication failed. Check your PAT / OAuth token.', 401);
    this.name = 'GitHubAuthError';
  }
}

export class GitHubNotFoundError extends GitHubMCPError {
  constructor(resource: string) {
    super(`GitHub resource not found: ${resource}`, 404);
    this.name = 'GitHubNotFoundError';
  }
}
