import {
  NitpickFixerConfig,
  NitpickTrigger,
  NitpickDiff,
  FileDiff,
  ConfirmResult,
  NitpickResult,
  NitpickStatus,
  LinterAdapter,
  GitAdapter,
  ConfirmAdapter,
  LoggingAdapter,
  TelemetryEntry,
  NitpickFixerError,
  DEFAULT_COMMIT_MESSAGE,
} from './nitpick.fixer.types';
import { LinterSuiteResult, AppliedFix } from '../linter/linter.integration.types';

export class NitpickFixerAgent {
  private readonly cwd: string;
  private readonly autoCommitEnabled: boolean;
  private readonly commitMessage: string;
  private readonly stageAll: boolean;
  private readonly enableLogging: boolean;
  private readonly enableConsoleLogging: boolean;
  private readonly lintPaths: string[];

  constructor(
    private readonly config: NitpickFixerConfig = {},
    private readonly linterAdapter: LinterAdapter,
    private readonly gitAdapter: GitAdapter,
    private readonly confirmAdapter: ConfirmAdapter,
    private readonly loggingAdapter?: LoggingAdapter
  ) {
    this.cwd = config.cwd ?? process.cwd();
    this.autoCommitEnabled = config.autoCommitEnabled ?? true;
    this.commitMessage = config.commitMessage ?? DEFAULT_COMMIT_MESSAGE;
    this.stageAll = config.stageAll ?? true;
    this.enableLogging = config.enableLogging ?? true;
    this.enableConsoleLogging = config.enableConsoleLogging ?? true;
    this.lintPaths = config.lintPaths ?? ['src'];
  }

  async run(trigger: NitpickTrigger = 'command', cwd?: string): Promise<NitpickResult> {
    const root = cwd ?? this.cwd;
    const start = Date.now();

    this._log(`Starting nitpick run (trigger: ${trigger}) in ${root}`);

    let linterResult: LinterSuiteResult;
    try {
      linterResult = await this.linterAdapter.runAll(this.lintPaths, root);
    } catch (err: any) {
      if (err?.code === 'NO_LINTERS_DETECTED' || err?.name === 'NoLintersDetectedError') {
        const result = this._buildResult({
          status: 'no_linters',
          trigger,
          cwd: root,
          linterResult: null,
          diff: null,
          confirmation: null,
          commitSha: null,
          commitMessage: null,
          appliedFixes: [],
          remainingIssues: 0,
          errorMessage: err.message,
          durationMs: Date.now() - start,
        });
        await this._log(`No linters detected in ${root}`);
        await this._logTelemetry(result);
        return result;
      }
      const result = this._buildResult({
        status: 'failed',
        trigger,
        cwd: root,
        linterResult: null,
        diff: null,
        confirmation: null,
        commitSha: null,
        commitMessage: null,
        appliedFixes: [],
        remainingIssues: 0,
        errorMessage: err.message ?? String(err),
        durationMs: Date.now() - start,
      });
      await this._logTelemetry(result);
      return result;
    }

    const appliedFixes = linterResult.allFixes;
    const remainingIssues = linterResult.totalRemainingIssues;

    if (appliedFixes.length === 0) {
      const result = this._buildResult({
        status: 'clean',
        trigger,
        cwd: root,
        linterResult,
        diff: null,
        confirmation: null,
        commitSha: null,
        commitMessage: null,
        appliedFixes: [],
        remainingIssues,
        errorMessage: null,
        durationMs: Date.now() - start,
      });
      this._log(`No fixes needed — project is clean`);
      await this._logTelemetry(result);
      return result;
    }

    let diff: NitpickDiff;
    try {
      const rawDiff = await this.gitAdapter.getDiff(root);
      diff = this._parseDiff(rawDiff, appliedFixes);
    } catch (err: any) {
      // Diff failure is non-fatal — build a synthetic diff from fix list
      diff = this._buildSyntheticDiff(appliedFixes);
      this._log(`getDiff failed (${err.message}), using synthetic diff`);
    }

    const summary = this._buildSummary(appliedFixes, remainingIssues);
    this._log(summary);

    let confirmed: boolean;
    try {
      confirmed = await this.confirmAdapter.confirm(diff, summary);
    } catch (err: any) {
      const result = this._buildResult({
        status: 'failed',
        trigger,
        cwd: root,
        linterResult,
        diff,
        confirmation: null,
        commitSha: null,
        commitMessage: null,
        appliedFixes,
        remainingIssues,
        errorMessage: `Confirmation failed: ${err.message}`,
        durationMs: Date.now() - start,
      });
      await this._logTelemetry(result);
      return result;
    }

    const confirmation: ConfirmResult = {
      outcome: confirmed ? 'accepted' : 'rejected',
      decidedAt: new Date().toISOString(),
    };

    if (!confirmed) {
      const result = this._buildResult({
        status: 'rejected',
        trigger,
        cwd: root,
        linterResult,
        diff,
        confirmation,
        commitSha: null,
        commitMessage: null,
        appliedFixes,
        remainingIssues,
        errorMessage: null,
        durationMs: Date.now() - start,
      });
      this._log(`User rejected fixes — no commit made`);
      await this._logTelemetry(result);
      return result;
    }

    if (!this.autoCommitEnabled) {
      const result = this._buildResult({
        status: 'fixed',
        trigger,
        cwd: root,
        linterResult,
        diff,
        confirmation,
        commitSha: null,
        commitMessage: null,
        appliedFixes,
        remainingIssues,
        errorMessage: null,
        durationMs: Date.now() - start,
      });
      this._log(`Fixes accepted — autoCommit disabled, skipping commit`);
      await this._logTelemetry(result);
      return result;
    }

    let commitSha: string | null = null;
    const commitMsg = this.commitMessage;
    try {
      if (this.stageAll) {
        await this.gitAdapter.stageAll(root);
      }
      await this.gitAdapter.commit(commitMsg, root);
      commitSha = await this.gitAdapter.getLastCommitSha(root);
      this._log(`Committed: ${commitSha} — "${commitMsg}"`);
    } catch (err: any) {
      const result = this._buildResult({
        status: 'failed',
        trigger,
        cwd: root,
        linterResult,
        diff,
        confirmation,
        commitSha: null,
        commitMessage: commitMsg,
        appliedFixes,
        remainingIssues,
        errorMessage: `Commit failed: ${err.message}`,
        durationMs: Date.now() - start,
      });
      await this._logTelemetry(result);
      return result;
    }

    const result = this._buildResult({
      status: 'committed',
      trigger,
      cwd: root,
      linterResult,
      diff,
      confirmation,
      commitSha,
      commitMessage: commitMsg,
      appliedFixes,
      remainingIssues,
      errorMessage: null,
      durationMs: Date.now() - start,
    });

    await this._logTelemetry(result);
    return result;
  }

  /**
   * Run linters and return the diff without showing confirmation or committing.
   * Used to preview what would change before triggering the full flow.
   */
  async preview(
    cwd?: string
  ): Promise<{ linterResult: LinterSuiteResult; diff: NitpickDiff; summary: string }> {
    const root = cwd ?? this.cwd;
    const linterResult = await this.linterAdapter.runAll(this.lintPaths, root);
    const rawDiff = await this.gitAdapter.getDiff(root);
    const diff = this._parseDiff(rawDiff, linterResult.allFixes);
    const summary = this._buildSummary(linterResult.allFixes, linterResult.totalRemainingIssues);
    return { linterResult, diff, summary };
  }

  /**
   * Build a human-readable summary string from fix results.
   * Used by both the agent and the UI.
   */
  buildSummary(appliedFixes: AppliedFix[], remainingIssues: number): string {
    return this._buildSummary(appliedFixes, remainingIssues);
  }

  /**
   * Parse a raw unified diff string into structured FileDiff objects.
   * Falls back to synthetic diff if parsing fails.
   */
  parseDiff(raw: string, fixes: AppliedFix[]): NitpickDiff {
    return this._parseDiff(raw, fixes);
  }

  private _parseDiff(raw: string, fixes: AppliedFix[]): NitpickDiff {
    if (!raw || !raw.trim()) {
      return this._buildSyntheticDiff(fixes);
    }

    const files: FileDiff[] = [];
    const fileBlocks = raw.split(/^diff --git /m).filter(Boolean);

    for (const block of fileBlocks) {
      const lines = block.split('\n');
      const headerMatch = lines[0]?.match(/^a\/(.+?) b\//);
      const filePath = headerMatch ? headerMatch[1] : 'unknown';

      let additions = 0;
      let deletions = 0;
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) additions++;
        if (line.startsWith('-') && !line.startsWith('---')) deletions++;
      }

      files.push({
        filePath,
        diff: `diff --git ${block}`,
        additions,
        deletions,
      });
    }

    const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
    const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

    return {
      files,
      totalFiles: files.length,
      totalAdditions,
      totalDeletions,
      raw,
    };
  }

  private _buildSyntheticDiff(fixes: AppliedFix[]): NitpickDiff {
    const byFile = new Map<string, AppliedFix[]>();
    for (const fix of fixes) {
      const existing = byFile.get(fix.filePath) ?? [];
      existing.push(fix);
      byFile.set(fix.filePath, existing);
    }

    const files: FileDiff[] = Array.from(byFile.entries()).map(([filePath, fileFixes]) => ({
      filePath,
      diff: fileFixes.map((f) => `# ${f.description}`).join('\n'),
      additions: fileFixes.length,
      deletions: fileFixes.length,
    }));

    return {
      files,
      totalFiles: files.length,
      totalAdditions: fixes.length,
      totalDeletions: fixes.length,
      raw: fixes.map((f) => `${f.filePath}: ${f.description}`).join('\n'),
    };
  }

  private _buildSummary(fixes: AppliedFix[], remainingIssues: number): string {
    if (fixes.length === 0) {
      return 'No linting issues found — your code is clean! ✅';
    }

    const fileSet = new Set(fixes.map((f) => f.filePath));
    const fileCount = fileSet.size;
    const fixCount = fixes.length;

    const byLinter = new Map<string, number>();
    for (const fix of fixes) {
      byLinter.set(fix.linter, (byLinter.get(fix.linter) ?? 0) + 1);
    }
    const breakdown = Array.from(byLinter.entries())
      .map(([linter, count]) => `${linter}: ${count}`)
      .join(', ');

    let summary = `${fixCount} issue${fixCount === 1 ? '' : 's'} fixed in ${fileCount} file${fileCount === 1 ? '' : 's'} (${breakdown})`;

    if (remainingIssues > 0) {
      summary += `\n${remainingIssues} issue${remainingIssues === 1 ? '' : 's'} could not be auto-fixed and require manual attention.`;
    }

    return summary;
  }

  private _buildResult(args: {
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
    errorMessage: string | null;
    durationMs: number;
  }): NitpickResult {
    return {
      status: args.status,
      trigger: args.trigger,
      cwd: args.cwd,
      linterResult: args.linterResult,
      diff: args.diff,
      confirmation: args.confirmation,
      commitSha: args.commitSha,
      commitMessage: args.commitMessage,
      appliedFixes: args.appliedFixes,
      remainingIssues: args.remainingIssues,
      summary: this._buildSummary(args.appliedFixes, args.remainingIssues),
      errorMessage: args.errorMessage,
      durationMs: args.durationMs,
      completedAt: new Date().toISOString(),
    };
  }

  private async _logTelemetry(result: NitpickResult): Promise<void> {
    if (!this.enableLogging || !this.loggingAdapter) return;
    try {
      const id = `nitpick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry: TelemetryEntry = {
        id,
        partitionKey: result.cwd,
        type: 'nitpick-run',
        trigger: result.trigger,
        cwd: result.cwd,
        status: result.status,
        totalFixes: result.appliedFixes.length,
        totalFiles: result.diff?.totalFiles ?? 0,
        remainingIssues: result.remainingIssues,
        committed: result.status === 'committed',
        commitSha: result.commitSha,
        durationMs: result.durationMs,
        completedAt: result.completedAt,
      };
      const telemetryResult = await this.loggingAdapter.log(entry);
      result.telemetryId = id;
      void telemetryResult;
    } catch {
      // Non-fatal — telemetry failure never breaks the run
    }
  }

  private _log(msg: string): void {
    if (this.enableConsoleLogging) {
      console.log(`[NitpickFixerAgent] ${msg}`);
    }
  }
}
