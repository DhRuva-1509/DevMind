import { LintResult, PrettierCheckResult } from '../mcp/terminal.types';

export interface LinterIntegrationConfig {
  cwd?: string;
  autoFix?: boolean;
  enableLogging?: boolean;
  timeoutMs?: number;
}

export type LinterKind = 'eslint' | 'prettier' | 'ruff' | 'black';

export type LinterStatus = 'detected' | 'not_installed' | 'not_detected' | 'error';

export interface DetectedLinter {
  kind: LinterKind;
  configFile: string;
  fixCommand: string;
  checkCommand: string;
  installed: boolean;
}

export interface DetectionResult {
  detected: DetectedLinter[];
  notInstalled: LinterKind[];
  scannedRoot: string;
}

export interface AppliedFix {
  linter: LinterKind;
  filePath: string;
  ruleId: string | null;
  description: string;
}

export interface LinterRunResult {
  linter: LinterKind;
  success: boolean;
  appliedFixes: AppliedFix[];
  remainingIssues: number;
  raw: string;
  durationMs: number;
  eslintResult?: LintResult;
  prettierResult?: PrettierCheckResult;
  errorMessage?: string;
}

export interface LinterSuiteResult {
  cwd: string;
  results: LinterRunResult[];
  allFixes: AppliedFix[];
  totalRemainingIssues: number;
  completedAt: string;
  durationMs: number;
}

export interface TerminalAdapter {
  runEslint(paths: string[], options: { fix?: boolean }, cwd?: string): Promise<LintResult>;
  runPrettierCheck(paths: string[], cwd?: string): Promise<PrettierCheckResult>;
  runPrettierWrite(paths: string[], cwd?: string): Promise<{ exitCode: number; raw: string }>;
  execute(
    command: string,
    args: string[],
    cwd?: string
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface FileSystemAdapter {
  exists(filePath: string): Promise<boolean>;
  readFile(filePath: string): Promise<string>;
}

export type LinterErrorCode =
  | 'LINTER_NOT_INSTALLED'
  | 'NO_LINTERS_DETECTED'
  | 'DETECTION_FAILED'
  | 'RUN_FAILED'
  | 'PARSE_FAILED'
  | 'INVALID_INPUT';

export class LinterIntegrationError extends Error {
  constructor(
    message: string,
    public readonly code: LinterErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'LinterIntegrationError';
  }
}

export class LinterNotInstalledError extends LinterIntegrationError {
  constructor(
    public readonly linter: LinterKind,
    cause?: Error
  ) {
    super(
      `${linter} is not installed or not found on PATH. Install it with: ${INSTALL_HINTS[linter]}`,
      'LINTER_NOT_INSTALLED',
      cause
    );
    this.name = 'LinterNotInstalledError';
  }
}

export class NoLintersDetectedError extends LinterIntegrationError {
  constructor(cwd: string) {
    super(
      `No linter config files found in ${cwd}. Add .eslintrc, .prettierrc, ruff.toml, or pyproject.toml.`,
      'NO_LINTERS_DETECTED'
    );
    this.name = 'NoLintersDetectedError';
  }
}

export const LINTER_CONFIG_FILES: Record<LinterKind, string[]> = {
  eslint: [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yaml',
    '.eslintrc.yml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
  ],
  prettier: [
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.json',
    '.prettierrc.yaml',
    '.prettierrc.yml',
    'prettier.config.js',
    'prettier.config.cjs',
  ],
  ruff: ['ruff.toml', '.ruff.toml', 'pyproject.toml'],
  black: ['pyproject.toml', '.black'],
};

export const INSTALL_HINTS: Record<LinterKind, string> = {
  eslint: 'npm install --save-dev eslint',
  prettier: 'npm install --save-dev prettier',
  ruff: 'pip install ruff',
  black: 'pip install black',
};

export const DEFAULT_LINT_PATHS: Record<LinterKind, string[]> = {
  eslint: ['src'],
  prettier: ['src'],
  ruff: ['.'],
  black: ['.'],
};
