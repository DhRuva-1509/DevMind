import { LinterSuiteResult, AppliedFix } from '../linter/linter.integration.types';

export interface NitpickFixerConfig {
  cwd?: string;
  autoCommitEnabled?: boolean;
  commitMessage?: string;
  stageAll?: boolean;
  enableLogging?: boolean;
  enableConsoleLogging?: boolean;
  lintPaths?: string[];
}

export type NitpickTrigger = 'command' | 'pre-commit' | 'chat';

export interface FileDiff {
  filePath: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface NitpickDiff {
  files: FileDiff[];
  totalFiles: number;
  totalAdditions: number;
  totalDeletions: number;
  raw: string;
}

export type ConfirmOutcome = 'accepted' | 'rejected';

export interface ConfirmResult {
  outcome: ConfirmOutcome;
  decidedAt: string;
}

export type NitpickStatus = 'clean' | 'fixed' | 'committed' | 'rejected' | 'no_linters' | 'failed';

export interface NitpickResult {
  status: NitpickStatus;
  trigger: NitpickTrigger;
  cwd: string;
  linterResult: LinterSuiteResult | null;
  diff: NitpickDiff | null;
  confirmation: ConfirmResult | null;
  commitSha: string | null;
  commitMessage: string | null;
  appliedFixes: AppliedFix[];
  remainingIssues: number;
  summary: string;
  errorMessage: string | null;
  durationMs: number;
  completedAt: string;
  telemetryId?: string;
}

export interface LinterAdapter {
  runAll(paths: string[], cwd: string): Promise<LinterSuiteResult>;
}

export interface GitAdapter {
  getDiff(cwd: string): Promise<string>;
  stageAll(cwd: string): Promise<void>;
  commit(message: string, cwd: string): Promise<string>;
  getLastCommitSha(cwd: string): Promise<string>;
}

export interface ConfirmAdapter {
  confirm(diff: NitpickDiff, summary: string): Promise<boolean>;
}

export interface LoggingAdapter {
  log(entry: TelemetryEntry): Promise<void>;
}

export interface TelemetryEntry {
  id: string;
  partitionKey: string;
  type: 'nitpick-run';
  trigger: NitpickTrigger;
  cwd: string;
  status: NitpickStatus;
  totalFixes: number;
  totalFiles: number;
  remainingIssues: number;
  committed: boolean;
  commitSha: string | null;
  durationMs: number;
  completedAt: string;
}

export type NitpickErrorCode =
  | 'NO_LINTERS_DETECTED'
  | 'LINTER_FAILED'
  | 'DIFF_FAILED'
  | 'COMMIT_FAILED'
  | 'INVALID_INPUT'
  | 'UNEXPECTED';

export class NitpickFixerError extends Error {
  constructor(
    message: string,
    public readonly code: NitpickErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'NitpickFixerError';
  }
}

export const DEFAULT_COMMIT_MESSAGE = 'style: auto-fix linting issues';
