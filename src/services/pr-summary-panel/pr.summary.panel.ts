import {
  PRSummaryPanelState,
  PanelMessage,
  PanelLoadingState,
  RiskLevel,
  LinkedIssueDisplay,
  PR_SUMMARY_COMMANDS,
} from './pr.summary.panel.types';
import { PRSummary } from '../pr-summary/pr.summary.types';

export interface PanelWebview {
  get html(): string;
  set html(v: string);
  reveal(): void;
  dispose(): void;
  postMessage(msg: unknown): void;
  onDidDispose(cb: () => void): void;
  onDidReceiveMessage(cb: (msg: PanelMessage) => void): void;
}

export interface PRSummaryPanelAdapter {
  createWebviewPanel(viewType: string, title: string): PanelWebview;
  showInformationMessage(msg: string): void;
  showErrorMessage(msg: string): void;
  openExternal(url: string): void;
  writeClipboard(text: string): Promise<void> | Thenable<void>;
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): void;
  postSummaryToGitHub(summary: PRSummary): Promise<void>;
}

export class PRSummaryPanel {
  private panel: PanelWebview | null = null;
  private onRegenerateCallback: ((prNumber: number, repoLabel: string) => void) | null = null;

  onRegenerate(cb: (prNumber: number, repoLabel: string) => void): void {
    this.onRegenerateCallback = cb;
  }
  private state: PRSummaryPanelState = PRSummaryPanel.emptyState();

  constructor(private readonly adapter: PRSummaryPanelAdapter) {}

  /** AC-1: Opens (or reveals) the panel in idle state */
  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = this.adapter.createWebviewPanel('devmind.prSummary', 'DevMind – PR Summary');
    this.panel.html = this.buildHtml(this.state);
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.panel.onDidReceiveMessage((msg) => this.handleMessage(msg));
  }

  /** Shows the panel in loading state while summary is being generated */
  showLoading(prNumber: number, repoLabel: string): void {
    this.state = {
      ...PRSummaryPanel.emptyState(),
      loadingState: 'loading',
      prNumber,
      repoLabel,
    };
    this.show();
    this.refresh();
  }

  /** AC-2: Populates panel with a completed summary */
  showSummary(summary: PRSummary): void {
    this.state = {
      loadingState: 'success',
      prNumber: summary.prNumber,
      prTitle: summary.prTitle,
      prAuthor: null,
      prUrl: null,
      repoLabel: `${summary.owner}/${summary.repo}`,
      summary: summary.summary,
      riskLevel: this.detectRiskLevel(summary.summary),
      linkedIssues: [],
      errorMessage: null,
      generatedAt: summary.generatedAt,
      wasChunked: summary.wasChunked,
      chunkCount: summary.chunkSummaries.length,
      templateVersion: summary.templateVersion,
    };
    this.show();
    this.refresh();
  }

  /** Populates linked issues on the panel */
  setLinkedIssues(issues: LinkedIssueDisplay[]): void {
    this.state = { ...this.state, linkedIssues: issues };
    this.refresh();
  }

  /** Shows an error state */
  showError(prNumber: number | null, message: string): void {
    this.state = {
      ...PRSummaryPanel.emptyState(),
      loadingState: 'error',
      prNumber,
      errorMessage: message,
    };
    this.show();
    this.refresh();
  }

  isOpen(): boolean {
    return this.panel !== null;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  getState(): PRSummaryPanelState {
    return { ...this.state };
  }

  private async handleMessage(msg: PanelMessage): Promise<void> {
    switch (msg.command) {
      case 'copy':
        await this.handleCopy();
        break;
      case 'post-to-pr':
        this.handlePostToPR();
        break;
      case 'regenerate':
        this.handleRegenerate();
        break;
      case 'open-issue':
        this.handleOpenIssue(msg.payload as string);
        break;
      case 'dismiss-error':
        this.state = { ...this.state, loadingState: 'idle', errorMessage: null };
        this.refresh();
        break;
    }
  }

  /** AC-5: Copy summary to clipboard */
  private async handleCopy(): Promise<void> {
    if (!this.state.summary) return;
    try {
      await this.adapter.writeClipboard(this.state.summary);
      this.adapter.showInformationMessage('DevMind: PR summary copied to clipboard.');
    } catch {
      this.adapter.showErrorMessage('DevMind: Failed to copy to clipboard.');
    }
  }

  /** AC-6: Post summary to GitHub via PRCommentPoster */
  private async handlePostToPR(): Promise<void> {
    if (!this.state.summary || !this.state.prNumber) {
      this.adapter.showInformationMessage('DevMind: No summary available to post.');
      return;
    }
    const summaryRecord = {
      id: `pr-summary-${this.state.repoLabel ?? 'unknown'}-${this.state.prNumber}`,
      owner: this.state.repoLabel?.split('/')[0] ?? '',
      repo: this.state.repoLabel?.split('/')[1] ?? '',
      prNumber: this.state.prNumber,
      prTitle: this.state.prTitle ?? '',
      prState: 'open',
      summary: this.state.summary,
      chunkSummaries: [],
      wasChunked: this.state.wasChunked,
      foundryAgentId: null,
      foundryThreadId: null,
      templateVersion: this.state.templateVersion ?? '1.0.0',
      abVariant: null,
      status: 'complete' as const,
      errorMessage: null,
      trigger: 'command' as const,
      generatedAt: this.state.generatedAt ?? new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      prUpdatedAt: new Date().toISOString(),
    };
    try {
      await this.adapter.postSummaryToGitHub(summaryRecord as any);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.adapter.showErrorMessage(`DevMind: Failed to post — ${msg}`);
    }
  }

  /** AC-7: Trigger regeneration — sets loading state and fires registered callback */
  private handleRegenerate(): void {
    const prNumber = this.state.prNumber;
    if (prNumber == null) return;
    this.state = { ...this.state, loadingState: 'loading' };
    this.refresh();
    if (this.onRegenerateCallback) {
      this.onRegenerateCallback(prNumber, this.state.repoLabel ?? '');
    }
  }

  private handleOpenIssue(url: string): void {
    if (url) this.adapter.openExternal(url);
  }

  /**
   * AC-4: Detects risk level from summary text.
   * Looks for explicit Impact section content.
   */
  detectRiskLevel(summaryText: string): RiskLevel {
    if (!summaryText) return 'unknown';
    const lower = summaryText.toLowerCase();

    // Look for explicit Impact section
    const impactMatch = lower.match(/##\s*impact[\s\S]{0,200}/);
    const impactText = impactMatch ? impactMatch[0] : lower;

    if (/\bhigh\b/.test(impactText)) return 'high';
    if (/\bmedium\b/.test(impactText)) return 'medium';
    if (/\blow\b/.test(impactText)) return 'low';

    // Fallback: keyword scanning
    if (/breaking[\s-]change|security|critical|database migration|schema change/.test(lower))
      return 'high';
    if (/deprecated|refactor|performance|multiple files|api change/.test(lower)) return 'medium';
    if (/typo|comment|readme|documentation|minor/.test(lower)) return 'low';

    return 'unknown';
  }

  private refresh(): void {
    if (!this.panel) return;
    this.panel.html = this.buildHtml(this.state);
  }

  /**
   * AC-2–AC-8: Builds the full webview HTML.
   */
  buildHtml(state: PRSummaryPanelState): string {
    const riskColor = (level: RiskLevel): string =>
      ({
        high: '#f44747',
        medium: '#ce9178',
        low: '#4ec9b0',
        unknown: '#858585',
      })[level];

    const riskLabel = (level: RiskLevel): string =>
      ({
        high: '🔴 High Risk',
        medium: '🟡 Medium Risk',
        low: '🟢 Low Risk',
        unknown: '⚪ Risk Unknown',
      })[level];

    const renderLoading = (): string => `
      <div class="loading-state">
        <div class="spinner">⟳</div>
        <div class="loading-text">Generating PR summary…</div>
        <div class="loading-sub">Fetching PR context, analysing changes, running AI agent</div>
      </div>`;

    const renderError = (msg: string): string => `
      <div class="error-state">
        <div class="error-icon">✗</div>
        <div class="error-text">${escHtml(msg)}</div>
        <button onclick="send('dismiss-error')">Dismiss</button>
      </div>`;

    const renderIdle = (): string => `
      <div class="idle-state">
        <div class="idle-icon">$(comment-discussion)</div>
        <div class="idle-text">No PR summary loaded.</div>
        <div class="idle-sub">Run <strong>DevMind: Generate PR Summary</strong> from the command palette.</div>
      </div>`;

    const renderIssues = (issues: LinkedIssueDisplay[]): string => {
      if (issues.length === 0) return '<p class="no-issues">No linked issues detected.</p>';
      return issues
        .map(
          (i) => `
        <div class="issue-chip" onclick="${i.url ? `send('open-issue', '${escHtml(i.url ?? '')}')` : ''}">
          <span class="issue-num">#${i.number}</span>
          ${i.title ? `<span class="issue-title">${escHtml(i.title)}</span>` : ''}
          <span class="issue-source">${escHtml(i.source)}</span>
        </div>`
        )
        .join('');
    };

    const renderSummary = (s: PRSummaryPanelState): string => {
      const md = s.summary ?? '';
      // Convert markdown headers and basic formatting to HTML
      const html = md
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/^(?!<[hupol])/gm, '')
        .replace(/\*\[(.+?)\]\*/g, '<em class="meta-note">$1</em>');

      return `
        <div class="summary-body">
          <p>${html}</p>
        </div>`;
    };

    const escHtml = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const headerMeta =
      state.prNumber != null
        ? [
            state.repoLabel ? `<span>${escHtml(state.repoLabel)}</span>` : '',
            `<span>PR #${state.prNumber}</span>`,
            state.prAuthor ? `<span>by ${escHtml(state.prAuthor)}</span>` : '',
            state.generatedAt
              ? `<span>Generated ${new Date(state.generatedAt).toLocaleTimeString()}</span>`
              : '',
            state.wasChunked
              ? `<span class="chunked-badge">⚡ Large PR (${state.chunkCount} chunks)</span>`
              : '',
          ]
            .filter(Boolean)
            .join(' <span class="sep">·</span> ')
        : '';

    const bodyContent = (() => {
      switch (state.loadingState) {
        case 'loading':
          return renderLoading();
        case 'error':
          return renderError(state.errorMessage ?? 'An unknown error occurred.');
        case 'success':
          return `
          <div class="risk-bar" style="border-left-color: ${riskColor(state.riskLevel)}">
            <span class="risk-label" style="color: ${riskColor(state.riskLevel)}">${riskLabel(state.riskLevel)}</span>
          </div>
          ${renderSummary(state)}
          <section class="issues-section">
            <h2>Linked Issues</h2>
            ${renderIssues(state.linkedIssues)}
          </section>`;
        default:
          return renderIdle();
      }
    })();

    const actionsDisabled = state.loadingState !== 'success';
    const btnAttr = (disabled: boolean): string =>
      disabled ? 'class="btn btn-disabled" disabled' : 'class="btn"';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevMind – PR Summary</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 0;
      margin: 0;
      font-size: var(--vscode-font-size, 13px);
    }
    /* ── Header ── */
    .header {
      padding: 16px 20px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      z-index: 10;
    }
    .header h1 { font-size: 1.1em; font-weight: 600; margin: 0 0 4px; }
    .header-meta { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .header-meta .sep { opacity: 0.4; margin: 0 4px; }
    .chunked-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 0.78em;
    }
    /* ── Action Bar ── */
    .action-bar {
      display: flex;
      gap: 8px;
      padding: 10px 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex-wrap: wrap;
    }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 5px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.82em;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #cccccc);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
    .btn-disabled { opacity: 0.4; cursor: not-allowed; }
    /* ── Content ── */
    .content { padding: 16px 20px; }
    /* ── Risk bar ── */
    .risk-bar {
      border-left: 4px solid #858585;
      padding: 8px 14px;
      margin-bottom: 16px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 0 4px 4px 0;
    }
    .risk-label { font-weight: 600; font-size: 0.9em; }
    /* ── Summary body ── */
    .summary-body { line-height: 1.6; }
    .summary-body h2 { font-size: 1em; font-weight: 600; margin: 16px 0 6px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    .summary-body h3 { font-size: 0.95em; font-weight: 600; margin: 12px 0 4px; }
    .summary-body ul { padding-left: 20px; margin: 6px 0; }
    .summary-body li { margin: 3px 0; }
    .summary-body p { margin: 8px 0; }
    .meta-note { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.85em; }
    /* ── Issues ── */
    .issues-section { margin-top: 20px; border-top: 1px solid var(--vscode-panel-border); padding-top: 14px; }
    .issues-section h2 { font-size: 1em; font-weight: 600; margin: 0 0 10px; }
    .issue-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border-radius: 4px;
      padding: 4px 10px;
      margin: 3px;
      cursor: pointer;
      font-size: 0.85em;
    }
    .issue-chip:hover { background: var(--vscode-list-hoverBackground); }
    .issue-num { font-weight: 700; color: var(--vscode-textLink-foreground); }
    .issue-title { color: var(--vscode-foreground); }
    .issue-source { color: var(--vscode-descriptionForeground); font-size: 0.8em; }
    .no-issues { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin: 0; }
    /* ── Loading ── */
    .loading-state, .idle-state, .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      gap: 10px;
    }
    .spinner {
      font-size: 2em;
      animation: spin 1.2s linear infinite;
      color: var(--vscode-progressBar-background, #0e70c0);
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-text { font-size: 1em; font-weight: 600; }
    .loading-sub { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .idle-icon { font-size: 2.5em; opacity: 0.4; }
    .idle-text { font-size: 1em; font-weight: 600; }
    .idle-sub { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .error-icon { font-size: 2em; color: #f44747; }
    .error-text { color: #f44747; font-size: 0.9em; max-width: 400px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>$(comment-discussion) DevMind – PR Summary</h1>
    ${headerMeta ? `<div class="header-meta">${headerMeta}</div>` : ''}
  </div>

  <div class="action-bar">
    <button ${btnAttr(actionsDisabled)} onclick="send('copy')">📋 Copy to Clipboard</button>
    <button ${btnAttr(actionsDisabled)} class="btn btn-secondary" onclick="send('post-to-pr')">💬 Post to PR</button>
    <button ${btnAttr(false)} class="btn btn-secondary" onclick="send('regenerate')">🔄 Regenerate</button>
  </div>

  <div class="content">
    ${bodyContent}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function send(command, payload) {
      vscode.postMessage({ command, payload });
    }
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'reload') { location.reload(); }
    });
  </script>
</body>
</html>`;
  }

  static emptyState(): PRSummaryPanelState {
    return {
      loadingState: 'idle',
      prNumber: null,
      prTitle: null,
      prAuthor: null,
      prUrl: null,
      repoLabel: null,
      summary: null,
      riskLevel: 'unknown',
      linkedIssues: [],
      errorMessage: null,
      generatedAt: null,
      wasChunked: false,
      chunkCount: 0,
      templateVersion: null,
    };
  }
}
