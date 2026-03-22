import {
  NitpickPanelState,
  NitpickPanelLoadingState,
  FileToggleState,
  NitpickPanelMessage,
  NitpickPanelAdapter,
  NitpickPanelWebviewPanel,
} from './nitpick.fixer.ui.types';
import { NitpickDiff, NitpickResult, FileDiff } from '../nitpick-fixer/nitpick.fixer.types';
import { DEFAULT_COMMIT_MESSAGE } from '../nitpick-fixer/nitpick.fixer.types';

export class NitpickFixerPanel {
  private panel: NitpickPanelWebviewPanel | null = null;
  private state: NitpickPanelState = this._emptyState();
  private _onAcceptCb: ((selectedFiles: string[], commitMessage: string) => void) | null = null;
  private _onRejectCb: (() => void) | null = null;
  private _onRerunCb: (() => void) | null = null;

  constructor(private readonly adapter: NitpickPanelAdapter) {}

  isOpen(): boolean {
    return this.panel !== null;
  }

  showRunning(progressText = 'Running linters…'): void {
    this.state = {
      ...this._emptyState(),
      loadingState: 'running',
      progressText,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  showConfirming(diff: NitpickDiff, summary: string, remainingIssues: number): void {
    const files: FileToggleState[] = diff.files.map((f) => ({
      filePath: f.filePath,
      included: true,
      additions: f.additions,
      deletions: f.deletions,
      diff: f.diff,
    }));
    this.state = {
      loadingState: 'confirming',
      files,
      summary,
      commitMessage: DEFAULT_COMMIT_MESSAGE,
      remainingIssues,
      result: null,
      errorMessage: null,
      progressText: null,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  showCommitting(commitMessage: string): void {
    this.state = {
      ...this.state,
      loadingState: 'committing',
      commitMessage,
      progressText: `Committing: "${commitMessage}"`,
    };
    this._updateHtml();
  }

  showSuccess(result: NitpickResult): void {
    this.state = {
      ...this.state,
      loadingState: 'success',
      result,
      progressText: null,
      errorMessage: null,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  showClean(summary: string): void {
    this.state = {
      ...this._emptyState(),
      loadingState: 'success',
      summary,
      result: null,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  showError(errorMessage: string): void {
    this.state = {
      ...this.state,
      loadingState: 'error',
      errorMessage,
      progressText: null,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  onAccept(cb: (selectedFiles: string[], commitMessage: string) => void): void {
    this._onAcceptCb = cb;
  }

  onReject(cb: () => void): void {
    this._onRejectCb = cb;
  }

  onRerun(cb: () => void): void {
    this._onRerunCb = cb;
  }

  dispose(): void {
    this.panel?.dispose();
  }

  buildHtml(): string {
    const {
      loadingState,
      files,
      summary,
      commitMessage,
      remainingIssues,
      result,
      errorMessage,
      progressText,
    } = this.state;

    let body: string;

    switch (loadingState) {
      case 'idle':
        body = `<div class="empty-state"><span class="empty-icon">🔧</span><p>Run <strong>DevMind: Fix Nitpicks</strong> to detect and fix linting issues.</p></div>`;
        break;

      case 'running':
      case 'committing':
        body = `
          <div class="progress-state">
            <div class="spinner"></div>
            <p class="progress-text">${this._esc(progressText ?? 'Working…')}</p>
          </div>`;
        break;

      case 'confirming': {
        const includedCount = files.filter((f) => f.included).length;
        const totalAdditions = files.filter((f) => f.included).reduce((s, f) => s + f.additions, 0);
        const totalDeletions = files.filter((f) => f.included).reduce((s, f) => s + f.deletions, 0);

        body = `
          <div class="confirm-header">
            <div class="summary-text">${this._esc(summary)}</div>
            ${remainingIssues > 0 ? `<div class="remaining-badge">⚠️ ${remainingIssues} issue${remainingIssues === 1 ? '' : 's'} require manual attention</div>` : ''}
            <div class="stats-row">
              <span class="stat-pill files">${includedCount} file${includedCount === 1 ? '' : 's'}</span>
              <span class="stat-pill adds">+${totalAdditions}</span>
              <span class="stat-pill dels">-${totalDeletions}</span>
            </div>
          </div>

          <div class="hitl-notice">
            ⚠️ <strong>Human-in-the-Loop:</strong> DevMind will not apply changes or commit until you click Accept.
          </div>

          <div class="file-list">
            ${files.map((f) => this._buildFileRow(f)).join('')}
          </div>

          <div class="commit-row">
            <label class="commit-label">Commit message</label>
            <input
              id="commit-msg"
              class="commit-input"
              type="text"
              value="${this._esc(commitMessage)}"
              oninput="updateCommitMessage(this.value)"
            />
          </div>

          <div class="action-row">
            <button class="btn btn-primary" onclick="acceptAll()">✅ Accept All &amp; Commit</button>
            <button class="btn btn-secondary" onclick="acceptSelected()">Accept Selected</button>
            <button class="btn btn-danger" onclick="reject()">✕ Reject</button>
          </div>`;
        break;
      }

      case 'success': {
        const isClean = result === null;
        const isCommitted = result?.status === 'committed';
        const isFixed = result?.status === 'fixed';
        const isRejected = result?.status === 'rejected';

        let icon = '✅';
        let heading = 'Done';
        let detail = summary;

        if (isClean) {
          icon = '✨';
          heading = 'All Clean';
          detail = summary;
        } else if (isCommitted) {
          icon = '✅';
          heading = 'Committed';
          detail = `${result!.summary}\n\nCommit: <code>${result!.commitSha ?? 'unknown'}</code>\nMessage: <em>${this._esc(result!.commitMessage ?? '')}</em>`;
        } else if (isFixed) {
          icon = '✅';
          heading = 'Fixes Applied';
          detail = result!.summary;
        } else if (isRejected) {
          icon = '↩️';
          heading = 'Rejected';
          detail = 'No changes were applied.';
        }

        body = `
          <div class="success-state">
            <span class="success-icon">${icon}</span>
            <h2 class="success-heading">${heading}</h2>
            <p class="success-detail">${detail.replace(/\n/g, '<br>')}</p>
            <button class="btn btn-secondary" onclick="rerun()">🔄 Run Again</button>
          </div>`;
        break;
      }

      case 'error':
        body = `
          <div class="error-state">
            <span class="error-icon">⚠️</span>
            <p class="error-message">${this._esc(errorMessage ?? 'An unexpected error occurred.')}</p>
            <div class="error-actions">
              <button class="btn btn-secondary" onclick="rerun()">🔄 Try Again</button>
              <button class="btn btn-ghost" onclick="dismissError()">Dismiss</button>
            </div>
          </div>`;
        break;

      default:
        body = '';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DevMind — Nitpick Fixer</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    padding: 0;
    min-height: 100vh;
  }

  /* ── Top bar ── */
  .topbar {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px;
    background: var(--vscode-editorWidget-background);
    border-bottom: 1px solid var(--vscode-widget-border);
  }
  .topbar-logo { font-size: 15px; }
  .topbar-title { font-size: 13px; font-weight: 600; }
  .topbar-sub { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: auto; }

  /* ── Content ── */
  .content { padding: 16px; display: flex; flex-direction: column; gap: 12px; }

  /* ── States ── */
  .empty-state, .progress-state, .success-state, .error-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 12px; padding: 48px 20px; text-align: center;
  }
  .empty-icon, .success-icon, .error-icon { font-size: 36px; }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid var(--vscode-widget-border);
    border-top-color: var(--vscode-button-background);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .progress-text { color: var(--vscode-descriptionForeground); font-size: 12px; }
  .success-heading { font-size: 16px; font-weight: 600; }
  .success-detail { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.6; }
  .error-message { color: var(--vscode-errorForeground); font-size: 12px; }
  .error-actions { display: flex; gap: 8px; }

  /* ── Confirm header ── */
  .confirm-header { display: flex; flex-direction: column; gap: 6px; }
  .summary-text { font-size: 13px; font-weight: 500; }
  .remaining-badge {
    font-size: 11px; padding: 3px 8px; border-radius: 4px;
    background: var(--vscode-inputValidation-warningBackground);
    color: var(--vscode-inputValidation-warningForeground);
    width: fit-content;
  }
  .stats-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .stat-pill {
    font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 500;
  }
  .stat-pill.files {
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }
  .stat-pill.adds { background: #1a3a1a; color: #4caf50; }
  .stat-pill.dels { background: #3a1a1a; color: #f44336; }

  /* ── HITL notice ── */
  .hitl-notice {
    font-size: 11.5px; padding: 8px 12px; border-radius: 4px;
    background: var(--vscode-inputValidation-infoBackground);
    border-left: 3px solid var(--vscode-button-background);
    color: var(--vscode-editor-foreground);
    line-height: 1.5;
  }

  /* ── File list ── */
  .file-list { display: flex; flex-direction: column; gap: 4px; }
  .file-row {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px; border-radius: 5px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border);
    cursor: pointer; transition: border-color 0.15s;
  }
  .file-row:hover { border-color: var(--vscode-focusBorder); }
  .file-row.excluded { opacity: 0.45; }
  .file-toggle { flex-shrink: 0; cursor: pointer; width: 14px; height: 14px; }
  .file-path { flex: 1; font-family: var(--vscode-editor-font-family); font-size: 12px; }
  .file-stats { display: flex; gap: 4px; flex-shrink: 0; }
  .file-add { font-size: 11px; color: #4caf50; }
  .file-del { font-size: 11px; color: #f44336; }

  /* ── Commit row ── */
  .commit-row { display: flex; flex-direction: column; gap: 4px; }
  .commit-label { font-size: 11px; color: var(--vscode-descriptionForeground); font-weight: 500; }
  .commit-input {
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px; padding: 6px 10px; font-size: 12.5px;
    font-family: inherit; outline: none; width: 100%;
    transition: border-color 0.15s;
  }
  .commit-input:focus { border-color: var(--vscode-focusBorder); }

  /* ── Action row ── */
  .action-row { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn {
    padding: 6px 14px; border-radius: 4px; border: none;
    font-size: 12px; cursor: pointer; font-family: inherit;
    transition: background 0.15s;
  }
  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-danger { background: #c0392b; color: #fff; }
  .btn-danger:hover { background: #a93226; }
  .btn-ghost {
    background: transparent;
    color: var(--vscode-descriptionForeground);
    border: 1px solid var(--vscode-widget-border);
  }
</style>
</head>
<body>
<div class="topbar">
  <span class="topbar-logo">🔧</span>
  <span class="topbar-title">Nitpick Fixer</span>
  <span class="topbar-sub">ESLint · Prettier · Ruff · Black</span>
</div>
<div class="content">
  ${body}
</div>
<script>
  const vscode = acquireVsCodeApi();

  function acceptAll() {
    const msg = document.getElementById('commit-msg')?.value ?? '';
    vscode.postMessage({ command: 'accept-all', commitMessage: msg });
  }

  function acceptSelected() {
    const msg = document.getElementById('commit-msg')?.value ?? '';
    const checked = Array.from(document.querySelectorAll('.file-toggle:checked'))
      .map(el => el.dataset.path);
    vscode.postMessage({ command: 'accept-selected', selectedFiles: checked, commitMessage: msg });
  }

  function reject() {
    vscode.postMessage({ command: 'reject' });
  }

  function toggleFile(filePath, el) {
    vscode.postMessage({ command: 'toggle-file', filePath, included: el.checked });
    const row = el.closest('.file-row');
    if (row) row.classList.toggle('excluded', !el.checked);
  }

  function updateCommitMessage(value) {
    vscode.postMessage({ command: 'update-commit-message', message: value });
  }

  function dismissError() {
    vscode.postMessage({ command: 'dismiss-error' });
  }

  function rerun() {
    vscode.postMessage({ command: 'rerun' });
  }
</script>
</body>
</html>`;
  }

  private _openOrReveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = this.adapter.createWebviewPanel('devmind.nitpickFixer', 'DevMind — Nitpick Fixer');
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.panel.onDidReceiveMessage((msg: NitpickPanelMessage) => {
      this._handleMessage(msg);
    });
  }

  private _updateHtml(): void {
    if (!this.panel) return;
    this.panel.html = this.buildHtml();
  }

  private _handleMessage(msg: NitpickPanelMessage): void {
    switch (msg.command) {
      case 'accept-all': {
        const allFiles = this.state.files.map((f) => f.filePath);
        this._onAcceptCb?.(allFiles, this.state.commitMessage);
        break;
      }
      case 'accept-selected': {
        const selected =
          msg.selectedFiles ?? this.state.files.filter((f) => f.included).map((f) => f.filePath);
        this._onAcceptCb?.(selected, this.state.commitMessage);
        break;
      }
      case 'reject':
        this._onRejectCb?.();
        break;
      case 'toggle-file': {
        const file = this.state.files.find((f) => f.filePath === msg.filePath);
        if (file) file.included = msg.included;
        break;
      }
      case 'update-commit-message':
        this.state.commitMessage = msg.message;
        break;
      case 'dismiss-error':
        this.state = { ...this.state, loadingState: 'idle', errorMessage: null };
        this._updateHtml();
        break;
      case 'rerun':
        this._onRerunCb?.();
        break;
    }
  }

  private _buildFileRow(f: FileToggleState): string {
    const excluded = !f.included;
    const escapedPath = this._esc(f.filePath);
    return `
      <div class="file-row${excluded ? ' excluded' : ''}">
        <input
          type="checkbox"
          class="file-toggle"
          data-path="${escapedPath}"
          ${f.included ? 'checked' : ''}
          onclick="toggleFile('${escapedPath}', this)"
        />
        <span class="file-path">${escapedPath}</span>
        <div class="file-stats">
          <span class="file-add">+${f.additions}</span>
          <span class="file-del">-${f.deletions}</span>
        </div>
      </div>`;
  }

  private _emptyState(): NitpickPanelState {
    return {
      loadingState: 'idle',
      files: [],
      summary: '',
      commitMessage: DEFAULT_COMMIT_MESSAGE,
      remainingIssues: 0,
      result: null,
      errorMessage: null,
      progressText: null,
    };
  }

  private _esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
