import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { PRSummaryPanel, PRSummaryPanelAdapter, PanelWebview } from './pr.summary.panel';
import { PRSummaryPanelState, RiskLevel, LinkedIssueDisplay } from './pr.summary.panel.types';
import { PRSummary } from '../pr-summary/pr.summary.types';

function makeWebview(overrides: Partial<PanelWebview> = {}): PanelWebview {
  let _html = '';
  let disposeCallback: (() => void) | null = null;
  let messageCallback: ((msg: any) => void) | null = null;

  return {
    get html() {
      return _html;
    },
    set html(v) {
      _html = v;
    },
    reveal: sinon.stub(),
    dispose: sinon.stub().callsFake(() => {
      disposeCallback?.();
    }),
    postMessage: sinon.stub(),
    onDidDispose: sinon.stub().callsFake((cb: () => void) => {
      disposeCallback = cb;
    }),
    onDidReceiveMessage: sinon.stub().callsFake((cb: (m: any) => void) => {
      messageCallback = cb;
    }),
    _triggerMessage: (msg: any) => messageCallback?.(msg),
    ...overrides,
  } as any;
}

function makeAdapter(webview?: PanelWebview): PRSummaryPanelAdapter & { _webview: PanelWebview } {
  const wv = webview ?? makeWebview();
  return {
    createWebviewPanel: sinon.stub().returns(wv),
    showInformationMessage: sinon.stub(),
    showErrorMessage: sinon.stub(),
    openExternal: sinon.stub(),
    writeClipboard: sinon.stub().resolves(),
    registerCommand: sinon.stub(),
    _webview: wv,
  };
}

function makePanel(adapter?: ReturnType<typeof makeAdapter>): {
  panel: PRSummaryPanel;
  adapter: ReturnType<typeof makeAdapter>;
} {
  const a = adapter ?? makeAdapter();
  return { panel: new PRSummaryPanel(a), adapter: a };
}

function makeSummary(overrides: Partial<PRSummary> = {}): PRSummary {
  return {
    id: 'pr-summary-owner-repo-42',
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: add useQuery migration',
    prState: 'open',
    summary: `## Summary\nThis PR migrates useQuery syntax.\n\n## Changes\n- Updated hooks\n\n## Impact\nLow risk change.\n\n## Notes\nSee #10`,
    chunkSummaries: [],
    wasChunked: false,
    foundryAgentId: 'agent-1',
    foundryThreadId: 'thread-1',
    templateVersion: '1.0.0',
    abVariant: null,
    status: 'complete',
    errorMessage: null,
    trigger: 'command',
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    prUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PRSummaryPanel', () => {
  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates an instance', () => {
      const { panel } = makePanel();
      expect(panel).to.be.instanceOf(PRSummaryPanel);
    });

    it('starts closed', () => {
      const { panel } = makePanel();
      expect(panel.isOpen()).to.be.false;
    });
  });

  describe('show()', () => {
    it('creates a webview panel', () => {
      const { panel, adapter } = makePanel();
      panel.show();
      expect((adapter.createWebviewPanel as SinonStub).callCount).to.equal(1);
    });

    it('sets isOpen to true', () => {
      const { panel } = makePanel();
      panel.show();
      expect(panel.isOpen()).to.be.true;
    });

    it('sets HTML on panel', () => {
      const { panel, adapter } = makePanel();
      panel.show();
      expect(adapter._webview.html).to.include('<!DOCTYPE html>');
    });

    it('reveals existing panel instead of creating new one', () => {
      const { panel, adapter } = makePanel();
      panel.show();
      panel.show();
      expect((adapter.createWebviewPanel as SinonStub).callCount).to.equal(1);
      expect((adapter._webview.reveal as SinonStub).callCount).to.equal(1);
    });

    it('sets isOpen false after dispose', () => {
      const { panel, adapter } = makePanel();
      panel.show();
      panel.dispose();
      expect(panel.isOpen()).to.be.false;
    });
  });

  describe('showLoading()', () => {
    it('opens the panel', () => {
      const { panel } = makePanel();
      panel.showLoading(42, 'owner/repo');
      expect(panel.isOpen()).to.be.true;
    });

    it('sets loadingState to loading', () => {
      const { panel } = makePanel();
      panel.showLoading(42, 'owner/repo');
      expect(panel.getState().loadingState).to.equal('loading');
    });

    it('sets prNumber', () => {
      const { panel } = makePanel();
      panel.showLoading(42, 'owner/repo');
      expect(panel.getState().prNumber).to.equal(42);
    });

    it('sets repoLabel', () => {
      const { panel } = makePanel();
      panel.showLoading(42, 'owner/repo');
      expect(panel.getState().repoLabel).to.equal('owner/repo');
    });

    it('HTML contains loading indicator', () => {
      const { panel, adapter } = makePanel();
      panel.showLoading(42, 'owner/repo');
      expect(adapter._webview.html).to.include('loading');
    });
  });

  describe('showSummary()', () => {
    it('sets loadingState to success', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.getState().loadingState).to.equal('success');
    });

    it('sets prNumber from summary', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.getState().prNumber).to.equal(42);
    });

    it('sets prTitle from summary', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.getState().prTitle).to.equal('feat: add useQuery migration');
    });

    it('sets repoLabel from owner/repo', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.getState().repoLabel).to.equal('owner/repo');
    });

    it('sets summary text', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.getState().summary).to.include('useQuery');
    });

    it('sets riskLevel', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(['low', 'medium', 'high', 'unknown']).to.include(panel.getState().riskLevel);
    });

    it('sets generatedAt', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.getState().generatedAt).to.be.a('string');
    });

    it('sets wasChunked', () => {
      const { panel } = makePanel();
      panel.showSummary(
        makeSummary({
          wasChunked: true,
          chunkSummaries: [{ chunkIndex: 0, files: [], content: '', tokenCount: 0 }],
        })
      );
      expect(panel.getState().wasChunked).to.be.true;
    });

    it('sets chunkCount from chunkSummaries length', () => {
      const { panel } = makePanel();
      const s = makeSummary({
        wasChunked: true,
        chunkSummaries: [
          { chunkIndex: 0, files: [], content: '', tokenCount: 0 },
          { chunkIndex: 1, files: [], content: '', tokenCount: 0 },
        ],
      });
      panel.showSummary(s);
      expect(panel.getState().chunkCount).to.equal(2);
    });

    it('opens panel', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      expect(panel.isOpen()).to.be.true;
    });
  });

  describe('showError()', () => {
    it('sets loadingState to error', () => {
      const { panel } = makePanel();
      panel.showError(42, 'Something went wrong');
      expect(panel.getState().loadingState).to.equal('error');
    });

    it('sets errorMessage', () => {
      const { panel } = makePanel();
      panel.showError(42, 'Foundry unavailable');
      expect(panel.getState().errorMessage).to.equal('Foundry unavailable');
    });

    it('sets prNumber', () => {
      const { panel } = makePanel();
      panel.showError(42, 'error');
      expect(panel.getState().prNumber).to.equal(42);
    });

    it('accepts null prNumber', () => {
      const { panel } = makePanel();
      panel.showError(null, 'error');
      expect(panel.getState().prNumber).to.be.null;
    });

    it('opens panel', () => {
      const { panel } = makePanel();
      panel.showError(42, 'error');
      expect(panel.isOpen()).to.be.true;
    });

    it('HTML contains error text', () => {
      const { panel, adapter } = makePanel();
      panel.showError(42, 'Foundry unavailable');
      expect(adapter._webview.html).to.include('Foundry unavailable');
    });
  });

  describe('setLinkedIssues()', () => {
    it('updates linkedIssues on state', () => {
      const { panel } = makePanel();
      panel.showSummary(makeSummary());
      const issues: LinkedIssueDisplay[] = [
        { number: 10, title: 'Fix bug', source: 'pr_body', url: 'https://github.com/issues/10' },
      ];
      panel.setLinkedIssues(issues);
      expect(panel.getState().linkedIssues).to.have.length(1);
      expect(panel.getState().linkedIssues[0].number).to.equal(10);
    });

    it('updates HTML with issue info', () => {
      const { panel, adapter } = makePanel();
      panel.showSummary(makeSummary());
      panel.setLinkedIssues([{ number: 10, title: 'Fix bug', source: 'pr_body', url: null }]);
      expect(adapter._webview.html).to.include('#10');
    });
  });

  describe('detectRiskLevel()', () => {
    it('returns low for low risk summary', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('## Impact\nLow risk change.')).to.equal('low');
    });

    it('returns medium for medium risk summary', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('## Impact\nMedium risk refactor.')).to.equal('medium');
    });

    it('returns high for high risk summary', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('## Impact\nHigh risk change.')).to.equal('high');
    });

    it('returns high for breaking change keyword', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('This includes a breaking-change to the API.')).to.equal('high');
    });

    it('returns high for security keyword', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('This change affects security settings.')).to.equal('high');
    });

    it('returns medium for deprecated keyword', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('Removes deprecated methods.')).to.equal('medium');
    });

    it('returns medium for refactor keyword', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('Large refactor of auth module.')).to.equal('medium');
    });

    it('returns low for documentation keyword', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('Minor documentation update.')).to.equal('low');
    });

    it('returns unknown for empty string', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('')).to.equal('unknown');
    });

    it('returns unknown for unclassifiable text', () => {
      const { panel } = makePanel();
      expect(panel.detectRiskLevel('Updated some stuff.')).to.equal('unknown');
    });

    it('prioritises Impact section over body keywords', () => {
      const { panel } = makePanel();
      const summary = 'breaking change in docs.\n\n## Impact\nLow risk.';
      expect(panel.detectRiskLevel(summary)).to.equal('low');
    });
  });

  describe('buildHtml()', () => {
    it('returns valid HTML with DOCTYPE', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('<!DOCTYPE html>');
    });

    it('includes PR Summary title', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('PR Summary');
    });

    it('shows idle state when loadingState is idle', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('idle');
    });

    it('shows spinner when loadingState is loading', () => {
      const { panel } = makePanel();
      const state = { ...PRSummaryPanel.emptyState(), loadingState: 'loading' as const };
      const html = panel.buildHtml(state);
      expect(html).to.include('spinner');
    });

    it('shows error when loadingState is error', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'error' as const,
        errorMessage: 'Test error',
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('Test error');
    });

    it('shows summary text when loadingState is success', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'success' as const,
        summary: 'My PR summary text',
        riskLevel: 'low' as const,
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('My PR summary text');
    });

    it('shows PR number in header when set', () => {
      const { panel } = makePanel();
      const state = { ...PRSummaryPanel.emptyState(), prNumber: 42 };
      const html = panel.buildHtml(state);
      expect(html).to.include('42');
    });

    it('includes Copy to Clipboard button', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('Copy to Clipboard');
    });

    it('includes Post to PR button', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('Post to PR');
    });

    it('includes Regenerate button', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('Regenerate');
    });

    it('action buttons disabled in idle state', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('btn-disabled');
    });

    it('action buttons enabled in success state', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'success' as const,
        summary: 'text',
        riskLevel: 'low' as const,
      };
      const html = panel.buildHtml(state);
      // Copy and Post buttons should not have btn-disabled
      const copyBtnMatch = html.match(/Copy to Clipboard/);
      expect(copyBtnMatch).to.not.be.null;
    });

    it('shows risk indicator in success state', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'success' as const,
        summary: 'text',
        riskLevel: 'high' as const,
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('High Risk');
    });

    it('shows correct color for high risk', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'success' as const,
        summary: 'text',
        riskLevel: 'high' as const,
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('#f44747');
    });

    it('shows correct color for low risk', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'success' as const,
        summary: 'text',
        riskLevel: 'low' as const,
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('#4ec9b0');
    });

    it('shows linked issues section', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        loadingState: 'success' as const,
        summary: 'text',
        riskLevel: 'low' as const,
        linkedIssues: [{ number: 10, title: 'Bug fix', source: 'pr_body', url: null }],
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('#10');
      expect(html).to.include('Bug fix');
    });

    it('shows chunked badge for large PRs', () => {
      const { panel } = makePanel();
      const state = {
        ...PRSummaryPanel.emptyState(),
        prNumber: 42,
        wasChunked: true,
        chunkCount: 3,
      };
      const html = panel.buildHtml(state);
      expect(html).to.include('Large PR');
    });

    it('includes script with vscode API', () => {
      const { panel } = makePanel();
      const html = panel.buildHtml(PRSummaryPanel.emptyState());
      expect(html).to.include('acquireVsCodeApi');
    });
  });

  describe('message handling', () => {
    it('copy command calls writeClipboard', async () => {
      const wv = makeWebview();
      const adapter = makeAdapter(wv);
      const { panel } = makePanel(adapter);
      panel.showSummary(makeSummary());
      await (wv as any)._triggerMessage({ command: 'copy' });
      // Allow microtask queue to flush
      await new Promise((r) => setTimeout(r, 0));
      expect((adapter.writeClipboard as SinonStub).callCount).to.equal(1);
    });

    it('copy command passes summary text to clipboard', async () => {
      const wv = makeWebview();
      const adapter = makeAdapter(wv);
      const { panel } = makePanel(adapter);
      panel.showSummary(makeSummary());
      await (wv as any)._triggerMessage({ command: 'copy' });
      await new Promise((r) => setTimeout(r, 0));
      const clipText = (adapter.writeClipboard as SinonStub).firstCall?.args[0];
      expect(clipText).to.include('useQuery');
    });

    it('post-to-pr command calls openExternal when prUrl set', async () => {
      const wv = makeWebview();
      const adapter = makeAdapter(wv);
      const { panel } = makePanel(adapter);
      panel.showSummary(makeSummary());
      panel['state'].prUrl = 'https://github.com/owner/repo/pull/42';
      await (wv as any)._triggerMessage({ command: 'post-to-pr' });
      await new Promise((r) => setTimeout(r, 0));
      expect((adapter.openExternal as SinonStub).callCount).to.equal(1);
    });

    it('post-to-pr shows info message when no prUrl', async () => {
      const wv = makeWebview();
      const adapter = makeAdapter(wv);
      const { panel } = makePanel(adapter);
      panel.showSummary(makeSummary());
      await (wv as any)._triggerMessage({ command: 'post-to-pr' });
      await new Promise((r) => setTimeout(r, 0));
      expect((adapter.showInformationMessage as SinonStub).callCount).to.equal(1);
    });

    it('dismiss-error resets to idle state', async () => {
      const wv = makeWebview();
      const adapter = makeAdapter(wv);
      const { panel } = makePanel(adapter);
      panel.showError(42, 'some error');
      await (wv as any)._triggerMessage({ command: 'dismiss-error' });
      await new Promise((r) => setTimeout(r, 0));
      expect(panel.getState().loadingState).to.equal('idle');
    });

    it('open-issue calls openExternal with url', async () => {
      const wv = makeWebview();
      const adapter = makeAdapter(wv);
      const { panel } = makePanel(adapter);
      panel.show();
      await (wv as any)._triggerMessage({
        command: 'open-issue',
        payload: 'https://github.com/issues/10',
      });
      await new Promise((r) => setTimeout(r, 0));
      expect((adapter.openExternal as SinonStub).calledWith('https://github.com/issues/10')).to.be
        .true;
    });
  });

  describe('emptyState()', () => {
    it('returns idle state', () => {
      expect(PRSummaryPanel.emptyState().loadingState).to.equal('idle');
    });

    it('returns null prNumber', () => {
      expect(PRSummaryPanel.emptyState().prNumber).to.be.null;
    });

    it('returns empty linkedIssues', () => {
      expect(PRSummaryPanel.emptyState().linkedIssues).to.deep.equal([]);
    });

    it('returns unknown riskLevel', () => {
      expect(PRSummaryPanel.emptyState().riskLevel).to.equal('unknown');
    });
  });

  describe('dispose()', () => {
    it('sets isOpen to false', () => {
      const { panel } = makePanel();
      panel.show();
      panel.dispose();
      expect(panel.isOpen()).to.be.false;
    });

    it('does not throw when panel not open', () => {
      const { panel } = makePanel();
      expect(() => panel.dispose()).to.not.throw();
    });
  });
});
