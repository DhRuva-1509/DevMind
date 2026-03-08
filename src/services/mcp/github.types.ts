export type GitHubAuthType = 'pat' | 'oauth';

export interface GitHubMCPConfig {
  token: string;
  authType?: GitHubAuthType;
  rateLimitThreshold?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

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

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  author: string;
  labels: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
}

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

export interface CodeSearchResult {
  path: string;
  repository: string;
  url: string;
  fragment?: string;
}

export interface SearchCodeOptions {
  perPage?: number;
}
export interface GitHubRateLimit {
  limit: number;
  remaining: number;
  resetAt: Date;
  isNearLimit: boolean;
}

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
