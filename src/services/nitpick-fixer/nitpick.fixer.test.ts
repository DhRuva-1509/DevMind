import { expect } from 'chai';
import * as sinon from 'sinon';
import { NitpickFixerAgent } from './nitpick.fixer.agent';
import {
  LinterAdapter,
  GitAdapter,
  ConfirmAdapter,
  LoggingAdapter,
  NitpickFixerError,
  DEFAULT_COMMIT_MESSAGE,
} from './nitpick.fixer.types';
import { LinterSuiteResult, AppliedFix } from '../linter/linter.integration.types';

function makeFix(overrides: Partial<AppliedFix> = {}): AppliedFix {
  return {
    linter: 'eslint',
    filePath: '/project/src/auth.ts',
    ruleId: 'no-unused-vars',
    description: 'Fixed no-unused-vars',
    ...overrides,
  };
}

function makeSuiteResult(overrides: Partial<LinterSuiteResult> = {}): LinterSuiteResult {
  return {
    cwd: '/project',
    results: [],
    allFixes: [makeFix()],
    totalRemainingIssues: 0,
    completedAt: new Date().toISOString(),
    durationMs: 100,
    ...overrides,
  };
}

function makeCleanSuiteResult(): LinterSuiteResult {
  return makeSuiteResult({ allFixes: [], totalRemainingIssues: 0 });
}

function makeLinterAdapter(overrides: Partial<LinterAdapter> = {}): LinterAdapter {
  return {
    runAll: sinon.stub().resolves(makeSuiteResult()),
    ...overrides,
  };
}

function makeGitAdapter(overrides: Partial<GitAdapter> = {}): GitAdapter {
  return {
    getDiff: sinon
      .stub()
      .resolves('diff --git a/src/auth.ts b/src/auth.ts\n+fixed line\n-old line\n'),
    stageAll: sinon.stub().resolves(),
    commit: sinon.stub().resolves(),
    getLastCommitSha: sinon.stub().resolves('abc1234'),
    ...overrides,
  };
}

function makeConfirmAdapter(accepts = true): ConfirmAdapter {
  return {
    confirm: sinon.stub().resolves(accepts),
  };
}

function makeLoggingAdapter(): LoggingAdapter {
  return {
    log: sinon.stub().resolves(),
  };
}

function makeAgent(
  overrides: {
    linter?: Partial<LinterAdapter>;
    git?: Partial<GitAdapter>;
    confirm?: boolean;
    logging?: LoggingAdapter;
    config?: object;
  } = {}
): NitpickFixerAgent {
  return new NitpickFixerAgent(
    { cwd: '/project', enableLogging: false, enableConsoleLogging: false, ...overrides.config },
    makeLinterAdapter(overrides.linter ?? {}),
    makeGitAdapter(overrides.git ?? {}),
    makeConfirmAdapter(overrides.confirm ?? true),
    overrides.logging
  );
}

describe('NitpickFixerAgent', () => {
  describe('constructor', () => {
    it('creates an instance with default config', () => {
      const agent = makeAgent();
      expect(agent).to.be.instanceOf(NitpickFixerAgent);
    });

    it('accepts autoCommitEnabled: false', () => {
      const agent = makeAgent({ config: { autoCommitEnabled: false } });
      expect(agent).to.be.instanceOf(NitpickFixerAgent);
    });

    it('accepts custom commitMessage', () => {
      const agent = makeAgent({ config: { commitMessage: 'chore: lint fixes' } });
      expect(agent).to.be.instanceOf(NitpickFixerAgent);
    });

    it('accepts stageAll: false', () => {
      const agent = makeAgent({ config: { stageAll: false } });
      expect(agent).to.be.instanceOf(NitpickFixerAgent);
    });

    it('accepts custom lintPaths', () => {
      const agent = makeAgent({ config: { lintPaths: ['src', 'lib'] } });
      expect(agent).to.be.instanceOf(NitpickFixerAgent);
    });

    it('accepts enableLogging: true', () => {
      const agent = makeAgent({ config: { enableLogging: true } });
      expect(agent).to.be.instanceOf(NitpickFixerAgent);
    });
  });

  describe('run() — result shape', () => {
    it('returns a NitpickResult with correct keys', async () => {
      const agent = makeAgent();
      const result = await agent.run('command', '/project');
      expect(result).to.have.keys([
        'status',
        'trigger',
        'cwd',
        'linterResult',
        'diff',
        'confirmation',
        'commitSha',
        'commitMessage',
        'appliedFixes',
        'remainingIssues',
        'summary',
        'errorMessage',
        'durationMs',
        'completedAt',
      ]);
    });

    it('sets trigger on result', async () => {
      const agent = makeAgent();
      const result = await agent.run('command', '/project');
      expect(result.trigger).to.equal('command');
    });

    it('sets trigger: pre-commit', async () => {
      const agent = makeAgent();
      const result = await agent.run('pre-commit', '/project');
      expect(result.trigger).to.equal('pre-commit');
    });

    it('sets trigger: chat', async () => {
      const agent = makeAgent();
      const result = await agent.run('chat', '/project');
      expect(result.trigger).to.equal('chat');
    });

    it('sets cwd on result', async () => {
      const agent = makeAgent();
      const result = await agent.run('command', '/project');
      expect(result.cwd).to.equal('/project');
    });

    it('sets completedAt as ISO string', async () => {
      const agent = makeAgent();
      const result = await agent.run('command', '/project');
      expect(new Date(result.completedAt).toISOString()).to.equal(result.completedAt);
    });

    it('sets durationMs >= 0', async () => {
      const agent = makeAgent();
      const result = await agent.run('command', '/project');
      expect(result.durationMs).to.be.at.least(0);
    });

    it('sets summary as non-empty string', async () => {
      const agent = makeAgent();
      const result = await agent.run('command', '/project');
      expect(result.summary).to.be.a('string').and.have.length.above(0);
    });
  });

  describe('run() — clean project (no fixes needed)', () => {
    it('returns status: clean when no fixes applied', async () => {
      const agent = makeAgent({
        linter: { runAll: sinon.stub().resolves(makeCleanSuiteResult()) },
      });
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('clean');
    });

    it('sets appliedFixes to empty array', async () => {
      const agent = makeAgent({
        linter: { runAll: sinon.stub().resolves(makeCleanSuiteResult()) },
      });
      const result = await agent.run('command', '/project');
      expect(result.appliedFixes).to.have.length(0);
    });

    it('sets diff to null for clean result', async () => {
      const agent = makeAgent({
        linter: { runAll: sinon.stub().resolves(makeCleanSuiteResult()) },
      });
      const result = await agent.run('command', '/project');
      expect(result.diff).to.be.null;
    });

    it('sets confirmation to null for clean result', async () => {
      const agent = makeAgent({
        linter: { runAll: sinon.stub().resolves(makeCleanSuiteResult()) },
      });
      const result = await agent.run('command', '/project');
      expect(result.confirmation).to.be.null;
    });

    it('does not call confirmAdapter when project is clean', async () => {
      const confirm = makeConfirmAdapter(true);
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter({ runAll: sinon.stub().resolves(makeCleanSuiteResult()) }),
        makeGitAdapter(),
        confirm
      );
      await agent.run('command', '/project');
      expect((confirm.confirm as sinon.SinonStub).called).to.be.false;
    });

    it('does not call gitAdapter.commit when project is clean', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter({ runAll: sinon.stub().resolves(makeCleanSuiteResult()) }),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      expect((git.commit as sinon.SinonStub).called).to.be.false;
    });
  });

  describe('run() — no linters detected', () => {
    it('returns status: no_linters when NoLintersDetectedError thrown', async () => {
      const err: any = new Error('No linter config files found');
      err.code = 'NO_LINTERS_DETECTED';
      err.name = 'NoLintersDetectedError';
      const agent = makeAgent({ linter: { runAll: sinon.stub().rejects(err) } });
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('no_linters');
    });

    it('sets errorMessage for no_linters result', async () => {
      const err: any = new Error('No linter config files found');
      err.code = 'NO_LINTERS_DETECTED';
      err.name = 'NoLintersDetectedError';
      const agent = makeAgent({ linter: { runAll: sinon.stub().rejects(err) } });
      const result = await agent.run('command', '/project');
      expect(result.errorMessage).to.be.a('string');
    });

    it('sets linterResult to null for no_linters', async () => {
      const err: any = new Error('No linter config files found');
      err.name = 'NoLintersDetectedError';
      const agent = makeAgent({ linter: { runAll: sinon.stub().rejects(err) } });
      const result = await agent.run('command', '/project');
      expect(result.linterResult).to.be.null;
    });
  });

  describe('run() — HITL confirmation (AC-8)', () => {
    it('calls confirmAdapter.confirm with diff and summary', async () => {
      const confirm = makeConfirmAdapter(true);
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        confirm
      );
      await agent.run('command', '/project');
      expect((confirm.confirm as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('passes NitpickDiff as first arg to confirm', async () => {
      const confirm = makeConfirmAdapter(true);
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        confirm
      );
      await agent.run('command', '/project');
      const [diff] = (confirm.confirm as sinon.SinonStub).firstCall.args;
      expect(diff).to.have.keys(['files', 'totalFiles', 'totalAdditions', 'totalDeletions', 'raw']);
    });

    it('passes summary string as second arg to confirm', async () => {
      const confirm = makeConfirmAdapter(true);
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        confirm
      );
      await agent.run('command', '/project');
      const [, summary] = (confirm.confirm as sinon.SinonStub).firstCall.args;
      expect(summary).to.be.a('string');
    });

    it('returns status: rejected when user rejects', async () => {
      const agent = makeAgent({ confirm: false });
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('rejected');
    });

    it('sets confirmation.outcome: rejected when user rejects', async () => {
      const agent = makeAgent({ confirm: false });
      const result = await agent.run('command', '/project');
      expect(result.confirmation?.outcome).to.equal('rejected');
    });

    it('sets confirmation.outcome: accepted when user accepts', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.confirmation?.outcome).to.equal('accepted');
    });

    it('sets confirmation.decidedAt as ISO string', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(new Date(result.confirmation!.decidedAt).toISOString()).to.equal(
        result.confirmation!.decidedAt
      );
    });

    it('does NOT commit when user rejects', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(false)
      );
      await agent.run('command', '/project');
      expect((git.commit as sinon.SinonStub).called).to.be.false;
    });

    it('appliedFixes is populated even when user rejects', async () => {
      const agent = makeAgent({ confirm: false });
      const result = await agent.run('command', '/project');
      expect(result.appliedFixes.length).to.be.above(0);
    });
  });

  describe('run() — commit flow (AC-5, AC-6)', () => {
    it('returns status: committed when accepted and autoCommitEnabled', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('committed');
    });

    it('calls gitAdapter.stageAll when stageAll is true', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', stageAll: true, enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      expect((git.stageAll as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('does not call gitAdapter.stageAll when stageAll is false', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', stageAll: false, enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      expect((git.stageAll as sinon.SinonStub).called).to.be.false;
    });

    it('calls gitAdapter.commit with default message', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      const [msg] = (git.commit as sinon.SinonStub).firstCall.args;
      expect(msg).to.equal(DEFAULT_COMMIT_MESSAGE);
    });

    it('calls gitAdapter.commit with custom message', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        {
          cwd: '/project',
          commitMessage: 'chore: lint',
          enableLogging: false,
          enableConsoleLogging: false,
        },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      const [msg] = (git.commit as sinon.SinonStub).firstCall.args;
      expect(msg).to.equal('chore: lint');
    });

    it('sets commitSha from getLastCommitSha', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.commitSha).to.equal('abc1234');
    });

    it('sets commitMessage on committed result', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.commitMessage).to.equal(DEFAULT_COMMIT_MESSAGE);
    });

    it('returns status: fixed when accepted but autoCommitEnabled: false', async () => {
      const agent = makeAgent({ confirm: true, config: { autoCommitEnabled: false } });
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('fixed');
    });

    it('does not commit when autoCommitEnabled: false', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        {
          cwd: '/project',
          autoCommitEnabled: false,
          enableLogging: false,
          enableConsoleLogging: false,
        },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      expect((git.commit as sinon.SinonStub).called).to.be.false;
    });

    it('sets commitSha: null when autoCommitEnabled: false', async () => {
      const agent = makeAgent({ confirm: true, config: { autoCommitEnabled: false } });
      const result = await agent.run('command', '/project');
      expect(result.commitSha).to.be.null;
    });

    it('returns status: failed when commit throws', async () => {
      const git = makeGitAdapter({ commit: sinon.stub().rejects(new Error('nothing to commit')) });
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('failed');
    });

    it('sets errorMessage when commit throws', async () => {
      const git = makeGitAdapter({ commit: sinon.stub().rejects(new Error('nothing to commit')) });
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      const result = await agent.run('command', '/project');
      expect(result.errorMessage).to.include('Commit failed');
    });
  });

  describe('run() — diff generation', () => {
    it('calls gitAdapter.getDiff after running linters', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.run('command', '/project');
      expect((git.getDiff as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('sets diff on result when fixes applied', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.diff).to.not.be.null;
    });

    it('diff has correct shape', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.diff).to.have.keys([
        'files',
        'totalFiles',
        'totalAdditions',
        'totalDeletions',
        'raw',
      ]);
    });

    it('diff.files is an array', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.diff?.files).to.be.an('array');
    });

    it('diff.totalFiles > 0 when fixes applied', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.diff?.totalFiles).to.be.above(0);
    });

    it('uses synthetic diff when getDiff throws', async () => {
      const git = makeGitAdapter({ getDiff: sinon.stub().rejects(new Error('not a git repo')) });
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      const result = await agent.run('command', '/project');
      expect(result.diff).to.not.be.null;
      expect(result.status).to.equal('committed');
    });

    it('synthetic diff has files from appliedFixes', async () => {
      const git = makeGitAdapter({ getDiff: sinon.stub().rejects(new Error('not a git repo')) });
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter({
          runAll: sinon.stub().resolves(
            makeSuiteResult({
              allFixes: [
                makeFix({ filePath: '/project/src/auth.ts' }),
                makeFix({ filePath: '/project/src/api.ts' }),
              ],
            })
          ),
        }),
        git,
        makeConfirmAdapter(true)
      );
      const result = await agent.run('command', '/project');
      expect(result.diff?.totalFiles).to.equal(2);
    });
  });

  describe('run() — linter results', () => {
    it('sets linterResult on result', async () => {
      const agent = makeAgent({ confirm: true });
      const result = await agent.run('command', '/project');
      expect(result.linterResult).to.not.be.null;
    });

    it('sets appliedFixes from linter suite', async () => {
      const fixes = [makeFix(), makeFix({ filePath: '/project/src/api.ts' })];
      const agent = makeAgent({
        confirm: true,
        linter: { runAll: sinon.stub().resolves(makeSuiteResult({ allFixes: fixes })) },
      });
      const result = await agent.run('command', '/project');
      expect(result.appliedFixes).to.have.length(2);
    });

    it('sets remainingIssues from linter suite', async () => {
      const agent = makeAgent({
        confirm: true,
        linter: { runAll: sinon.stub().resolves(makeSuiteResult({ totalRemainingIssues: 5 })) },
      });
      const result = await agent.run('command', '/project');
      expect(result.remainingIssues).to.equal(5);
    });

    it('returns status: failed when linter throws unexpected error', async () => {
      const agent = makeAgent({
        linter: { runAll: sinon.stub().rejects(new Error('unexpected')) },
      });
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('failed');
    });

    it('sets errorMessage when linter throws', async () => {
      const agent = makeAgent({ linter: { runAll: sinon.stub().rejects(new Error('disk full')) } });
      const result = await agent.run('command', '/project');
      expect(result.errorMessage).to.be.a('string');
    });
  });

  describe('parseDiff()', () => {
    it('returns NitpickDiff with correct shape', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n+added line\n-removed line\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff).to.have.keys(['files', 'totalFiles', 'totalAdditions', 'totalDeletions', 'raw']);
    });

    it('parses file path from diff header', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n@@ -1,1 +1,1 @@\n+new\n-old\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.files[0].filePath).to.equal('src/auth.ts');
    });

    it('counts additions correctly', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n+line1\n+line2\n-removed\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.totalAdditions).to.equal(2);
    });

    it('counts deletions correctly', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n+added\n-rem1\n-rem2\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.totalDeletions).to.equal(2);
    });

    it('returns synthetic diff when raw is empty', () => {
      const agent = makeAgent();
      const diff = agent.parseDiff('', [makeFix()]);
      expect(diff.files.length).to.be.above(0);
    });

    it('sets raw on diff', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n+x\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.raw).to.equal(raw);
    });

    it('handles multiple files in diff', () => {
      const agent = makeAgent();
      const raw = [
        'diff --git a/src/auth.ts b/src/auth.ts\n+a\n',
        'diff --git a/src/api.ts b/src/api.ts\n+b\n',
      ].join('');
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.totalFiles).to.equal(2);
    });

    it('does not count +++ lines as additions', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n+++ b/src/auth.ts\n+actual add\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.totalAdditions).to.equal(1);
    });

    it('does not count --- lines as deletions', () => {
      const agent = makeAgent();
      const raw = 'diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n-actual del\n';
      const diff = agent.parseDiff(raw, [makeFix()]);
      expect(diff.totalDeletions).to.equal(1);
    });
  });

  describe('buildSummary()', () => {
    it('returns non-empty string', () => {
      const agent = makeAgent();
      expect(agent.buildSummary([makeFix()], 0))
        .to.be.a('string')
        .with.length.above(0);
    });

    it('returns clean message when no fixes', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([], 0);
      expect(msg.toLowerCase()).to.include('clean');
    });

    it('includes fix count', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([makeFix(), makeFix()], 0);
      expect(msg).to.include('2');
    });

    it('includes file count', () => {
      const agent = makeAgent();
      const fixes = [
        makeFix({ filePath: '/project/src/a.ts' }),
        makeFix({ filePath: '/project/src/b.ts' }),
      ];
      const msg = agent.buildSummary(fixes, 0);
      expect(msg).to.include('2');
    });

    it('includes linter name in breakdown', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([makeFix({ linter: 'prettier' })], 0);
      expect(msg).to.include('prettier');
    });

    it('mentions remaining issues when > 0', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([makeFix()], 3);
      expect(msg).to.include('3');
    });

    it('does not mention remaining when 0', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([makeFix()], 0);
      expect(msg.toLowerCase()).to.not.include('manual');
    });

    it('uses singular for 1 fix', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([makeFix()], 0);
      expect(msg).to.match(/1 issue fixed/);
    });

    it('uses plural for multiple fixes', () => {
      const agent = makeAgent();
      const msg = agent.buildSummary([makeFix(), makeFix()], 0);
      expect(msg).to.match(/2 issues fixed/);
    });
  });

  describe('preview()', () => {
    it('returns linterResult, diff, and summary', async () => {
      const agent = makeAgent();
      const result = await agent.preview('/project');
      expect(result).to.have.keys(['linterResult', 'diff', 'summary']);
    });

    it('does not call confirmAdapter', async () => {
      const confirm = makeConfirmAdapter(true);
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        confirm
      );
      await agent.preview('/project');
      expect((confirm.confirm as sinon.SinonStub).called).to.be.false;
    });

    it('does not call gitAdapter.commit', async () => {
      const git = makeGitAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        git,
        makeConfirmAdapter(true)
      );
      await agent.preview('/project');
      expect((git.commit as sinon.SinonStub).called).to.be.false;
    });

    it('sets summary as a string', async () => {
      const agent = makeAgent();
      const result = await agent.preview('/project');
      expect(result.summary).to.be.a('string');
    });

    it('sets diff with correct shape', async () => {
      const agent = makeAgent();
      const result = await agent.preview('/project');
      expect(result.diff).to.have.keys([
        'files',
        'totalFiles',
        'totalAdditions',
        'totalDeletions',
        'raw',
      ]);
    });
  });

  describe('telemetry logging (AC-7)', () => {
    it('calls loggingAdapter.log on committed result', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      await agent.run('command', '/project');
      expect((logging.log as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('calls loggingAdapter.log on rejected result', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(false),
        logging
      );
      await agent.run('command', '/project');
      expect((logging.log as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('calls loggingAdapter.log on clean result', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter({ runAll: sinon.stub().resolves(makeCleanSuiteResult()) }),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      await agent.run('command', '/project');
      expect((logging.log as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('log entry has type nitpick-run', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      await agent.run('command', '/project');
      const [entry] = (logging.log as sinon.SinonStub).firstCall.args;
      expect(entry.type).to.equal('nitpick-run');
    });

    it('log entry includes status', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      await agent.run('command', '/project');
      const [entry] = (logging.log as sinon.SinonStub).firstCall.args;
      expect(entry.status).to.be.a('string');
    });

    it('log entry includes trigger', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      await agent.run('command', '/project');
      const [entry] = (logging.log as sinon.SinonStub).firstCall.args;
      expect(entry.trigger).to.equal('command');
    });

    it('sets telemetryId on result when logging succeeds', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      const result = await agent.run('command', '/project');
      expect(result.telemetryId).to.be.a('string');
    });

    it('does not throw when loggingAdapter.log fails', async () => {
      const logging = { log: sinon.stub().rejects(new Error('DB down')) };
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('committed');
    });

    it('does not call loggingAdapter when enableLogging is false', async () => {
      const logging = makeLoggingAdapter();
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: false, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true),
        logging
      );
      await agent.run('command', '/project');
      expect((logging.log as sinon.SinonStub).called).to.be.false;
    });

    it('does not throw when no loggingAdapter provided', async () => {
      const agent = new NitpickFixerAgent(
        { cwd: '/project', enableLogging: true, enableConsoleLogging: false },
        makeLinterAdapter(),
        makeGitAdapter(),
        makeConfirmAdapter(true)
        // no logging adapter
      );
      const result = await agent.run('command', '/project');
      expect(result.status).to.equal('committed');
    });
  });

  describe('NitpickFixerError', () => {
    it('has correct name', () => {
      const err = new NitpickFixerError('msg', 'COMMIT_FAILED');
      expect(err.name).to.equal('NitpickFixerError');
    });

    it('exposes code property', () => {
      const err = new NitpickFixerError('msg', 'LINTER_FAILED');
      expect(err.code).to.equal('LINTER_FAILED');
    });

    it('exposes cause property', () => {
      const cause = new Error('root cause');
      const err = new NitpickFixerError('msg', 'UNEXPECTED', cause);
      expect(err.cause).to.equal(cause);
    });
  });

  describe('DEFAULT_COMMIT_MESSAGE', () => {
    it('is a non-empty string', () => {
      expect(DEFAULT_COMMIT_MESSAGE).to.be.a('string').with.length.above(0);
    });

    it('follows conventional commit format', () => {
      expect(DEFAULT_COMMIT_MESSAGE.startsWith('style:')).to.be.true;
    });
  });
});
