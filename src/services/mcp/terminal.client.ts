import { spawn, SpawnOptionsWithoutStdio } from 'child_process';
import { ChildProcess } from 'child_process';
import {
  TerminalMCPConfig,
  TerminalMCPError,
  CommandResult,
  GitStatusResult,
  GitFileChange,
  GitFileStatus,
  GitLogEntry,
  GitDiffResult,
  LintResult,
  LintFileResult,
  LintMessage,
  PrettierCheckResult,
  TscResult,
  DEFAULT_ALLOWED_COMMANDS,
} from './terminal.types';

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptionsWithoutStdio) => ChildProcess;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576; // 1 MB
const SIGKILL_GRACE_MS = 2_000;

export class TerminalMCPClient {
  private readonly cwd: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly allowedCommands: Set<string>;
  private readonly env: Record<string, string>;
  private readonly spawner: SpawnFn;

  constructor(config: TerminalMCPConfig & { spawner?: SpawnFn } = {}) {
    this.cwd = config.cwd ?? process.cwd();
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputBytes = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.env = { ...process.env, ...(config.env ?? {}) } as Record<string, string>;
    this.spawner = config.spawner ?? spawn;

    if (config.allowedCommands) {
      this.allowedCommands = new Set(config.allowedCommands);
    } else {
      this.allowedCommands = new Set(DEFAULT_ALLOWED_COMMANDS);
      for (const cmd of config.extraAllowedCommands ?? []) {
        this.allowedCommands.add(cmd);
      }
    }
  }

  /**
   * Returns true if the first token of the command is on the allowed list.
   * This is the sole security gate — shell: false ensures no shell expansion.
   */
  isAllowed(command: string): boolean {
    if (!command || typeof command !== 'string') return false;
    const firstToken = command.trim().split(/\s+/)[0];
    return this.allowedCommands.has(firstToken);
  }

  /**
   * Execute a command with args. shell: false prevents injection.
   * Timeout: SIGTERM after timeoutMs, SIGKILL after 2s grace period.
   */
  async execute(command: string, args: string[] = [], cwd?: string): Promise<CommandResult> {
    if (!command || typeof command !== 'string') {
      throw new TerminalMCPError('Command must be a non-empty string', 'INVALID_INPUT');
    }

    if (!this.isAllowed(command)) {
      throw new TerminalMCPError(
        `Command "${command}" is not in the allowed list`,
        'COMMAND_NOT_ALLOWED'
      );
    }

    const workDir = cwd ?? this.cwd;
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let stdoutBuf = '';
      let stderrBuf = '';
      let timedOut = false;
      let settled = false;

      const child = this.spawner(command, args, {
        cwd: workDir,
        env: this.env,
        shell: false, // critical — prevents shell injection
      });

      child.stdout?.on('data', (chunk: Buffer) => {
        const remaining = this.maxOutputBytes - Buffer.byteLength(stdoutBuf);
        if (remaining > 0) {
          stdoutBuf += chunk.toString('utf8', 0, Math.min(chunk.length, remaining));
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const remaining = this.maxOutputBytes - Buffer.byteLength(stderrBuf);
        if (remaining > 0) {
          stderrBuf += chunk.toString('utf8', 0, Math.min(chunk.length, remaining));
        }
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // process already gone
          }
        }, SIGKILL_GRACE_MS);
      }, this.timeoutMs);

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);

        const result: CommandResult = {
          stdout: stdoutBuf,
          stderr: stderrBuf,
          exitCode: code ?? 1,
          success: !timedOut && code === 0,
          durationMs: Date.now() - startTime,
          timedOut,
          command: [command, ...args].join(' '),
        };

        if (timedOut) {
          reject(
            new TerminalMCPError(
              `Command "${command}" timed out after ${this.timeoutMs}ms`,
              'TIMEOUT'
            )
          );
        } else {
          resolve(result);
        }
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        reject(
          new TerminalMCPError(
            `Failed to spawn "${command}": ${err.message}`,
            'EXECUTION_FAILED',
            err
          )
        );
      });
    });
  }

  async gitStatus(cwd?: string): Promise<GitStatusResult> {
    const result = await this.execute('git', ['status', '--porcelain', '-b'], cwd);

    if (!result.success && result.stderr.includes('not a git repository')) {
      throw new TerminalMCPError('Not a git repository', 'NOT_A_GIT_REPO');
    }

    return this._parseGitStatus(result.stdout);
  }

  async gitBranch(cwd?: string): Promise<string> {
    const result = await this.execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

    if (!result.success) {
      throw new TerminalMCPError('Failed to get current branch', 'EXECUTION_FAILED');
    }

    return result.stdout.trim();
  }

  async gitLog(count = 10, cwd?: string): Promise<GitLogEntry[]> {
    const format = '%H%x1f%h%x1f%an%x1f%ae%x1f%ai%x1f%s';
    const result = await this.execute(
      'git',
      ['log', `--max-count=${count}`, `--format=${format}`],
      cwd
    );

    if (!result.success) {
      throw new TerminalMCPError('Failed to get git log', 'EXECUTION_FAILED');
    }

    return this._parseGitLog(result.stdout);
  }

  async gitDiff(ref?: string, cwd?: string): Promise<GitDiffResult> {
    const args = ref ? ['diff', ref, '--stat'] : ['diff', '--stat'];
    const statResult = await this.execute('git', args, cwd);

    const rawArgs = ref ? ['diff', ref] : ['diff'];
    const rawResult = await this.execute('git', rawArgs, cwd);

    return this._parseGitDiff(rawResult.stdout, statResult.stdout);
  }

  async gitFetch(remote = 'origin', cwd?: string): Promise<CommandResult> {
    return this.execute('git', ['fetch', remote], cwd);
  }

  async gitChangedFiles(ref?: string, cwd?: string): Promise<GitFileChange[]> {
    const args = ref ? ['diff', '--name-status', ref] : ['diff', '--name-status'];

    const result = await this.execute('git', args, cwd);

    if (!result.success) {
      throw new TerminalMCPError('Failed to get changed files', 'EXECUTION_FAILED');
    }

    return this._parseNameStatus(result.stdout);
  }

  async runEslint(
    paths: string[],
    options: { fix?: boolean; maxWarnings?: number } = {},
    cwd?: string
  ): Promise<LintResult> {
    const args = ['--format', 'json'];
    if (options.fix) args.push('--fix');
    if (options.maxWarnings !== undefined) {
      args.push('--max-warnings', String(options.maxWarnings));
    }
    args.push(...paths);

    let result: CommandResult;
    try {
      result = await this.execute('eslint', args, cwd);
    } catch (err) {
      if (err instanceof TerminalMCPError && err.code === 'EXECUTION_FAILED') {
        throw new TerminalMCPError(
          'ESLint is not installed or not found',
          'LINTER_NOT_INSTALLED',
          err
        );
      }
      throw err;
    }

    try {
      return this._parseEslintOutput(result.stdout, result.stderr);
    } catch {
      throw new TerminalMCPError(
        `Failed to parse ESLint output: ${result.stderr || result.stdout}`,
        'PARSE_ERROR'
      );
    }
  }

  async runPrettierCheck(paths: string[], cwd?: string): Promise<PrettierCheckResult> {
    const args = ['--check', ...paths];

    let result: CommandResult;
    try {
      result = await this.execute('prettier', args, cwd);
    } catch (err) {
      if (err instanceof TerminalMCPError && err.code === 'EXECUTION_FAILED') {
        throw new TerminalMCPError(
          'Prettier is not installed or not found',
          'LINTER_NOT_INSTALLED',
          err
        );
      }
      throw err;
    }

    return this._parsePrettierCheck(result.stdout, result.stderr, result.exitCode);
  }

  async runTsc(configPath?: string, cwd?: string): Promise<TscResult> {
    const args = ['--noEmit'];
    if (configPath) args.push('--project', configPath);

    let result: CommandResult;
    try {
      result = await this.execute('tsc', args, cwd);
    } catch (err) {
      if (err instanceof TerminalMCPError && err.code === 'EXECUTION_FAILED') {
        throw new TerminalMCPError(
          'tsc is not installed or not found',
          'LINTER_NOT_INSTALLED',
          err
        );
      }
      throw err;
    }

    return this._parseTscOutput(result.stdout + result.stderr, result.exitCode);
  }

  private _parseGitStatus(raw: string): GitStatusResult {
    const lines = raw.trim().split('\n').filter(Boolean);
    let branch = 'unknown';
    const staged: GitFileChange[] = [];
    const unstaged: GitFileChange[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      if (line.startsWith('##')) {
        const branchMatch = line.match(/^## (.+?)(?:\.\.\..*)?$/);
        if (branchMatch) branch = branchMatch[1].trim();
        continue;
      }

      if (line.length < 2) continue;
      const xy = line.substring(0, 2);
      const path = line.substring(3).trim();
      const x = xy[0]; // staged
      const y = xy[1]; // unstaged

      if (x === '?' && y === '?') {
        untracked.push(path);
        continue;
      }

      if (x !== ' ' && x !== '?') {
        staged.push({ path, status: this._statusCharToEnum(x) });
      }
      if (y !== ' ' && y !== '?') {
        unstaged.push({ path, status: this._statusCharToEnum(y) });
      }
    }

    return {
      branch,
      clean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
      staged,
      unstaged,
      untracked,
      raw,
    };
  }

  private _statusCharToEnum(char: string): GitFileStatus {
    const map: Record<string, GitFileStatus> = {
      A: 'added',
      M: 'modified',
      D: 'deleted',
      R: 'renamed',
      C: 'copied',
    };
    return map[char] ?? 'unknown';
  }

  private _parseGitLog(raw: string): GitLogEntry[] {
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\x1f');
        return {
          hash: parts[0] ?? '',
          shortHash: parts[1] ?? '',
          author: parts[2] ?? '',
          email: parts[3] ?? '',
          date: parts[4] ?? '',
          message: parts[5] ?? '',
        };
      });
  }

  private _parseGitDiff(raw: string, stat: string): GitDiffResult {
    const files: string[] = [];
    let additions = 0;
    let deletions = 0;

    const statLines = stat.trim().split('\n');
    for (const line of statLines) {
      const fileMatch = line.match(/^\s*(.+?)\s*\|/);
      if (fileMatch) files.push(fileMatch[1].trim());

      const addMatch = line.match(/(\d+) insertion/);
      const delMatch = line.match(/(\d+) deletion/);
      if (addMatch) additions += parseInt(addMatch[1], 10);
      if (delMatch) deletions += parseInt(delMatch[1], 10);
    }

    return { raw, files, additions, deletions };
  }

  private _parseNameStatus(raw: string): GitFileChange[] {
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        const statusChar = parts[0]?.[0] ?? '';
        const path = parts[1] ?? '';
        const oldPath = parts[2]; // only present for renames
        return {
          path,
          status: this._statusCharToEnum(statusChar),
          ...(oldPath ? { oldPath } : {}),
        };
      });
  }

  private _parseEslintOutput(stdout: string, _stderr: string): LintResult {
    const jsonStart = stdout.indexOf('[');
    if (jsonStart < 0) {
      throw new TerminalMCPError('ESLint output contains no JSON array', 'PARSE_ERROR');
    }
    const jsonStr = stdout.substring(jsonStart);
    const raw = JSON.parse(jsonStr) as Array<{
      filePath: string;
      messages: Array<{
        line: number;
        column: number;
        severity: number;
        message: string;
        ruleId: string | null;
      }>;
      errorCount: number;
      warningCount: number;
      fixableErrorCount: number;
      fixableWarningCount: number;
    }>;

    const files: LintFileResult[] = raw.map((f) => ({
      filePath: f.filePath,
      errorCount: f.errorCount,
      warningCount: f.warningCount,
      fixableErrorCount: f.fixableErrorCount,
      fixableWarningCount: f.fixableWarningCount,
      messages: f.messages.map(
        (m): LintMessage => ({
          line: m.line,
          column: m.column,
          severity: m.severity === 2 ? 'error' : m.severity === 1 ? 'warning' : 'info',
          message: m.message,
          ruleId: m.ruleId,
        })
      ),
    }));

    return {
      files,
      totalErrors: files.reduce((s, f) => s + f.errorCount, 0),
      totalWarnings: files.reduce((s, f) => s + f.warningCount, 0),
      fixableErrors: files.reduce((s, f) => s + f.fixableErrorCount, 0),
      fixableWarnings: files.reduce((s, f) => s + f.fixableWarningCount, 0),
      raw: stdout,
    };
  }

  private _parsePrettierCheck(
    stdout: string,
    stderr: string,
    exitCode: number
  ): PrettierCheckResult {
    const combined = (stdout + '\n' + stderr).trim();
    const unformattedFiles = combined
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('Checking') && !l.includes('All matched'));

    return {
      unformattedFiles: exitCode === 0 ? [] : unformattedFiles,
      formatted: exitCode === 0,
      raw: combined,
    };
  }

  private _parseTscOutput(raw: string, exitCode: number): TscResult {
    const errorRegex = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/gm;
    const errors: TscResult['errors'] = [];
    let match: RegExpExecArray | null;

    while ((match = errorRegex.exec(raw)) !== null) {
      errors.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: match[4],
        message: match[5].trim(),
      });
    }

    return {
      errors,
      errorCount: errors.length,
      success: exitCode === 0,
      raw,
    };
  }
}
