import {
  LinterIntegrationConfig,
  LinterKind,
  DetectedLinter,
  DetectionResult,
  AppliedFix,
  LinterRunResult,
  LinterSuiteResult,
  TerminalAdapter,
  FileSystemAdapter,
  LinterIntegrationError,
  LinterNotInstalledError,
  NoLintersDetectedError,
  LINTER_CONFIG_FILES,
  DEFAULT_LINT_PATHS,
} from './linter.integration.types';
import { LintResult, PrettierCheckResult } from '../mcp/terminal.types';

export class LinterIntegrationService {
  private readonly cwd: string;
  private readonly autoFix: boolean;
  private readonly enableLogging: boolean;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: LinterIntegrationConfig = {},
    private readonly terminalAdapter: TerminalAdapter,
    private readonly fsAdapter: FileSystemAdapter
  ) {
    this.cwd = config.cwd ?? process.cwd();
    this.autoFix = config.autoFix ?? true;
    this.enableLogging = config.enableLogging ?? true;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  /**
   * Detect all linters configured in the project root.
   * Checks for config files, then verifies the binary is installed.
   */
  async detectLinters(cwd?: string): Promise<DetectionResult> {
    const root = cwd ?? this.cwd;
    const detected: DetectedLinter[] = [];
    const notInstalled: LinterKind[] = [];

    const kinds: LinterKind[] = ['eslint', 'prettier', 'ruff', 'black'];

    for (const kind of kinds) {
      const configFile = await this._findConfigFile(kind, root);
      if (!configFile) continue;

      const installed = await this._isInstalled(kind, root);
      const linter: DetectedLinter = {
        kind,
        configFile,
        fixCommand: this._buildFixCommand(kind),
        checkCommand: this._buildCheckCommand(kind),
        installed,
      };
      detected.push(linter);
      if (!installed) notInstalled.push(kind);
    }

    this._log(
      `Detected ${detected.length} linter(s) in ${root}: ${detected.map((d) => d.kind).join(', ') || 'none'}`
    );

    return { detected, notInstalled, scannedRoot: root };
  }

  /**
   * Run all detected linters, applying fixes if autoFix is enabled.
   * Throws NoLintersDetectedError if no linters are configured.
   * Throws LinterNotInstalledError if a detected linter is not installed.
   */
  async runAll(paths?: string[], cwd?: string): Promise<LinterSuiteResult> {
    const root = cwd ?? this.cwd;
    const start = Date.now();

    const detection = await this.detectLinters(root);

    if (detection.detected.length === 0) {
      throw new NoLintersDetectedError(root);
    }

    const results: LinterRunResult[] = [];

    for (const linter of detection.detected) {
      if (!linter.installed) {
        throw new LinterNotInstalledError(linter.kind);
      }
      const lintPaths = paths ?? DEFAULT_LINT_PATHS[linter.kind];
      const result = await this.runLinter(linter.kind, lintPaths, root);
      results.push(result);
    }

    const allFixes = results.flatMap((r) => r.appliedFixes);
    const totalRemainingIssues = results.reduce((s, r) => s + r.remainingIssues, 0);

    return {
      cwd: root,
      results,
      allFixes,
      totalRemainingIssues,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }

  /**
   * Run a single linter by kind.
   * Throws LinterNotInstalledError if the binary is missing.
   */
  async runLinter(kind: LinterKind, paths: string[], cwd?: string): Promise<LinterRunResult> {
    const root = cwd ?? this.cwd;
    const start = Date.now();

    this._log(`Running ${kind} on ${paths.join(', ')} in ${root} (autoFix: ${this.autoFix})`);

    try {
      switch (kind) {
        case 'eslint':
          return await this._runEslint(paths, root, start);
        case 'prettier':
          return await this._runPrettier(paths, root, start);
        case 'ruff':
          return await this._runRuff(paths, root, start);
        case 'black':
          return await this._runBlack(paths, root, start);
        default: {
          const _exhaustive: never = kind;
          throw new LinterIntegrationError(`Unknown linter kind: ${_exhaustive}`, 'INVALID_INPUT');
        }
      }
    } catch (err) {
      if (err instanceof LinterNotInstalledError || err instanceof LinterIntegrationError) {
        throw err;
      }
      throw new LinterIntegrationError(
        `Failed to run ${kind}: ${err instanceof Error ? err.message : String(err)}`,
        'RUN_FAILED',
        err instanceof Error ? err : undefined
      );
    }
  }

  /**
   * Parse ESLint JSON output into a list of AppliedFix entries.
   * Used when ESLint ran with --fix and we need to summarise what changed.
   */
  parseEslintFixes(result: LintResult, wasFixed: boolean): AppliedFix[] {
    if (!wasFixed) return [];
    const fixes: AppliedFix[] = [];
    for (const file of result.files) {
      const fixable = file.fixableErrorCount + file.fixableWarningCount;
      if (fixable === 0) continue;
      for (const msg of file.messages) {
        if (msg.ruleId) {
          fixes.push({
            linter: 'eslint',
            filePath: file.filePath,
            ruleId: msg.ruleId,
            description: `Fixed ${msg.ruleId}: ${msg.message}`,
          });
        }
      }
      // If no messages remain but fixable > 0, ESLint fixed them silently
      if (fixes.filter((f) => f.filePath === file.filePath).length === 0 && fixable > 0) {
        fixes.push({
          linter: 'eslint',
          filePath: file.filePath,
          ruleId: null,
          description: `Applied ${fixable} auto-fix${fixable === 1 ? '' : 'es'}`,
        });
      }
    }
    return fixes;
  }

  /**
   * Parse Prettier output into a list of AppliedFix entries.
   */
  parsePrettierFixes(result: PrettierCheckResult, wasFixed: boolean): AppliedFix[] {
    if (!wasFixed) return [];
    return result.unformattedFiles.map((filePath) => ({
      linter: 'prettier' as LinterKind,
      filePath,
      ruleId: null,
      description: 'Applied Prettier formatting',
    }));
  }

  /**
   * Map a linter kind to its fix command string (for display purposes).
   */
  getFixCommand(kind: LinterKind): string {
    return this._buildFixCommand(kind);
  }

  /**
   * Map a linter kind to its check command string (for display purposes).
   */
  getCheckCommand(kind: LinterKind): string {
    return this._buildCheckCommand(kind);
  }

  private async _runEslint(paths: string[], cwd: string, start: number): Promise<LinterRunResult> {
    let eslintResult: LintResult;
    let appliedFixes: AppliedFix[] = [];

    if (this.autoFix) {
      try {
        eslintResult = await this.terminalAdapter.runEslint(paths, { fix: true }, cwd);
        appliedFixes = this.parseEslintFixes(eslintResult, true);
      } catch (err: any) {
        if (err?.code === 'LINTER_NOT_INSTALLED') {
          throw new LinterNotInstalledError('eslint', err);
        }
        throw err;
      }
    } else {
      try {
        eslintResult = await this.terminalAdapter.runEslint(paths, {}, cwd);
      } catch (err: any) {
        if (err?.code === 'LINTER_NOT_INSTALLED') {
          throw new LinterNotInstalledError('eslint', err);
        }
        throw err;
      }
    }

    const remainingIssues = eslintResult.totalErrors + eslintResult.totalWarnings;

    this._log(
      `ESLint: ${appliedFixes.length} fix(es) applied, ${remainingIssues} issue(s) remaining`
    );

    return {
      linter: 'eslint',
      success: eslintResult.totalErrors === 0,
      appliedFixes,
      remainingIssues,
      raw: eslintResult.raw,
      durationMs: Date.now() - start,
      eslintResult,
    };
  }

  private async _runPrettier(
    paths: string[],
    cwd: string,
    start: number
  ): Promise<LinterRunResult> {
    let prettierResult: PrettierCheckResult;
    let appliedFixes: AppliedFix[] = [];

    if (this.autoFix) {
      let writeResult: { exitCode: number; raw: string };
      try {
        writeResult = await this.terminalAdapter.runPrettierWrite(paths, cwd);
      } catch (err: any) {
        if (err?.code === 'LINTER_NOT_INSTALLED') {
          throw new LinterNotInstalledError('prettier', err);
        }
        throw err;
      }

      try {
        prettierResult = await this.terminalAdapter.runPrettierCheck(paths, cwd);
      } catch (err: any) {
        if (err?.code === 'LINTER_NOT_INSTALLED') {
          throw new LinterNotInstalledError('prettier', err);
        }
        throw err;
      }

      appliedFixes = this._parsePrettierWriteOutput(writeResult.raw, paths);
    } else {
      try {
        prettierResult = await this.terminalAdapter.runPrettierCheck(paths, cwd);
      } catch (err: any) {
        if (err?.code === 'LINTER_NOT_INSTALLED') {
          throw new LinterNotInstalledError('prettier', err);
        }
        throw err;
      }
    }

    const remainingIssues = prettierResult.unformattedFiles.length;

    this._log(
      `Prettier: ${appliedFixes.length} file(s) formatted, ${remainingIssues} unformatted remaining`
    );

    return {
      linter: 'prettier',
      success: prettierResult.formatted,
      appliedFixes,
      remainingIssues,
      raw: prettierResult.raw,
      durationMs: Date.now() - start,
      prettierResult,
    };
  }

  private async _runRuff(paths: string[], cwd: string, start: number): Promise<LinterRunResult> {
    const args = this.autoFix
      ? ['check', '--fix', '--output-format', 'json', ...paths]
      : ['check', '--output-format', 'json', ...paths];

    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await this.terminalAdapter.execute('ruff', args, cwd);
    } catch (err: any) {
      if (err?.code === 'LINTER_NOT_INSTALLED' || err?.message?.includes('not found')) {
        throw new LinterNotInstalledError('ruff', err instanceof Error ? err : undefined);
      }
      throw err;
    }

    const { fixes, remaining } = this._parseRuffOutput(result.stdout, result.stderr);
    const appliedFixes: AppliedFix[] = this.autoFix ? fixes : [];

    this._log(`Ruff: ${appliedFixes.length} fix(es) applied, ${remaining} issue(s) remaining`);

    return {
      linter: 'ruff',
      success: result.exitCode === 0,
      appliedFixes,
      remainingIssues: remaining,
      raw: result.stdout + result.stderr,
      durationMs: Date.now() - start,
    };
  }

  private async _runBlack(paths: string[], cwd: string, start: number): Promise<LinterRunResult> {
    const args = this.autoFix ? [...paths] : ['--check', ...paths];

    let result: { exitCode: number; stdout: string; stderr: string };
    try {
      result = await this.terminalAdapter.execute('black', args, cwd);
    } catch (err: any) {
      if (err?.code === 'LINTER_NOT_INSTALLED' || err?.message?.includes('not found')) {
        throw new LinterNotInstalledError('black', err instanceof Error ? err : undefined);
      }
      throw err;
    }

    const appliedFixes = this.autoFix ? this._parseBlackOutput(result.stderr, paths) : [];

    const remainingIssues =
      !this.autoFix && result.exitCode !== 0 ? this._countBlackUnformatted(result.stderr) : 0;

    this._log(
      `Black: ${appliedFixes.length} file(s) formatted, ${remainingIssues} unformatted remaining`
    );

    return {
      linter: 'black',
      success: result.exitCode === 0 || (this.autoFix && appliedFixes.length >= 0),
      appliedFixes,
      remainingIssues,
      raw: result.stdout + result.stderr,
      durationMs: Date.now() - start,
    };
  }

  private async _findConfigFile(kind: LinterKind, root: string): Promise<string | null> {
    const configFiles = LINTER_CONFIG_FILES[kind];
    for (const file of configFiles) {
      const fullPath = `${root}/${file}`;
      const exists = await this.fsAdapter.exists(fullPath);
      if (exists) {
        // For ruff and black both use pyproject.toml — verify the section exists
        if ((kind === 'ruff' || kind === 'black') && file === 'pyproject.toml') {
          const hasSection = await this._pyprojectHasSection(fullPath, kind);
          if (!hasSection) continue;
        }
        return file;
      }
    }
    return null;
  }

  private async _pyprojectHasSection(filePath: string, kind: LinterKind): Promise<boolean> {
    try {
      const content = await this.fsAdapter.readFile(filePath);
      return content.includes(`[tool.${kind}]`);
    } catch {
      return false;
    }
  }

  private async _isInstalled(kind: LinterKind, cwd: string): Promise<boolean> {
    const checkArgs =
      kind === 'eslint' || kind === 'prettier' ? ['npx', kind, '--version'] : [kind, '--version'];

    try {
      const result = await this.terminalAdapter.execute(checkArgs[0], checkArgs.slice(1), cwd);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private _buildFixCommand(kind: LinterKind): string {
    switch (kind) {
      case 'eslint':
        return 'npx eslint --fix src';
      case 'prettier':
        return 'npx prettier --write src';
      case 'ruff':
        return 'ruff check --fix .';
      case 'black':
        return 'black .';
    }
  }

  private _buildCheckCommand(kind: LinterKind): string {
    switch (kind) {
      case 'eslint':
        return 'npx eslint --format json src';
      case 'prettier':
        return 'npx prettier --check src';
      case 'ruff':
        return 'ruff check --output-format json .';
      case 'black':
        return 'black --check .';
    }
  }

  private _parsePrettierWriteOutput(raw: string, _paths: string[]): AppliedFix[] {
    const fixes: AppliedFix[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed && /\d+ms$/.test(trimmed)) {
        const filePath = trimmed.replace(/\s+\d+ms$/, '');
        fixes.push({
          linter: 'prettier',
          filePath,
          ruleId: null,
          description: 'Applied Prettier formatting',
        });
      }
    }
    return fixes;
  }

  private _parseRuffOutput(
    stdout: string,
    stderr: string
  ): { fixes: AppliedFix[]; remaining: number } {
    const fixes: AppliedFix[] = [];
    let remaining = 0;

    const jsonStart = stdout.indexOf('[');
    if (jsonStart >= 0) {
      try {
        const diagnostics = JSON.parse(stdout.substring(jsonStart)) as Array<{
          filename: string;
          code: string;
          message: string;
          fix?: { message: string };
        }>;

        for (const d of diagnostics) {
          if (d.fix) {
            fixes.push({
              linter: 'ruff',
              filePath: d.filename,
              ruleId: d.code,
              description: d.fix.message || `Fixed ${d.code}: ${d.message}`,
            });
          } else {
            remaining++;
          }
        }
      } catch {
        remaining = stderr
          .split('\n')
          .filter((l) => l.includes('error') || l.includes('warning')).length;
      }
    }

    return { fixes, remaining };
  }

  private _parseBlackOutput(stderr: string, _paths: string[]): AppliedFix[] {
    const fixes: AppliedFix[] = [];
    for (const line of stderr.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('reformatted ')) {
        const filePath = trimmed.replace('reformatted ', '').trim();
        fixes.push({
          linter: 'black',
          filePath,
          ruleId: null,
          description: 'Applied Black formatting',
        });
      }
    }
    return fixes;
  }

  private _countBlackUnformatted(stderr: string): number {
    return stderr.split('\n').filter((l) => l.trim().startsWith('would reformat')).length;
  }

  private _log(msg: string): void {
    if (this.enableLogging) {
      console.log(`[LinterIntegrationService] ${msg}`);
    }
  }
}
