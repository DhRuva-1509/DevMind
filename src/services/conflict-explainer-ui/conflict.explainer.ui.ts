import {
  ConflictLensEntry,
  ConflictHoverEntry,
  ConflictPanelState,
  ConflictPanelAdapter,
  ConflictWebviewPanel,
  ConflictExplanationDisplay,
  ConflictPanelMessage,
  CONFLICT_COMMANDS,
  getConfidenceEmoji,
  getConfidenceLabel,
} from './conflict.explainer.ui.types';

const CONFLICT_START_RE = /^<{7}( .*)?$/;

export function findConflictLines(content: string): number[] {
  return content
    .split('\n')
    .map((line, i) => (CONFLICT_START_RE.test(line.trimEnd()) ? i : -1))
    .filter((i) => i !== -1);
}

export class ConflictCodeLensManager {
  provideCodeLenses(uri: string, content: string): ConflictLensEntry[] {
    const lines = findConflictLines(content);
    if (lines.length === 0) return [];

    const lenses: ConflictLensEntry[] = [];

    lenses.push({
      line: lines[0],
      conflictIndex: -1,
      command: CONFLICT_COMMANDS.EXPLAIN_FILE,
      title: `🔍 DevMind: Explain all ${lines.length} conflict${lines.length === 1 ? '' : 's'} in this file`,
      args: [uri],
    });

    lines.forEach((line, index) => {
      lenses.push({
        line,
        conflictIndex: index,
        command: CONFLICT_COMMANDS.EXPLAIN_SINGLE,
        title: `🔍 Explain conflict ${index + 1}`,
        args: [uri, index],
      });
    });

    return lenses;
  }
}

export class ConflictHoverManager {
  private readonly cache = new Map<string, ConflictExplanationDisplay>();

  storeExplanation(uri: string, explanation: ConflictExplanationDisplay): void {
    this.cache.set(`${uri}:${explanation.conflictIndex}`, explanation);
  }

  clearFile(uri: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${uri}:`)) this.cache.delete(key);
    }
  }

  provideHover(uri: string, line: number, content: string): ConflictHoverEntry | null {
    const lines = findConflictLines(content);
    const conflictIndex = lines.indexOf(line);
    if (conflictIndex === -1) return null;

    const exp = this.cache.get(`${uri}:${conflictIndex}`);
    if (!exp) {
      return {
        line,
        markdownContent: [
          '**DevMind — Conflict Explainer**',
          '',
          `Conflict ${conflictIndex + 1} — click **🔍 Explain conflict ${conflictIndex + 1}** above to analyse.`,
        ].join('\n'),
      };
    }

    const emoji = getConfidenceEmoji(exp.confidenceScore);
    const label = getConfidenceLabel(exp.confidenceScore);
    return {
      line,
      markdownContent: [
        `**DevMind — Conflict ${conflictIndex + 1}** ${emoji} ${label} confidence`,
        '',
        `**Current (HEAD):** ${exp.currentIntent}`,
        '',
        `**Incoming:** ${exp.incomingIntent}`,
        '',
        `**Resolution:** ${exp.resolutionStrategy}`,
      ].join('\n'),
    };
  }
}

export class ConflictExplainerPanel {
  private panel: ConflictWebviewPanel | null = null;
  private state: ConflictPanelState = this._emptyState();

  constructor(private readonly adapter: ConflictPanelAdapter) {}

  isOpen(): boolean {
    return this.panel !== null;
  }

  showLoading(filePath: string, conflictCount: number): void {
    this.state = {
      loadingState: 'loading',
      filePath,
      conflictCount,
      currentIndex: 0,
      explanations: [],
      errorMessage: null,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  showExplanations(filePath: string, explanations: ConflictExplanationDisplay[]): void {
    this.state = {
      loadingState: 'success',
      filePath,
      conflictCount: explanations.length,
      currentIndex: 0,
      explanations,
      errorMessage: null,
    };
    this._openOrReveal();
    this._updateHtml();
  }

  showError(filePath: string | null, message: string): void {
    this.state = { ...this.state, loadingState: 'error', filePath, errorMessage: message };
    this._openOrReveal();
    this._updateHtml();
  }

  navigateTo(index: number): void {
    if (index < 0 || index >= this.state.explanations.length) return;
    this.state = { ...this.state, currentIndex: index };
    this._updateHtml();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  private _openOrReveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    this.panel = this.adapter.createWebviewPanel(
      'devmind.conflictExplainer',
      'DevMind — Conflict Explainer'
    );
    this.panel.onDidDispose(() => {
      this.panel = null;
    });
    this.panel.onDidReceiveMessage((msg: ConflictPanelMessage) => {
      if (msg.command === 'navigate' && msg.conflictIndex !== undefined) {
        this.navigateTo(msg.conflictIndex);
      }
      if (msg.command === 'dismiss') {
        this.panel?.dispose();
      }
    });
  }

  private _updateHtml(): void {
    if (!this.panel) return;
    this.panel.html = this.buildHtml();
  }

  private _emptyState(): ConflictPanelState {
    return {
      loadingState: 'idle',
      filePath: null,
      conflictCount: 0,
      currentIndex: 0,
      explanations: [],
      errorMessage: null,
    };
  }

  buildHtml(): string {
    const { loadingState, filePath, conflictCount, currentIndex, explanations, errorMessage } =
      this.state;
    const fileName = filePath ? (filePath.split('/').pop() ?? filePath) : '';

    let body = '';

    if (loadingState === 'idle') {
      body = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <p>Open a file with merge conflicts and click<br>
          <strong>DevMind: Explain conflicts</strong> in the CodeLens above the conflict marker.</p>
        </div>`;
    } else if (loadingState === 'loading') {
      body = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Analysing <strong>${this._esc(fileName)}</strong>…</p>
          <p class="sub">Sending ${conflictCount} conflict${conflictCount === 1 ? '' : 's'} to GPT-4o</p>
        </div>`;
    } else if (loadingState === 'error') {
      body = `
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <p><strong>Analysis failed</strong></p>
          <p class="error-msg">${this._esc(errorMessage ?? 'Unknown error')}</p>
          <button class="btn btn-secondary" onclick="dismiss()">Dismiss</button>
        </div>`;
    } else if (loadingState === 'success' && explanations.length > 0) {
      const exp = explanations[currentIndex];
      const total = explanations.length;
      const emoji = getConfidenceEmoji(exp.confidenceScore);
      const label = getConfidenceLabel(exp.confidenceScore);
      const pct = Math.round(exp.confidenceScore * 100);

      const navPrev =
        currentIndex > 0
          ? `<button class="nav-btn" onclick="navigate(${currentIndex - 1})">← Prev</button>`
          : `<button class="nav-btn" disabled>← Prev</button>`;
      const navNext =
        currentIndex < total - 1
          ? `<button class="nav-btn" onclick="navigate(${currentIndex + 1})">Next →</button>`
          : `<button class="nav-btn" disabled>Next →</button>`;

      const keyChangesCurrent =
        exp.currentKeyChanges.length > 0
          ? `<ul class="changes">${exp.currentKeyChanges.map((c) => `<li>${this._esc(c)}</li>`).join('')}</ul>`
          : '';
      const keyChangesIncoming =
        exp.incomingKeyChanges.length > 0
          ? `<ul class="changes">${exp.incomingKeyChanges.map((c) => `<li>${this._esc(c)}</li>`).join('')}</ul>`
          : '';

      body = `
        <div class="header-row">
          <span class="file-label">📄 ${this._esc(fileName)}</span>
          <span class="conflict-badge">${total} conflict${total === 1 ? '' : 's'}</span>
        </div>

        <div class="nav-row">
          ${navPrev}
          <span class="nav-label">Conflict ${currentIndex + 1} of ${total}
            &nbsp;·&nbsp; lines ${exp.startLine}–${exp.endLine}</span>
          ${navNext}
        </div>

        <div class="conflict-card">

          <div class="side current-side">
            <div class="side-header">
              <span class="side-tag current-tag">HEAD (current)</span>
            </div>
            <p class="intent">${this._esc(exp.currentIntent)}</p>
            ${keyChangesCurrent}
          </div>

          <div class="vs-divider">⟷</div>

          <div class="side incoming-side">
            <div class="side-header">
              <span class="side-tag incoming-tag">Incoming</span>
            </div>
            <p class="intent">${this._esc(exp.incomingIntent)}</p>
            ${keyChangesIncoming}
          </div>

        </div>

        <div class="resolution-card">
          <div class="resolution-header">Suggested Resolution</div>
          <p class="resolution-text">${this._esc(exp.resolutionStrategy)}</p>
          <div class="human-loop-note">
            ⚠️ <strong>Human-in-the-Loop:</strong> DevMind never applies a resolution automatically.
            Use <em>Accept Current</em>, <em>Accept Incoming</em>, or edit manually in the editor.
          </div>
        </div>

        <div class="confidence-row">
          <span class="confidence-label">${emoji} ${label} confidence</span>
          <div class="confidence-bar">
            <div class="confidence-fill" style="width:${pct}%"></div>
          </div>
          <span class="confidence-pct">${pct}%</span>
        </div>

        ${
          total > 1
            ? `
        <div class="conflict-dot-nav">
          ${explanations
            .map(
              (_, i) =>
                `<span class="conflict-dot${i === currentIndex ? ' active' : ''}" onclick="navigate(${i})"></span>`
            )
            .join('')}
        </div>`
            : ''
        }`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DevMind — Conflict Explainer</title>
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

  /* ── Content area ── */
  .content { padding: 16px; }

  /* ── Empty / loading / error states ── */
  .empty-state, .loading-state, .error-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 10px; padding: 40px 20px;
    text-align: center; color: var(--vscode-descriptionForeground);
  }
  .empty-icon, .error-icon { font-size: 32px; }
  .spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid var(--vscode-widget-border);
    border-top-color: var(--vscode-button-background);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .sub { font-size: 11px; }
  .error-msg {
    font-size: 12px; color: var(--vscode-inputValidation-errorForeground);
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    border-radius: 4px; padding: 8px 12px; max-width: 360px;
  }

  /* ── Header row ── */
  .header-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 12px;
  }
  .file-label { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .conflict-badge {
    font-size: 10px; padding: 2px 8px; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
    margin-left: auto;
  }

  /* ── Navigation ── */
  .nav-row {
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 14px;
  }
  .nav-btn {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none; border-radius: 4px; padding: 4px 10px;
    cursor: pointer; font-size: 12px;
  }
  .nav-btn:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  .nav-btn:disabled { opacity: 0.4; cursor: default; }
  .nav-label {
    flex: 1; text-align: center; font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Conflict card ── */
  .conflict-card {
    display: grid; grid-template-columns: 1fr auto 1fr; gap: 0;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px; overflow: hidden; margin-bottom: 14px;
  }
  .side { padding: 12px 14px; }
  .current-side { background: color-mix(in srgb, #3794ff 8%, var(--vscode-editor-background)); }
  .incoming-side { background: color-mix(in srgb, #4ec9b0 8%, var(--vscode-editor-background)); }
  .side-header { margin-bottom: 8px; }
  .side-tag {
    font-size: 10px; font-weight: 600; padding: 2px 8px;
    border-radius: 3px; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .current-tag { background: #3794ff22; color: #3794ff; border: 1px solid #3794ff44; }
  .incoming-tag { background: #4ec9b022; color: #4ec9b0; border: 1px solid #4ec9b044; }
  .intent { font-size: 12px; line-height: 1.5; }
  .changes {
    margin-top: 8px; padding-left: 16px;
    font-size: 11px; color: var(--vscode-descriptionForeground);
  }
  .changes li { margin-bottom: 3px; }
  .vs-divider {
    display: flex; align-items: center; justify-content: center;
    padding: 0 8px; font-size: 16px; opacity: 0.4;
    background: var(--vscode-editorWidget-background);
    border-left: 1px solid var(--vscode-widget-border);
    border-right: 1px solid var(--vscode-widget-border);
  }

  /* ── Resolution card ── */
  .resolution-card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border);
    border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;
  }
  .resolution-header {
    font-size: 11px; font-weight: 600; margin-bottom: 8px;
    color: var(--vscode-descriptionForeground); text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .resolution-text { font-size: 12px; line-height: 1.6; margin-bottom: 10px; }
  .human-loop-note {
    font-size: 11px; line-height: 1.5;
    color: var(--vscode-descriptionForeground);
    border-top: 1px solid var(--vscode-widget-border);
    padding-top: 8px; margin-top: 4px;
  }

  /* ── Confidence row ── */
  .confidence-row {
    display: flex; align-items: center; gap: 8px; margin-bottom: 14px;
  }
  .confidence-label { font-size: 11px; white-space: nowrap; }
  .confidence-bar {
    flex: 1; height: 4px; border-radius: 2px;
    background: var(--vscode-widget-border);
  }
  .confidence-fill { height: 100%; border-radius: 2px; background: var(--vscode-button-background); }
  .confidence-pct { font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* ── Dot navigation ── */
  .conflict-dot-nav { display: flex; justify-content: center; gap: 6px; }
  .conflict-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--vscode-widget-border); cursor: pointer;
    transition: background 0.15s;
  }
  .conflict-dot.active { background: var(--vscode-button-background); }
  .conflict-dot:hover:not(.active) { background: var(--vscode-descriptionForeground); }

  /* ── Buttons ── */
  .btn {
    padding: 6px 14px; border-radius: 4px; border: none;
    font-size: 12px; cursor: pointer;
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
</style>
</head>
<body>
<div class="topbar">
  <span class="topbar-logo">🔍</span>
  <span class="topbar-title">Conflict Explainer</span>
  <span class="topbar-sub">Powered by GPT-4o</span>
</div>
<div class="content">
  ${body}
</div>
<script>
  const vscode = acquireVsCodeApi();
  function navigate(index) {
    vscode.postMessage({ command: 'navigate', conflictIndex: index });
  }
  function dismiss() {
    vscode.postMessage({ command: 'dismiss' });
  }
</script>
</body>
</html>`;
  }

  private _esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
