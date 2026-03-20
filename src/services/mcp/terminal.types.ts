export const DEFAULT_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'git',
  'eslint',
  'prettier',
  'tsc',
  'npm',
  'npx',
  'node',
  'ls',
  'grep',
  'cat',
  'echo',
  'pwd',
  'find',
  'wc',
]);

export const BLOCKED_COMMANDS: ReadonlySet<string> = new Set([
  'rm',
  'rmdir',
  'curl',
  'wget',
  'bash',
  'sh',
  'zsh',
  'fish',
  'sudo',
  'su',
  'chmod',
  'chown',
  'kill',
  'pkill',
  'exec',
  'eval',
  'source',
  'dd',
  'mkfs',
  'mount',
  'umount',
]);

export interface TerminalMCPConfig {
  cwd?: string;
  timeoutMs?: number;
  extraAllowedCommands?: string[];
  allowedCommands?: string[];
  maxOutputBytes?: number;
  env?: Record<string, string>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  durationMs: number;
  timedOut: boolean;
  command: string;
}

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unknown';

export interface GitFileChange {
  path: string;
  status: GitFileStatus;
  oldPath?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  date: string;
  message: string;
}

export interface GitStatusResult {
  branch: string;
  clean: boolean;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  raw: string;
}

export interface GitDiffResult {
  raw: string;
  files: string[];
  additions: number;
  deletions: number;
}

export interface LintMessage {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  ruleId: string | null;
}

export interface LintFileResult {
  filePath: string;
  messages: LintMessage[];
  errorCount: number;
  warningCount: number;
  fixableErrorCount: number;
  fixableWarningCount: number;
}

export interface LintResult {
  files: LintFileResult[];
  totalErrors: number;
  totalWarnings: number;
  fixableErrors: number;
  fixableWarnings: number;
  raw: string;
}

export interface PrettierCheckResult {
  unformattedFiles: string[];
  formatted: boolean;
  raw: string;
}

export interface TscResult {
  errors: Array<{ file: string; line: number; column: number; message: string; code: string }>;
  errorCount: number;
  success: boolean;
  raw: string;
}

export class TerminalMCPError extends Error {
  constructor(
    message: string,
    public readonly code: TerminalErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TerminalMCPError';
  }
}

export type TerminalErrorCode =
  | 'COMMAND_BLOCKED'
  | 'COMMAND_NOT_ALLOWED'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'INVALID_INPUT'
  | 'PARSE_ERROR'
  | 'NOT_A_GIT_REPO'
  | 'LINTER_NOT_INSTALLED';
