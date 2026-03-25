import { expect } from 'chai';
import * as sinon from 'sinon';
import { PRContextReflectionService } from './pr.context.reflection.service';
import { DEFAULT_REFLECTION_CONFIG } from './pr.context.reflection.types';
import { ExtractedPRContext } from './pr.context.types';

function makeContext(overrides: Record<string, any> = {}): ExtractedPRContext {
  const base: Record<string, any> = {
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: test PR',
    prAuthor: 'dev',
    prState: 'open',
    headBranch: 'feature',
    baseBranch: 'main',
    changedFiles: [
      {
        path: 'src/auth.ts',
        changeType: 'modified',
        additions: 10,
        deletions: 2,
        language: 'typescript',
        isTest: false,
        isConfig: false,
      },
    ],
    parsedDiffs: [{ path: 'src/auth.ts', hunks: [], truncated: false }],
    commits: [{ sha: 'abc123', subject: 'feat: add auth', body: null, author: 'dev' }],
    issueReferences: [],
    detectedPatterns: [
      { type: 'async_await', files: ['src/auth.ts'], occurrences: 3, example: null },
    ],
    tokenBudget: { totalTokens: 1000, wasTruncated: false, budgetLimit: 6000, breakdown: {} },
    extractedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
  };
  return { ...base, ...overrides } as unknown as ExtractedPRContext;
}

function makeService(configOverrides = {}, loggingAdapter?: any) {
  return new PRContextReflectionService(configOverrides, loggingAdapter);
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('PRContextReflectionService', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      expect(makeService()).to.be.instanceOf(PRContextReflectionService);
    });

    it('uses DEFAULT_REFLECTION_CONFIG when no config provided', () => {
      const svc = makeService();
      expect(svc.budgetForAttempt(0)).to.equal(DEFAULT_REFLECTION_CONFIG.tokenBudget);
    });

    it('accepts custom tokenBudget', () => {
      const svc = makeService({ tokenBudget: 3000 });
      expect(svc.budgetForAttempt(0)).to.equal(3000);
    });

    it('accepts custom maxRetries', () => {
      const svc = makeService({ maxRetries: 1 });
      expect(svc).to.be.instanceOf(PRContextReflectionService);
    });

    it('accepts enabled: false', () => {
      const svc = makeService({ enabled: false });
      expect(svc).to.be.instanceOf(PRContextReflectionService);
    });
  });

  describe('validate()', () => {
    it('returns passed: true for a healthy context', () => {
      const result = makeService().validate(makeContext());
      expect(result.passed).to.be.true;
    });

    it('returns qualityFlag: good when all checks pass', () => {
      const result = makeService().validate(makeContext());
      expect(result.qualityFlag).to.equal('good');
    });

    it('returns three check results', () => {
      const result = makeService().validate(makeContext());
      expect(result.checks).to.have.length(3);
    });

    it('returns empty failureReasons when all pass', () => {
      const result = makeService().validate(makeContext());
      expect(result.failureReasons).to.be.empty;
    });

    it('token_budget check passes when tokens ≤ budget', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 5999,
          wasTruncated: false,
          budgetLimit: 6000,
          breakdown: {} as any,
        },
      });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'token_budget')!;
      expect(check.status).to.equal('pass');
    });

    it('token_budget check passes when tokens equal budget', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 6000,
          wasTruncated: false,
          budgetLimit: 6000,
          breakdown: {} as any,
        },
      });
      const result = makeService({ tokenBudget: 6000 }).validate(ctx);
      const check = result.checks.find((c) => c.name === 'token_budget')!;
      expect(check.status).to.equal('pass');
    });

    it('token_budget check fails when tokens exceed budget', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 7000,
          wasTruncated: false,
          budgetLimit: 6000,
          breakdown: {} as any,
        },
      });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'token_budget')!;
      expect(check.status).to.equal('fail');
    });

    it('token_budget check failure reason mentions token count', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 7000,
          wasTruncated: false,
          budgetLimit: 6000,
          breakdown: {} as any,
        },
      });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'token_budget')!;
      expect(check.reason).to.include('7000');
    });

    it('token_budget check respects custom budget', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 2500,
          wasTruncated: false,
          budgetLimit: 3000,
          breakdown: {} as any,
        },
      });
      const result = makeService({ tokenBudget: 2000 }).validate(ctx);
      const check = result.checks.find((c) => c.name === 'token_budget')!;
      expect(check.status).to.equal('fail');
    });

    it('field_completeness check passes when all fields present', () => {
      const result = makeService().validate(makeContext());
      const check = result.checks.find((c) => c.name === 'field_completeness')!;
      expect(check.status).to.equal('pass');
    });

    it('field_completeness check fails when changedFiles is empty', () => {
      const ctx = makeContext({ changedFiles: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'field_completeness')!;
      expect(check.status).to.equal('fail');
    });

    it('field_completeness check fails when parsedDiffs is empty', () => {
      const ctx = makeContext({ parsedDiffs: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'field_completeness')!;
      expect(check.status).to.equal('fail');
    });

    it('field_completeness check fails when commitMessages is empty', () => {
      const ctx = makeContext({ commits: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'field_completeness')!;
      expect(check.status).to.equal('fail');
    });

    it('field_completeness check failure reason lists missing field names', () => {
      const ctx = makeContext({ changedFiles: [], parsedDiffs: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'field_completeness')!;
      expect(check.reason).to.include('changedFiles');
      expect(check.reason).to.include('parsedDiffs');
    });

    it('field_completeness check passes when issueReferences is empty array', () => {
      const ctx = makeContext({ issueReferences: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'field_completeness')!;
      expect(check.status).to.equal('pass');
    });

    it('pattern_coverage check passes when at least one pattern detected', () => {
      const result = makeService().validate(makeContext());
      const check = result.checks.find((c) => c.name === 'pattern_coverage')!;
      expect(check.status).to.equal('pass');
    });

    it('pattern_coverage check fails when no patterns detected', () => {
      const ctx = makeContext({ detectedPatterns: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'pattern_coverage')!;
      expect(check.status).to.equal('fail');
    });

    it('pattern_coverage check reports measuredValue of 0 when no patterns', () => {
      const ctx = makeContext({ detectedPatterns: [] });
      const result = makeService().validate(ctx);
      const check = result.checks.find((c) => c.name === 'pattern_coverage')!;
      expect(check.measuredValue).to.equal(0);
    });

    it('pattern_coverage check failure sets passed: false on result', () => {
      const ctx = makeContext({ detectedPatterns: [] });
      const result = makeService().validate(ctx);
      expect(result.passed).to.be.false;
    });

    it('pattern_coverage failure is included in failureReasons', () => {
      const ctx = makeContext({ detectedPatterns: [] });
      const result = makeService().validate(ctx);
      expect(result.failureReasons).to.have.length(1);
      expect(result.failureReasons[0]).to.include('pattern');
    });
  });

  describe('budgetForAttempt()', () => {
    it('returns full budget for attempt 0', () => {
      const svc = makeService({ tokenBudget: 6000 });
      expect(svc.budgetForAttempt(0)).to.equal(6000);
    });

    it('reduces budget by retryBudgetFactor for attempt 1', () => {
      const svc = makeService({ tokenBudget: 6000, retryBudgetFactor: 0.75 });
      expect(svc.budgetForAttempt(1)).to.equal(4500);
    });

    it('reduces budget compoundly for attempt 2', () => {
      const svc = makeService({ tokenBudget: 6000, retryBudgetFactor: 0.75 });
      expect(svc.budgetForAttempt(2)).to.equal(3375);
    });

    it('respects custom retryBudgetFactor', () => {
      const svc = makeService({ tokenBudget: 4000, retryBudgetFactor: 0.5 });
      expect(svc.budgetForAttempt(1)).to.equal(2000);
    });
  });

  describe('runWithReflection()', () => {
    it('returns context and reflection on first-pass success', async () => {
      const ctx = makeContext();
      const extractFn = sinon.stub().resolves(ctx);
      const { context, reflection } = await makeService().runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      expect(context).to.deep.equal(ctx);
      expect(reflection.passed).to.be.true;
    });

    it('calls extractFn once when first pass succeeds', async () => {
      const extractFn = sinon.stub().resolves(makeContext());
      await makeService().runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(extractFn.calledOnce).to.be.true;
    });

    it('passes full tokenBudget on first attempt', async () => {
      const extractFn = sinon.stub().resolves(makeContext());
      await makeService({ tokenBudget: 6000 }).runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(extractFn.firstCall.args[0]).to.equal(6000);
    });

    it('retries with reduced budget when first pass fails', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const goodCtx = makeContext();
      const extractFn = sinon.stub();
      extractFn.onFirstCall().resolves(badCtx);
      extractFn.onSecondCall().resolves(goodCtx);
      const { reflection } = await makeService({
        tokenBudget: 6000,
        retryBudgetFactor: 0.75,
      }).runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(extractFn.calledTwice).to.be.true;
      expect(extractFn.secondCall.args[0]).to.equal(4500);
      expect(reflection.passed).to.be.true;
    });

    it('sets retryCount to 0 when first pass succeeds', async () => {
      const extractFn = sinon.stub().resolves(makeContext());
      const { reflection } = await makeService().runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(reflection.retryCount).to.equal(0);
    });

    it('sets retryCount to 1 after one retry', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const goodCtx = makeContext();
      const extractFn = sinon.stub();
      extractFn.onFirstCall().resolves(badCtx);
      extractFn.onSecondCall().resolves(goodCtx);
      const { reflection } = await makeService().runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(reflection.retryCount).to.equal(1);
    });

    it('marks qualityFlag as degraded when retries exhausted', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const { reflection } = await makeService({ maxRetries: 2 }).runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      expect(reflection.qualityFlag).to.equal('degraded');
    });

    it('calls extractFn maxRetries+1 times when all attempts fail', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      await makeService({ maxRetries: 2 }).runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(extractFn.callCount).to.equal(3); // initial + 2 retries
    });

    it('returns last context when retries exhausted', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const { context } = await makeService({ maxRetries: 1 }).runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      expect(context).to.deep.equal(badCtx);
    });

    it('logs degraded result to telemetry adapter', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const loggingAdapter = { log: sinon.stub().resolves() };
      await makeService({ maxRetries: 1 }, loggingAdapter).runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      expect(loggingAdapter.log.calledOnce).to.be.true;
    });

    it('telemetry entry contains owner, repo, prNumber', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const loggingAdapter = { log: sinon.stub().resolves() };
      await makeService({ maxRetries: 1 }, loggingAdapter).runWithReflection(
        extractFn,
        'owner',
        'repo',
        99
      );
      const entry = loggingAdapter.log.firstCall.args[0];
      expect(entry.owner).to.equal('owner');
      expect(entry.repo).to.equal('repo');
      expect(entry.prNumber).to.equal(99);
    });

    it('telemetry entry type is reflection-failure', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const loggingAdapter = { log: sinon.stub().resolves() };
      await makeService({ maxRetries: 1 }, loggingAdapter).runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      const entry = loggingAdapter.log.firstCall.args[0];
      expect(entry.type).to.equal('reflection-failure');
    });

    it('does not call loggingAdapter when first pass succeeds', async () => {
      const extractFn = sinon.stub().resolves(makeContext());
      const loggingAdapter = { log: sinon.stub().resolves() };
      await makeService({}, loggingAdapter).runWithReflection(extractFn, 'owner', 'repo', 42);
      expect(loggingAdapter.log.called).to.be.false;
    });

    it('does not throw when loggingAdapter.log throws', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const loggingAdapter = { log: sinon.stub().rejects(new Error('DB down')) };
      let threw = false;
      try {
        await makeService({ maxRetries: 1 }, loggingAdapter).runWithReflection(
          extractFn,
          'owner',
          'repo',
          42
        );
      } catch {
        threw = true;
      }
      expect(threw).to.be.false;
    });

    it('skips validation entirely when enabled: false', async () => {
      const badCtx = makeContext({ detectedPatterns: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const { reflection } = await makeService({ enabled: false }).runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      expect(reflection.passed).to.be.true;
      expect(reflection.qualityFlag).to.equal('good');
      expect(extractFn.calledOnce).to.be.true;
    });

    it('reflection result includes failureReasons when degraded', async () => {
      const badCtx = makeContext({ detectedPatterns: [], changedFiles: [] });
      const extractFn = sinon.stub().resolves(badCtx);
      const { reflection } = await makeService({ maxRetries: 1 }).runWithReflection(
        extractFn,
        'owner',
        'repo',
        42
      );
      expect(reflection.failureReasons.length).to.be.greaterThan(0);
    });
  });

  describe('DEFAULT_REFLECTION_CONFIG', () => {
    it('tokenBudget is 6000', () => {
      expect(DEFAULT_REFLECTION_CONFIG.tokenBudget).to.equal(6000);
    });

    it('maxRetries is 2', () => {
      expect(DEFAULT_REFLECTION_CONFIG.maxRetries).to.equal(2);
    });

    it('retryBudgetFactor is 0.75', () => {
      expect(DEFAULT_REFLECTION_CONFIG.retryBudgetFactor).to.equal(0.75);
    });

    it('enabled is true', () => {
      expect(DEFAULT_REFLECTION_CONFIG.enabled).to.be.true;
    });
  });
});
