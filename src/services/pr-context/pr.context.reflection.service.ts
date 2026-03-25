import { ExtractedPRContext } from './pr.context.types';
import {
  QualityCheckResult,
  QualityCheckName,
  QualityCheckStatus,
  ReflectionResult,
  ReflectionConfig,
  ReflectionTelemetryEntry,
  QualityFlag,
  DEFAULT_REFLECTION_CONFIG,
} from './pr.context.reflection.types';

export interface ReflectionLoggingAdapter {
  log(entry: ReflectionTelemetryEntry): Promise<void>;
}

export class PRContextReflectionService {
  private readonly config: Required<ReflectionConfig>;

  constructor(
    config: ReflectionConfig = {},
    private readonly loggingAdapter?: ReflectionLoggingAdapter
  ) {
    this.config = { ...DEFAULT_REFLECTION_CONFIG, ...config };
  }

  /**
   * Validates extracted context against three quality checks.
   * Called after each extraction attempt.
   */
  validate(context: ExtractedPRContext): ReflectionResult {
    const checks: QualityCheckResult[] = [
      this._checkTokenBudget(context),
      this._checkFieldCompleteness(context),
      this._checkPatternCoverage(context),
    ];

    const passed = checks.every((c) => c.status === 'pass');

    return {
      passed,
      checks,
      retryCount: 0,
      qualityFlag: passed ? 'good' : 'degraded',
      failureReasons: checks.filter((c) => c.status === 'fail').map((c) => c.reason ?? ''),
    };
  }

  /**
   * Orchestrates extraction with retry logic.
   * extractFn is called with a progressively reduced token budget on each attempt.
   * Returns the final context and reflection result.
   */
  async runWithReflection(
    extractFn: (tokenBudget: number) => Promise<ExtractedPRContext>,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ context: ExtractedPRContext; reflection: ReflectionResult }> {
    if (!this.config.enabled) {
      const context = await extractFn(this.config.tokenBudget);
      return {
        context,
        reflection: {
          passed: true,
          checks: [],
          retryCount: 0,
          qualityFlag: 'good',
          failureReasons: [],
        },
      };
    }

    let budget = this.config.tokenBudget;
    let lastContext: ExtractedPRContext | null = null;
    let lastResult: ReflectionResult | null = null;
    let retryCount = 0;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const context = await extractFn(budget);
      const result = this.validate(context);

      lastContext = context;
      lastResult = { ...result, retryCount };

      if (result.passed) {
        return { context, reflection: lastResult };
      }

      if (attempt < this.config.maxRetries) {
        budget = Math.floor(budget * this.config.retryBudgetFactor);
        retryCount++;
      }
    }

    const degradedReflection: ReflectionResult = {
      ...lastResult!,
      qualityFlag: 'degraded',
      retryCount,
    };

    await this._logDegradedResult(degradedReflection, owner, repo, prNumber);

    return { context: lastContext!, reflection: degradedReflection };
  }

  /**
   * Returns the narrowed token budget for a given retry attempt.
   * Useful for callers building retry-aware extraction configs.
   */
  budgetForAttempt(attempt: number): number {
    let budget = this.config.tokenBudget;
    for (let i = 0; i < attempt; i++) {
      budget = Math.floor(budget * this.config.retryBudgetFactor);
    }
    return budget;
  }

  private _checkTokenBudget(context: ExtractedPRContext): QualityCheckResult {
    const tokens = context.tokenBudget?.totalTokens ?? 0;
    const threshold = this.config.tokenBudget;
    const status: QualityCheckStatus = tokens <= threshold ? 'pass' : 'fail';
    return {
      name: 'token_budget',
      status,
      reason: status === 'fail' ? `Token count ${tokens} exceeds budget of ${threshold}` : null,
      measuredValue: tokens,
      threshold,
    };
  }

  private _checkFieldCompleteness(context: ExtractedPRContext): QualityCheckResult {
    const checks = [
      {
        field: 'changedFiles',
        present:
          Array.isArray((context as any).changedFiles) && (context as any).changedFiles.length > 0,
      },
      {
        field: 'parsedDiffs',
        present:
          Array.isArray((context as any).parsedDiffs) && (context as any).parsedDiffs.length > 0,
      },
      {
        field: 'commits',
        present: Array.isArray((context as any).commits) && (context as any).commits.length > 0,
      },
      { field: 'issueReferences', present: Array.isArray((context as any).issueReferences) },
    ];

    const presentCount = checks.filter((c) => c.present).length;
    const missingFields = checks.filter((c) => !c.present).map((c) => c.field);
    const status: QualityCheckStatus = missingFields.length === 0 ? 'pass' : 'fail';

    return {
      name: 'field_completeness',
      status,
      reason: status === 'fail' ? `Missing or empty fields: ${missingFields.join(', ')}` : null,
      measuredValue: presentCount,
      threshold: checks.length,
    };
  }

  private _checkPatternCoverage(context: ExtractedPRContext): QualityCheckResult {
    const patternCount = context.detectedPatterns?.length ?? 0;
    const threshold = 1;
    const status: QualityCheckStatus = patternCount >= threshold ? 'pass' : 'fail';
    return {
      name: 'pattern_coverage',
      status,
      reason:
        status === 'fail' ? `No code patterns detected (expected at least ${threshold})` : null,
      measuredValue: patternCount,
      threshold,
    };
  }

  private async _logDegradedResult(
    reflection: ReflectionResult,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<void> {
    if (!this.loggingAdapter) return;
    try {
      const entry: ReflectionTelemetryEntry = {
        id: `reflection-${owner}-${repo}-${prNumber}-${Date.now()}`,
        type: 'reflection-failure',
        owner,
        repo,
        prNumber,
        qualityFlag: reflection.qualityFlag,
        failureReasons: reflection.failureReasons,
        retryCount: reflection.retryCount,
        checks: reflection.checks,
        loggedAt: new Date().toISOString(),
      };
      await this.loggingAdapter.log(entry);
    } catch {
      // non-fatal — never throw from telemetry
    }
  }
}
