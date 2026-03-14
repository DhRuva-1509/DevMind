import {
  StatusBarState,
  StatusBarInfo,
  DiagnosticEntry,
  CodeActionEntry,
  WebviewState,
  IndexedLibraryInfo,
  ProgressStep,
  COMMANDS,
  CommandId,
  UIError,
} from './version.guard.ui.types';

export interface DiagnosticCollection {
  set(uri: string, diagnostics: DiagnosticEntry[]): void;
  delete(uri: string): void;
  clear(): void;
  get(uri: string): DiagnosticEntry[];
  dispose(): void;
}

export interface StatusBarItem {
  text: string;
  tooltip: string;
  command: string | undefined;
  show(): void;
  hide(): void;
  dispose(): void;
}

export interface WebviewPanel {
  reveal(): void;
  dispose(): void;
  postMessage(message: unknown): void;
  onDidDispose(callback: () => void): void;
  html: string;
}

export interface VscodeAdapter {
  // Diagnostics
  createDiagnosticCollection(name: string): DiagnosticCollection;
  // Status bar
  createStatusBarItem(): StatusBarItem;
  // Webview
  createWebviewPanel(viewType: string, title: string, options?: object): WebviewPanel;
  // Commands
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): void;
  executeCommand(id: string, ...args: unknown[]): Promise<void>;
  // Notifications
  showInformationMessage(message: string): void;
  showWarningMessage(message: string): void;
  showErrorMessage(message: string): void;
  // Progress
  withProgress(title: string, steps: ProgressStep[], task: () => Promise<void>): Promise<void>;
  // Editor
  applyEdit(uri: string, range: CodeActionEntry['range'], newText: string): Promise<void>;
  // Quick pick
  showQuickPick(items: string[]): Promise<string | undefined>;
  // Config
  getConfiguration(key: string): unknown;
}

export class VersionGuardDiagnostics {
  private readonly collection: DiagnosticCollection;
  private readonly quickFixMap = new Map<string, CodeActionEntry>();

  constructor(vscode: VscodeAdapter) {
    this.collection = vscode.createDiagnosticCollection('devmind-version-guard');
  }

  setDiagnostics(uri: string, entries: DiagnosticEntry[]): void {
    this.collection.set(uri, entries);
  }

  clearFile(uri: string): void {
    this.collection.delete(uri);
    // Remove quick fixes associated with this file
    for (const [id, action] of this.quickFixMap) {
      if (action.uri === uri) this.quickFixMap.delete(id);
    }
  }

  clearAll(): void {
    this.collection.clear();
    this.quickFixMap.clear();
  }

  registerQuickFix(action: CodeActionEntry): void {
    this.quickFixMap.set(action.warningId, action);
  }

  getQuickFix(warningId: string): CodeActionEntry | null {
    return this.quickFixMap.get(warningId) ?? null;
  }

  getQuickFixesForFile(uri: string): CodeActionEntry[] {
    return [...this.quickFixMap.values()].filter((a) => a.uri === uri);
  }

  getDiagnosticsForFile(uri: string): DiagnosticEntry[] {
    return this.collection.get(uri);
  }

  dispose(): void {
    this.collection.dispose();
    this.quickFixMap.clear();
  }
}

export class VersionGuardProvider {
  constructor(
    private readonly diagnostics: VersionGuardDiagnostics,
    private readonly vscode: VscodeAdapter
  ) {}

  provideCodeActions(uri: string, range: { line: number; character: number }): CodeActionEntry[] {
    const fileDiagnostics = this.diagnostics.getDiagnosticsForFile(uri);

    // Find diagnostics that overlap with the cursor range
    const relevant = fileDiagnostics.filter((d) => d.line === range.line);

    const actions: CodeActionEntry[] = [];
    for (const diag of relevant) {
      const fix = this.diagnostics.getQuickFix(diag.warningId);
      if (fix) {
        actions.push({ ...fix, isPreferred: true });
      }
    }

    return actions;
  }

  /**
   * Executes a quick fix — applies the text edit to the document.
   */
  async applyQuickFix(warningId: string): Promise<void> {
    const fix = this.diagnostics.getQuickFix(warningId);
    if (!fix) {
      throw new UIError(`No quick fix found for warning: ${warningId}`);
    }
    await this.vscode.applyEdit(fix.uri, fix.range, fix.newText);
    this.diagnostics.clearFile(fix.uri);
  }
}

const STATUS_BAR_ICONS: Record<StatusBarState, string> = {
  idle: '$(shield)',
  indexing: '$(sync~spin)',
  analyzing: '$(search)',
  ready: '$(shield)',
  error: '$(shield-x)',
  disabled: '$(shield-x)',
};

export class StatusBarManager {
  private readonly item: StatusBarItem;
  private currentState: StatusBarState = 'idle';

  constructor(vscode: VscodeAdapter) {
    this.item = vscode.createStatusBarItem();
    this.item.command = COMMANDS.SHOW_PANEL;
    this.setState({ state: 'idle', label: 'DevMind', tooltip: 'Version Guard ready' });
    this.item.show();
  }

  setState(info: StatusBarInfo): void {
    this.currentState = info.state;
    const icon = STATUS_BAR_ICONS[info.state];

    let label = `${icon} ${info.label}`;
    if (info.state === 'ready' && info.warningCount !== undefined) {
      label += info.warningCount > 0 ? ` $(warning) ${info.warningCount}` : ' $(check)';
    }
    if (info.state === 'indexing' && info.currentLibrary) {
      label += ` ${info.currentLibrary}`;
    }

    this.item.text = label;
    this.item.tooltip = info.tooltip;
  }

  setIndexing(library: string): void {
    this.setState({
      state: 'indexing',
      label: 'Indexing',
      tooltip: `DevMind: Indexing ${library} documentation…`,
      currentLibrary: library,
    });
  }

  setAnalyzing(): void {
    this.setState({
      state: 'analyzing',
      label: 'Analyzing',
      tooltip: 'DevMind: Checking for version issues…',
    });
  }

  setReady(warningCount: number): void {
    this.setState({
      state: 'ready',
      label: 'DevMind',
      tooltip:
        warningCount > 0
          ? `DevMind: ${warningCount} version warning${warningCount === 1 ? '' : 's'} found`
          : 'DevMind: No version issues found',
      warningCount,
    });
  }

  setError(message: string): void {
    this.setState({
      state: 'error',
      label: 'DevMind',
      tooltip: `DevMind error: ${message}`,
    });
  }

  setDisabled(): void {
    this.setState({
      state: 'disabled',
      label: 'DevMind (off)',
      tooltip: 'DevMind Version Guard is disabled. Click to enable.',
    });
  }

  getState(): StatusBarState {
    return this.currentState;
  }

  getText(): string {
    return this.item.text;
  }

  dispose(): void {
    this.item.dispose();
  }
}

export class VersionGuardPanel {
  private panel: WebviewPanel | null = null;
  private state: WebviewState | null = null;

  constructor(private readonly vscode: VscodeAdapter) {}

  show(state: WebviewState): void {
    this.state = state;

    if (this.panel) {
      this.panel.reveal();
      this.panel.postMessage({ type: 'update', payload: state });
      return;
    }

    this.panel = this.vscode.createWebviewPanel(
      'devmind.indexPanel',
      'DevMind – Indexed Libraries'
    );

    this.panel.html = this.buildHtml(state);

    this.panel.onDidDispose(() => {
      this.panel = null;
    });
  }

  update(state: WebviewState): void {
    this.state = state;
    if (this.panel) {
      this.panel.html = this.buildHtml(state);
      this.panel.postMessage({ type: 'update', payload: state });
    }
  }

  isOpen(): boolean {
    return this.panel !== null;
  }

  getState(): WebviewState | null {
    return this.state;
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  buildHtml(state: WebviewState): string {
    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 B';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const statusBadge = (status: IndexedLibraryInfo['status']): string => {
      const map: Record<IndexedLibraryInfo['status'], string> = {
        indexed: '<span style="color:#4ec9b0">● Indexed</span>',
        indexing: '<span style="color:#ce9178">⟳ Indexing…</span>',
        error: '<span style="color:#f44747">✗ Error</span>',
        pending: '<span style="color:#858585">○ Pending</span>',
      };
      return map[status];
    };

    const rows = state.libraries
      .map(
        (lib) => `
      <tr>
        <td><strong>${lib.name}</strong></td>
        <td>${lib.version}</td>
        <td>${lib.documentCount.toLocaleString()}</td>
        <td>${formatBytes(lib.storageBytes)}</td>
        <td>${lib.lastIndexed ? new Date(lib.lastIndexed).toLocaleDateString() : '—'}</td>
        <td>${statusBadge(lib.status)}</td>
      </tr>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DevMind – Indexed Libraries</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 20px; }
    h1 { font-size: 1.2em; font-weight: 600; margin-bottom: 4px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 20px; }
    .summary { display: flex; gap: 32px; margin-bottom: 24px; }
    .summary-card { background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px 20px; border-radius: 6px; }
    .summary-card .value { font-size: 1.6em; font-weight: 700; }
    .summary-card .label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
    th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-weight: 500; }
    td { padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    tr:hover td { background: var(--vscode-list-hoverBackground); }
    .empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 40px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 0.85em; }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <h1>$(shield) DevMind – Indexed Libraries</h1>
  <div class="meta">Project: <strong>${state.projectId}</strong> &nbsp;·&nbsp; Last refreshed: ${new Date(state.lastRefreshed).toLocaleTimeString()}</div>
  <div class="summary">
    <div class="summary-card">
      <div class="value">${state.libraries.length}</div>
      <div class="label">Libraries indexed</div>
    </div>
    <div class="summary-card">
      <div class="value">${state.totalDocuments.toLocaleString()}</div>
      <div class="label">Total documents</div>
    </div>
    <div class="summary-card">
      <div class="value">${formatBytes(state.totalStorageBytes)}</div>
      <div class="label">Storage used</div>
    </div>
  </div>
  ${
    state.libraries.length === 0
      ? '<div class="empty">No libraries indexed yet.<br>Run <strong>DevMind: Index Library</strong> from the command palette.</div>'
      : `<table>
        <thead><tr>
          <th>Library</th><th>Version</th><th>Documents</th><th>Storage</th><th>Last Indexed</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  }
  <br>
  <button onclick="refresh()">⟳ Refresh</button>
  <script>
    const vscode = acquireVsCodeApi();
    function refresh() { vscode.postMessage({ command: 'refresh' }); }
    window.addEventListener('message', event => {
      if (event.data.type === 'update') { location.reload(); }
    });
  </script>
</body>
</html>`;
  }
}

export interface CommandHandlers {
  analyzeFile(): Promise<void>;
  indexLibrary(): Promise<void>;
  showPanel(): void;
  refreshPanel(): void;
  toggleFeature(): void;
  clearDiagnostics(): void;
  applyFix(warningId: string): Promise<void>;
}

export class CommandRegistry {
  private readonly registered: string[] = [];

  constructor(
    private readonly vscode: VscodeAdapter,
    private readonly handlers: CommandHandlers
  ) {}

  registerAll(): void {
    this.register(COMMANDS.ANALYZE_FILE, () => this.handlers.analyzeFile());
    this.register(COMMANDS.INDEX_LIBRARY, () => this.handlers.indexLibrary());
    this.register(COMMANDS.SHOW_PANEL, () => this.handlers.showPanel());
    this.register(COMMANDS.REFRESH_PANEL, () => this.handlers.refreshPanel());
    this.register(COMMANDS.TOGGLE_FEATURE, () => this.handlers.toggleFeature());
    this.register(COMMANDS.CLEAR_DIAGNOSTICS, () => this.handlers.clearDiagnostics());
    this.register(COMMANDS.APPLY_FIX, (id: unknown) => this.handlers.applyFix(id as string));
  }

  private register(id: string, handler: (...args: unknown[]) => unknown): void {
    this.vscode.registerCommand(id, handler);
    this.registered.push(id);
  }

  getRegisteredCommands(): string[] {
    return [...this.registered];
  }
}

export class ProgressManager {
  constructor(private readonly vscode: VscodeAdapter) {}

  async withProgress(
    title: string,
    steps: ProgressStep[],
    task: () => Promise<void>
  ): Promise<void> {
    await this.vscode.withProgress(title, steps, task);
  }

  async showIndexingProgress(library: string, task: () => Promise<void>): Promise<void> {
    await this.withProgress(
      `DevMind: Indexing ${library}`,
      [
        { message: `Crawling ${library} documentation…`, increment: 20 },
        { message: 'Generating embeddings…', increment: 40 },
        { message: 'Writing to search index…', increment: 30 },
        { message: 'Done.', increment: 10 },
      ],
      task
    );
  }

  async showAnalysisProgress(filePath: string, task: () => Promise<void>): Promise<void> {
    const fileName = filePath.split('/').pop() ?? filePath;
    await this.withProgress(
      `DevMind: Analyzing ${fileName}`,
      [
        { message: 'Extracting code patterns…', increment: 25 },
        { message: 'Querying documentation index…', increment: 35 },
        { message: 'Checking for version issues…', increment: 35 },
        { message: 'Done.', increment: 5 },
      ],
      task
    );
  }
}
