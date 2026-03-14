export interface PRContextConfig {
  maxTokenBudget?: number;
  maxDiffLinesPerFile?: number;
  maxFiles?: number;
  maxCommits?: number;
  enableCaching?: boolean;
  cacheTtlMs?: number;
  enableLogging?: boolean;
}

export type FileChangeType = 'added' | 'modified' | 'removed' | 'renamed';

export interface ChangedFile {
  path: string;
  changeType: FileChangeType;
  additions: number;
  deletions: number;
  language: string | null;
  isTest: boolean;
  isConfig: boolean;
}

export interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  lineNumber: number | null;
}

export interface DiffHunk {
  header: string;
  startLine: number;
  lineCount: number;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  path: string;
  changeType: FileChangeType;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  truncated: boolean;
}

export interface CommitMessage {
  sha: string;
  message: string;
  subject: string;
  body: string | null;
  author: string;
  timestamp: string;
}

export type IssueRefSource = 'pr_body' | 'commit_message' | 'branch_name';

export interface IssueReference {
  number: number;
  source: IssueRefSource;
  rawMatch: string;
  title: string | null;
}

export type CodePatternType =
  | 'async_await'
  | 'error_handling'
  | 'database_query'
  | 'api_call'
  | 'state_management'
  | 'test_pattern'
  | 'authentication'
  | 'caching'
  | 'logging'
  | 'validation';

export interface DetectedPattern {
  type: CodePatternType;
  files: string[];
  occurrences: number;
  example: string | null;
}

export interface TokenBudgetSummary {
  totalTokens: number;
  budgetLimit: number;
  wasTruncated: boolean;
  breakdown: {
    prMetadata: number;
    changedFiles: number;
    diffs: number;
    commits: number;
    issueRefs: number;
    patterns: number;
  };
}

export interface ExtractedPRContext {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prBody: string | null;
  prAuthor: string;
  prState: 'open' | 'closed' | 'merged';
  headBranch: string;
  baseBranch: string;
  prUrl: string;
  changedFiles: ChangedFile[];
  parsedDiffs: ParsedFileDiff[];
  commits: CommitMessage[];
  issueReferences: IssueReference[];
  detectedPatterns: DetectedPattern[];
  tokenBudget: TokenBudgetSummary;
  extractedAt: string;
  expiresAt: string;
}

export interface ExtractionResult {
  context: ExtractedPRContext;
  fromCache: boolean;
  durationMs: number;
}

export class PRContextError extends Error {
  constructor(
    message: string,
    public readonly prNumber: number,
    public readonly repo: string
  ) {
    super(message);
    this.name = 'PRContextError';
  }
}

export class PRContextCacheError extends PRContextError {
  constructor(prNumber: number, repo: string, cause: string) {
    super(`Cache operation failed for PR #${prNumber}: ${cause}`, prNumber, repo);
    this.name = 'PRContextCacheError';
  }
}
