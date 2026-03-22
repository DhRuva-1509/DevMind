import { expect } from 'chai';
import * as sinon from 'sinon';
import { NitpickFixerPanel } from './nitpick.fixer.ui';
import {
  NitpickPanelAdapter,
  NitpickPanelWebviewPanel,
  NitpickPanelMessage,
  NITPICK_COMMANDS,
} from './nitpick.fixer.ui.types';
import { NitpickDiff, NitpickResult, FileDiff } from '../nitpick-fixer/nitpick.fixer.types';
import { DEFAULT_COMMIT_MESSAGE } from '../nitpick-fixer/nitpick.fixer.types';

function makeFileDiff(overrides: Partial<FileDiff> = {}): FileDiff {
  return {
    filePath: 'src/auth.ts',
    diff: 'diff --git a/src/auth.ts b/src/auth.ts\n+fixed\n',
    additions: 2,
    deletions: 1,
    ...overrides,
  };
}

function makeDiff(files: FileDiff[] = [makeFileDiff()]): NitpickDiff {
  return {
    files,
    totalFiles: files.length,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    raw: files.map((f) => f.diff).join('\n'),
  };
}

function makeResult(overrides: Partial<NitpickResult> = {}): NitpickResult {
  return {
    status: 'committed',
    trigger: 'command',
    cwd: '/project',
    linterResult: null,
    diff: makeDiff(),
    confirmation: { outcome: 'accepted', decidedAt: new Date().toISOString() },
    commitSha: 'abc1234',
    commitMessage: DEFAULT_COMMIT_MESSAGE,
    appliedFixes: [],
    remainingIssues: 0,
    summary: '1 issue fixed in 1 file',
    errorMessage: null,
    durationMs: 500,
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePanel(): {
  adapter: NitpickPanelAdapter;
  webview: NitpickPanelWebviewPanel & { _html: string };
  disposeStub: sinon.SinonStub;
  revealStub: sinon.SinonStub;
  fireDispose: () => void;
  fireMessage: (msg: NitpickPanelMessage) => void;
} {
  const callbacks: { dispose?: () => void; message?: (msg: NitpickPanelMessage) => void } = {};
  const disposeStub = sinon.stub().callsFake(() => {
    callbacks.dispose?.();
  });
  const revealStub = sinon.stub();

  const webview: any = {
    _html: '',
    get html() {
      return this._html;
    },
    set html(v: string) {
      this._html = v;
    },
    reveal: revealStub,
    dispose: disposeStub,
    postMessage: sinon.stub(),
    onDidDispose: (cb: () => void) => {
      callbacks.dispose = cb;
    },
    onDidReceiveMessage: (cb: (msg: NitpickPanelMessage) => void) => {
      callbacks.message = cb;
    },
  };

  const adapter: NitpickPanelAdapter = {
    createWebviewPanel: sinon.stub().returns(webview),
    showInformationMessage: sinon.stub(),
    showErrorMessage: sinon.stub(),
    registerCommand: sinon.stub(),
  };

  return {
    adapter,
    webview,
    disposeStub,
    revealStub,
    fireDispose: () => callbacks.dispose?.(),
    fireMessage: (msg) => callbacks.message?.(msg),
  };
}

describe('NitpickFixerPanel', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      const { adapter } = makePanel();
      expect(new NitpickFixerPanel(adapter)).to.be.instanceOf(NitpickFixerPanel);
    });

    it('starts closed', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(panel.isOpen()).to.be.false;
    });
  });

  describe('showRunning()', () => {
    it('opens the panel', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      expect(panel.isOpen()).to.be.true;
    });

    it('sets HTML on panel', () => {
      const { adapter, webview } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      expect(webview._html).to.be.a('string').with.length.above(0);
    });

    it('HTML contains spinner', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      expect(panel.buildHtml()).to.include('spinner');
    });

    it('HTML contains progress text', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning('Running ESLint…');
      expect(panel.buildHtml()).to.include('Running ESLint');
    });

    it('reveals existing panel instead of creating new one', () => {
      const { adapter, revealStub } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      panel.showRunning();
      expect((adapter.createWebviewPanel as sinon.SinonStub).calledOnce).to.be.true;
      expect(revealStub.calledOnce).to.be.true;
    });

    it('sets isOpen false after dispose', () => {
      const { adapter, fireDispose } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      fireDispose();
      expect(panel.isOpen()).to.be.false;
    });
  });

  describe('showConfirming()', () => {
    it('opens the panel', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.isOpen()).to.be.true;
    });

    it('HTML includes HITL notice', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('Human-in-the-Loop');
    });

    it('HTML includes summary text', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), '3 issues fixed', 0);
      expect(panel.buildHtml()).to.include('3 issues fixed');
    });

    it('HTML includes Accept All button', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('Accept All');
    });

    it('HTML includes Accept Selected button', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('Accept Selected');
    });

    it('HTML includes Reject button', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('Reject');
    });

    it('HTML includes commit message input', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('commit-msg');
    });

    it('commit message input pre-filled with DEFAULT_COMMIT_MESSAGE', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include(DEFAULT_COMMIT_MESSAGE);
    });

    it('HTML includes file list with file path', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff([makeFileDiff({ filePath: 'src/auth.ts' })]), 'summary', 0);
      expect(panel.buildHtml()).to.include('src/auth.ts');
    });

    it('HTML includes file toggle checkboxes', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('file-toggle');
    });

    it('HTML shows remaining issues badge when > 0', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 5);
      expect(panel.buildHtml()).to.include('5 issues require manual attention');
    });

    it('HTML does not show remaining badge when 0', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.not.include('require manual attention');
    });

    it('HTML shows addition stats', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff([makeFileDiff({ additions: 5, deletions: 3 })]), 'summary', 0);
      expect(panel.buildHtml()).to.include('+5');
      expect(panel.buildHtml()).to.include('-3');
    });

    it('files default to included (checked)', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      expect(panel.buildHtml()).to.include('checked');
    });

    it('HTML shows multiple files', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(
        makeDiff([makeFileDiff({ filePath: 'src/a.ts' }), makeFileDiff({ filePath: 'src/b.ts' })]),
        'summary',
        0
      );
      const html = panel.buildHtml();
      expect(html).to.include('src/a.ts');
      expect(html).to.include('src/b.ts');
    });
  });

  describe('showCommitting()', () => {
    it('HTML contains spinner', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      panel.showCommitting('style: auto-fix');
      expect(panel.buildHtml()).to.include('spinner');
    });

    it('HTML contains commit message in progress text', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      panel.showCommitting('chore: lint fixes');
      expect(panel.buildHtml()).to.include('chore: lint fixes');
    });
  });

  describe('showSuccess()', () => {
    it('opens the panel', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult());
      expect(panel.isOpen()).to.be.true;
    });

    it('HTML contains commit SHA for committed result', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult({ status: 'committed', commitSha: 'abc1234' }));
      expect(panel.buildHtml()).to.include('abc1234');
    });

    it('HTML contains "Committed" heading for committed result', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult({ status: 'committed' }));
      expect(panel.buildHtml()).to.include('Committed');
    });

    it('HTML contains "Fixes Applied" for fixed result', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult({ status: 'fixed', commitSha: null }));
      expect(panel.buildHtml()).to.include('Fixes Applied');
    });

    it('HTML contains "Rejected" for rejected result', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult({ status: 'rejected' }));
      expect(panel.buildHtml()).to.include('Rejected');
    });

    it('HTML contains Re-run button', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult());
      expect(panel.buildHtml()).to.include('Run Again');
    });
  });

  describe('showClean()', () => {
    it('opens the panel', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showClean('All clean!');
      expect(panel.isOpen()).to.be.true;
    });

    it('HTML contains "All Clean" heading', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showClean('No issues found');
      expect(panel.buildHtml()).to.include('All Clean');
    });
  });

  describe('showError()', () => {
    it('opens the panel', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showError('Something broke');
      expect(panel.isOpen()).to.be.true;
    });

    it('HTML contains error message', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showError('ESLint not installed');
      expect(panel.buildHtml()).to.include('ESLint not installed');
    });

    it('HTML contains Try Again button', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showError('error');
      expect(panel.buildHtml()).to.include('Try Again');
    });

    it('HTML contains Dismiss button', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showError('error');
      expect(panel.buildHtml()).to.include('Dismiss');
    });
  });

  describe('message handling', () => {
    it('accept-all fires onAccept with all file paths', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      const onAccept = sinon.stub();
      panel.onAccept(onAccept);
      panel.showConfirming(
        makeDiff([makeFileDiff({ filePath: 'src/a.ts' }), makeFileDiff({ filePath: 'src/b.ts' })]),
        'summary',
        0
      );
      fireMessage({ command: 'accept-all' });
      expect(onAccept.calledOnce).to.be.true;
      const [files] = onAccept.firstCall.args;
      expect(files).to.include('src/a.ts');
      expect(files).to.include('src/b.ts');
    });

    it('accept-all passes current commit message', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      const onAccept = sinon.stub();
      panel.onAccept(onAccept);
      panel.showConfirming(makeDiff(), 'summary', 0);
      fireMessage({ command: 'accept-all' });
      const [, msg] = onAccept.firstCall.args;
      expect(msg).to.equal(DEFAULT_COMMIT_MESSAGE);
    });

    it('accept-selected fires onAccept with only selected files', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      const onAccept = sinon.stub();
      panel.onAccept(onAccept);
      panel.showConfirming(makeDiff(), 'summary', 0);
      fireMessage({ command: 'accept-selected', selectedFiles: ['src/a.ts'] });
      const [files] = onAccept.firstCall.args;
      expect(files).to.deep.equal(['src/a.ts']);
    });

    it('reject fires onReject callback', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      const onReject = sinon.stub();
      panel.onReject(onReject);
      panel.showConfirming(makeDiff(), 'summary', 0);
      fireMessage({ command: 'reject' });
      expect(onReject.calledOnce).to.be.true;
    });

    it('toggle-file updates file included state', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff([makeFileDiff({ filePath: 'src/a.ts' })]), 'summary', 0);
      fireMessage({ command: 'toggle-file', filePath: 'src/a.ts', included: false });
      expect(panel.buildHtml()).to.include('excluded');
    });

    it('update-commit-message updates state', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      const onAccept = sinon.stub();
      panel.onAccept(onAccept);
      panel.showConfirming(makeDiff(), 'summary', 0);
      fireMessage({ command: 'update-commit-message', message: 'chore: custom' });
      fireMessage({ command: 'accept-all' });
      const [, msg] = onAccept.firstCall.args;
      expect(msg).to.equal('chore: custom');
    });

    it('dismiss-error resets to idle state', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showError('oops');
      fireMessage({ command: 'dismiss-error' });
      expect(panel.buildHtml()).to.include('Fix Nitpicks');
    });

    it('rerun fires onRerun callback', () => {
      const { adapter, fireMessage } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      const onRerun = sinon.stub();
      panel.onRerun(onRerun);
      panel.showSuccess(makeResult());
      fireMessage({ command: 'rerun' });
      expect(onRerun.calledOnce).to.be.true;
    });
  });

  describe('buildHtml()', () => {
    it('returns valid HTML with DOCTYPE', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(panel.buildHtml()).to.include('<!DOCTYPE html>');
    });

    it('includes Nitpick Fixer title', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(panel.buildHtml()).to.include('Nitpick Fixer');
    });

    it('shows idle state initially', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(panel.buildHtml()).to.include('Fix Nitpicks');
    });

    it('shows spinner when running', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      expect(panel.buildHtml()).to.include('spinner');
    });

    it('shows confirming state with action buttons', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showConfirming(makeDiff(), 'summary', 0);
      const html = panel.buildHtml();
      expect(html).to.include('Accept All');
      expect(html).to.include('Reject');
    });

    it('shows success state after commit', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showSuccess(makeResult({ status: 'committed' }));
      expect(panel.buildHtml()).to.include('Committed');
    });

    it('shows error state with message', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showError('Linter not found');
      expect(panel.buildHtml()).to.include('Linter not found');
    });

    it('includes vscode API script', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(panel.buildHtml()).to.include('acquireVsCodeApi');
    });

    it('includes ESLint · Prettier · Ruff · Black subtitle', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(panel.buildHtml()).to.include('ESLint');
      expect(panel.buildHtml()).to.include('Prettier');
    });
  });

  describe('dispose()', () => {
    it('sets isOpen to false', () => {
      const { adapter, disposeStub } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      panel.showRunning();
      panel.dispose();
      expect(panel.isOpen()).to.be.false;
    });

    it('does not throw when panel not open', () => {
      const { adapter } = makePanel();
      const panel = new NitpickFixerPanel(adapter);
      expect(() => panel.dispose()).to.not.throw();
    });
  });

  describe('NITPICK_COMMANDS', () => {
    it('defines FIX_NITPICKS command', () => {
      expect(NITPICK_COMMANDS.FIX_NITPICKS).to.be.a('string');
      expect(NITPICK_COMMANDS.FIX_NITPICKS).to.include('devmind');
    });

    it('defines SHOW_PANEL command', () => {
      expect(NITPICK_COMMANDS.SHOW_PANEL).to.be.a('string');
    });
  });
});
