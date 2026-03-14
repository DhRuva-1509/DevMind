import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import {
  VersionGuardDiagnostics,
  VersionGuardProvider,
  StatusBarManager,
  VersionGuardPanel,
  CommandRegistry,
  ProgressManager,
  VscodeAdapter,
  DiagnosticCollection,
  StatusBarItem,
  WebviewPanel,
  CommandHandlers,
} from './version.guard.ui';
import { DiagnosticEntry, CodeActionEntry, WebviewState, COMMANDS } from './version.guard.ui.types';

function makeDiagCollection(): DiagnosticCollection {
  const store = new Map<string, DiagnosticEntry[]>();
  return {
    set: sinon.stub().callsFake((uri: string, diags: DiagnosticEntry[]) => store.set(uri, diags)),
    delete: sinon.stub().callsFake((uri: string) => store.delete(uri)),
    clear: sinon.stub().callsFake(() => store.clear()),
    get: sinon.stub().callsFake((uri: string) => store.get(uri) ?? []),
    dispose: sinon.stub(),
  };
}

function makeStatusBarItem(): StatusBarItem {
  return {
    text: '',
    tooltip: '',
    command: undefined,
    show: sinon.stub(),
    hide: sinon.stub(),
    dispose: sinon.stub(),
  };
}

function makeWebviewPanel(): WebviewPanel {
  return {
    html: '',
    reveal: sinon.stub(),
    dispose: sinon.stub(),
    postMessage: sinon.stub(),
    onDidDispose: sinon.stub(),
  };
}

function makeVscode(overrides: Partial<VscodeAdapter> = {}): VscodeAdapter {
  return {
    createDiagnosticCollection: sinon.stub().returns(makeDiagCollection()),
    createStatusBarItem: sinon.stub().returns(makeStatusBarItem()),
    createWebviewPanel: sinon.stub().returns(makeWebviewPanel()),
    registerCommand: sinon.stub(),
    executeCommand: sinon.stub().resolves(),
    showInformationMessage: sinon.stub(),
    showWarningMessage: sinon.stub(),
    showErrorMessage: sinon.stub(),
    withProgress: sinon
      .stub()
      .callsFake(async (_t: string, _s: unknown, task: () => Promise<void>) => task()),
    applyEdit: sinon.stub().resolves(),
    showQuickPick: sinon.stub().resolves('react'),
    getConfiguration: sinon.stub().returns(true),
    ...overrides,
  };
}

function makeDiagEntry(overrides: Partial<DiagnosticEntry> = {}): DiagnosticEntry {
  return {
    uri: 'file:///src/App.tsx',
    line: 3,
    character: 18,
    endLine: 3,
    endCharacter: 40,
    message: 'useQuery array syntax is deprecated in v5',
    severity: 'warning',
    warningId: 'warn-001',
    source: 'DevMind Version Guard',
    code: 'vg-001',
    ...overrides,
  };
}

function makeCodeAction(overrides: Partial<CodeActionEntry> = {}): CodeActionEntry {
  return {
    title: 'Replace useQuery with suggested fix',
    newText: 'useQuery({ queryKey: [...], queryFn: fn })',
    range: { line: 3, character: 18, endLine: 3, endCharacter: 40 },
    warningId: 'warn-001',
    uri: 'file:///src/App.tsx',
    isPreferred: true,
    ...overrides,
  };
}

function makeWebviewState(overrides: Partial<WebviewState> = {}): WebviewState {
  return {
    projectId: 'my-project',
    libraries: [],
    totalDocuments: 0,
    totalStorageBytes: 0,
    lastRefreshed: new Date().toISOString(),
    ...overrides,
  };
}

describe('VersionGuardDiagnostics', () => {
  let vscode: VscodeAdapter;
  let diagManager: VersionGuardDiagnostics;

  beforeEach(() => {
    vscode = makeVscode();
    diagManager = new VersionGuardDiagnostics(vscode);
  });

  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates a diagnostic collection', () => {
      expect((vscode.createDiagnosticCollection as SinonStub).callCount).to.equal(1);
      expect((vscode.createDiagnosticCollection as SinonStub).firstCall.args[0]).to.equal(
        'devmind-version-guard'
      );
    });
  });

  describe('setDiagnostics()', () => {
    it('sets diagnostics for a file', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry()]);
      const diags = diagManager.getDiagnosticsForFile('file:///src/App.tsx');
      expect(diags).to.have.length(1);
    });

    it('replaces existing diagnostics', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [
        makeDiagEntry(),
        makeDiagEntry({ warningId: 'w2' }),
      ]);
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry()]);
      const diags = diagManager.getDiagnosticsForFile('file:///src/App.tsx');
      expect(diags).to.have.length(1);
    });

    it('handles multiple files independently', () => {
      diagManager.setDiagnostics('file:///src/A.tsx', [makeDiagEntry()]);
      diagManager.setDiagnostics('file:///src/B.tsx', [
        makeDiagEntry({ uri: 'file:///src/B.tsx' }),
      ]);
      expect(diagManager.getDiagnosticsForFile('file:///src/A.tsx')).to.have.length(1);
      expect(diagManager.getDiagnosticsForFile('file:///src/B.tsx')).to.have.length(1);
    });
  });

  describe('clearFile()', () => {
    it('removes diagnostics for the file', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry()]);
      diagManager.clearFile('file:///src/App.tsx');
      expect(diagManager.getDiagnosticsForFile('file:///src/App.tsx')).to.deep.equal([]);
    });

    it('removes quick fixes for the file', () => {
      diagManager.registerQuickFix(makeCodeAction());
      diagManager.clearFile('file:///src/App.tsx');
      expect(diagManager.getQuickFix('warn-001')).to.be.null;
    });

    it('does not affect other files', () => {
      diagManager.setDiagnostics('file:///src/A.tsx', [makeDiagEntry()]);
      diagManager.setDiagnostics('file:///src/B.tsx', [
        makeDiagEntry({ uri: 'file:///src/B.tsx' }),
      ]);
      diagManager.clearFile('file:///src/A.tsx');
      expect(diagManager.getDiagnosticsForFile('file:///src/B.tsx')).to.have.length(1);
    });
  });

  describe('clearAll()', () => {
    it('removes all diagnostics', () => {
      diagManager.setDiagnostics('file:///src/A.tsx', [makeDiagEntry()]);
      diagManager.setDiagnostics('file:///src/B.tsx', [makeDiagEntry()]);
      diagManager.clearAll();
      expect(diagManager.getDiagnosticsForFile('file:///src/A.tsx')).to.deep.equal([]);
    });

    it('removes all quick fixes', () => {
      diagManager.registerQuickFix(makeCodeAction());
      diagManager.clearAll();
      expect(diagManager.getQuickFix('warn-001')).to.be.null;
    });
  });

  describe('registerQuickFix() / getQuickFix()', () => {
    it('stores and retrieves a quick fix by warningId', () => {
      const action = makeCodeAction();
      diagManager.registerQuickFix(action);
      expect(diagManager.getQuickFix('warn-001')).to.deep.equal(action);
    });

    it('returns null for unknown warningId', () => {
      expect(diagManager.getQuickFix('nonexistent')).to.be.null;
    });

    it('overwrites existing quick fix for same warningId', () => {
      diagManager.registerQuickFix(makeCodeAction({ newText: 'old fix' }));
      diagManager.registerQuickFix(makeCodeAction({ newText: 'new fix' }));
      expect(diagManager.getQuickFix('warn-001')?.newText).to.equal('new fix');
    });
  });

  describe('getQuickFixesForFile()', () => {
    it('returns all quick fixes for a file', () => {
      diagManager.registerQuickFix(makeCodeAction({ warningId: 'w1' }));
      diagManager.registerQuickFix(makeCodeAction({ warningId: 'w2' }));
      diagManager.registerQuickFix(makeCodeAction({ warningId: 'w3', uri: 'file:///other.tsx' }));
      const fixes = diagManager.getQuickFixesForFile('file:///src/App.tsx');
      expect(fixes).to.have.length(2);
    });

    it('returns empty array when no quick fixes for file', () => {
      expect(diagManager.getQuickFixesForFile('file:///unknown.tsx')).to.deep.equal([]);
    });
  });

  describe('dispose()', () => {
    it('calls dispose on the collection', () => {
      diagManager.dispose();
      expect(true).to.be.true;
    });
  });
});

describe('VersionGuardProvider', () => {
  let vscode: VscodeAdapter;
  let diagManager: VersionGuardDiagnostics;
  let provider: VersionGuardProvider;

  beforeEach(() => {
    vscode = makeVscode();
    diagManager = new VersionGuardDiagnostics(vscode);
    provider = new VersionGuardProvider(diagManager, vscode);
  });

  afterEach(() => sinon.restore());

  describe('provideCodeActions()', () => {
    it('returns code actions for diagnostics on the same line', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry({ line: 3 })]);
      diagManager.registerQuickFix(makeCodeAction());
      const actions = provider.provideCodeActions('file:///src/App.tsx', {
        line: 3,
        character: 20,
      });
      expect(actions).to.have.length(1);
    });

    it('returns empty array when no diagnostics on line', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry({ line: 5 })]);
      diagManager.registerQuickFix(makeCodeAction());
      const actions = provider.provideCodeActions('file:///src/App.tsx', { line: 3, character: 0 });
      expect(actions).to.deep.equal([]);
    });

    it('returns empty array when diagnostic has no quick fix', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry()]);
      // No quick fix registered
      const actions = provider.provideCodeActions('file:///src/App.tsx', {
        line: 3,
        character: 18,
      });
      expect(actions).to.deep.equal([]);
    });

    it('marks returned action as isPreferred', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry()]);
      diagManager.registerQuickFix(makeCodeAction({ isPreferred: false }));
      const actions = provider.provideCodeActions('file:///src/App.tsx', {
        line: 3,
        character: 18,
      });
      expect(actions[0].isPreferred).to.be.true;
    });

    it('returns multiple actions for multiple diagnostics on same line', () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [
        makeDiagEntry({ warningId: 'w1' }),
        makeDiagEntry({ warningId: 'w2' }),
      ]);
      diagManager.registerQuickFix(makeCodeAction({ warningId: 'w1' }));
      diagManager.registerQuickFix(makeCodeAction({ warningId: 'w2' }));
      const actions = provider.provideCodeActions('file:///src/App.tsx', {
        line: 3,
        character: 18,
      });
      expect(actions).to.have.length(2);
    });
  });

  describe('applyQuickFix()', () => {
    it('calls applyEdit with correct args', async () => {
      const action = makeCodeAction();
      diagManager.registerQuickFix(action);
      await provider.applyQuickFix('warn-001');
      expect((vscode.applyEdit as SinonStub).callCount).to.equal(1);
      expect((vscode.applyEdit as SinonStub).firstCall.args[0]).to.equal('file:///src/App.tsx');
      expect((vscode.applyEdit as SinonStub).firstCall.args[2]).to.equal(action.newText);
    });

    it('clears diagnostics for the file after applying fix', async () => {
      diagManager.setDiagnostics('file:///src/App.tsx', [makeDiagEntry()]);
      diagManager.registerQuickFix(makeCodeAction());
      await provider.applyQuickFix('warn-001');
      expect(diagManager.getDiagnosticsForFile('file:///src/App.tsx')).to.deep.equal([]);
    });

    it('throws UIError when warningId not found', async () => {
      try {
        await provider.applyQuickFix('nonexistent');
        expect.fail();
      } catch (e) {
        expect((e as Error).name).to.equal('UIError');
      }
    });
  });
});

describe('StatusBarManager', () => {
  let vscode: VscodeAdapter;
  let manager: StatusBarManager;

  beforeEach(() => {
    vscode = makeVscode();
    manager = new StatusBarManager(vscode);
  });

  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates a status bar item', () => {
      expect((vscode.createStatusBarItem as SinonStub).callCount).to.equal(1);
    });

    it('shows the status bar item on creation', () => {
      const item = (vscode.createStatusBarItem as SinonStub).returnValues[0] as StatusBarItem;
      expect((item.show as SinonStub).callCount).to.equal(1);
    });

    it('sets command to show panel', () => {
      const item = (vscode.createStatusBarItem as SinonStub).returnValues[0] as StatusBarItem;
      expect(item.command).to.equal(COMMANDS.SHOW_PANEL);
    });

    it('starts in idle state', () => {
      expect(manager.getState()).to.equal('idle');
    });
  });

  describe('setIndexing()', () => {
    it('sets state to indexing', () => {
      manager.setIndexing('react');
      expect(manager.getState()).to.equal('indexing');
    });

    it('includes library name in text', () => {
      manager.setIndexing('react');
      expect(manager.getText()).to.include('react');
    });

    it('includes spinning icon', () => {
      manager.setIndexing('react');
      expect(manager.getText()).to.include('sync~spin');
    });
  });

  describe('setAnalyzing()', () => {
    it('sets state to analyzing', () => {
      manager.setAnalyzing();
      expect(manager.getState()).to.equal('analyzing');
    });

    it('includes search icon', () => {
      manager.setAnalyzing();
      expect(manager.getText()).to.include('search');
    });
  });

  describe('setReady()', () => {
    it('sets state to ready', () => {
      manager.setReady(0);
      expect(manager.getState()).to.equal('ready');
    });

    it('shows check icon when no warnings', () => {
      manager.setReady(0);
      expect(manager.getText()).to.include('check');
    });

    it('shows warning count when warnings exist', () => {
      manager.setReady(3);
      expect(manager.getText()).to.include('3');
    });

    it('includes warning icon when warnings exist', () => {
      manager.setReady(2);
      expect(manager.getText()).to.include('warning');
    });
  });

  describe('setError()', () => {
    it('sets state to error', () => {
      manager.setError('connection failed');
      expect(manager.getState()).to.equal('error');
    });

    it('includes error message in tooltip', () => {
      const item = (vscode.createStatusBarItem as SinonStub).returnValues[0] as StatusBarItem;
      manager.setError('connection failed');
      expect(item.tooltip).to.include('connection failed');
    });
  });

  describe('setDisabled()', () => {
    it('sets state to disabled', () => {
      manager.setDisabled();
      expect(manager.getState()).to.equal('disabled');
    });

    it('includes "off" in label', () => {
      manager.setDisabled();
      expect(manager.getText()).to.include('off');
    });
  });

  describe('dispose()', () => {
    it('disposes the status bar item', () => {
      const item = (vscode.createStatusBarItem as SinonStub).returnValues[0] as StatusBarItem;
      manager.dispose();
      expect((item.dispose as SinonStub).callCount).to.equal(1);
    });
  });
});

describe('VersionGuardPanel', () => {
  let vscode: VscodeAdapter;
  let panel: VersionGuardPanel;

  beforeEach(() => {
    vscode = makeVscode();
    panel = new VersionGuardPanel(vscode);
  });

  afterEach(() => sinon.restore());

  describe('show()', () => {
    it('creates a webview panel', () => {
      panel.show(makeWebviewState());
      expect((vscode.createWebviewPanel as SinonStub).callCount).to.equal(1);
    });

    it('sets the panel as open', () => {
      panel.show(makeWebviewState());
      expect(panel.isOpen()).to.be.true;
    });

    it('stores the state', () => {
      const state = makeWebviewState({ projectId: 'proj-1' });
      panel.show(state);
      expect(panel.getState()?.projectId).to.equal('proj-1');
    });

    it('reveals existing panel instead of creating new one', () => {
      panel.show(makeWebviewState());
      panel.show(makeWebviewState());
      expect((vscode.createWebviewPanel as SinonStub).callCount).to.equal(1);
    });

    it('posts update message to existing panel', () => {
      panel.show(makeWebviewState());
      const webPanel = (vscode.createWebviewPanel as SinonStub).returnValues[0] as WebviewPanel;
      panel.show(makeWebviewState({ projectId: 'updated' }));
      expect((webPanel.postMessage as SinonStub).callCount).to.equal(1);
    });
  });

  describe('update()', () => {
    it('updates HTML when panel is open', () => {
      panel.show(makeWebviewState());
      const webPanel = (vscode.createWebviewPanel as SinonStub).returnValues[0] as WebviewPanel;
      panel.update(makeWebviewState({ projectId: 'new-proj' }));
      expect(webPanel.html).to.include('new-proj');
    });

    it('updates state', () => {
      panel.show(makeWebviewState());
      panel.update(makeWebviewState({ projectId: 'new-proj' }));
      expect(panel.getState()?.projectId).to.equal('new-proj');
    });

    it('does not throw when panel is not open', () => {
      expect(() => panel.update(makeWebviewState())).to.not.throw();
    });
  });

  describe('isOpen()', () => {
    it('returns false initially', () => {
      expect(panel.isOpen()).to.be.false;
    });

    it('returns true after show()', () => {
      panel.show(makeWebviewState());
      expect(panel.isOpen()).to.be.true;
    });
  });

  describe('dispose()', () => {
    it('closes the panel', () => {
      panel.show(makeWebviewState());
      panel.dispose();
      expect(panel.isOpen()).to.be.false;
    });

    it('does not throw when panel is not open', () => {
      expect(() => panel.dispose()).to.not.throw();
    });
  });

  describe('buildHtml()', () => {
    it('includes project ID', () => {
      const html = panel.buildHtml(makeWebviewState({ projectId: 'my-project' }));
      expect(html).to.include('my-project');
    });

    it('includes library names', () => {
      const state = makeWebviewState({
        libraries: [
          {
            name: 'react',
            version: '18.x',
            documentCount: 100,
            storageBytes: 1024,
            status: 'indexed',
          },
        ],
      });
      const html = panel.buildHtml(state);
      expect(html).to.include('react');
    });

    it('shows empty state message when no libraries', () => {
      const html = panel.buildHtml(makeWebviewState({ libraries: [] }));
      expect(html).to.include('No libraries indexed yet');
    });

    it('includes total document count', () => {
      const html = panel.buildHtml(
        makeWebviewState({
          totalDocuments: 500,
          libraries: [
            {
              name: 'react',
              version: '18.x',
              documentCount: 500,
              storageBytes: 0,
              status: 'indexed',
            },
          ],
        })
      );
      expect(html).to.include('500');
    });

    it('shows indexing status badge', () => {
      const state = makeWebviewState({
        libraries: [
          { name: 'react', version: '18.x', documentCount: 0, storageBytes: 0, status: 'indexing' },
        ],
      });
      const html = panel.buildHtml(state);
      expect(html).to.include('Indexing');
    });

    it('shows error status badge', () => {
      const state = makeWebviewState({
        libraries: [
          { name: 'react', version: '18.x', documentCount: 0, storageBytes: 0, status: 'error' },
        ],
      });
      const html = panel.buildHtml(state);
      expect(html).to.include('Error');
    });

    it('formats storage bytes as KB', () => {
      const state = makeWebviewState({
        totalStorageBytes: 2048,
        libraries: [
          {
            name: 'react',
            version: '18.x',
            documentCount: 0,
            storageBytes: 2048,
            status: 'indexed',
          },
        ],
      });
      const html = panel.buildHtml(state);
      expect(html).to.include('KB');
    });

    it('formats storage bytes as MB for large sizes', () => {
      const state = makeWebviewState({
        totalStorageBytes: 2 * 1024 * 1024,
        libraries: [
          {
            name: 'react',
            version: '18.x',
            documentCount: 0,
            storageBytes: 2 * 1024 * 1024,
            status: 'indexed',
          },
        ],
      });
      const html = panel.buildHtml(state);
      expect(html).to.include('MB');
    });

    it('includes refresh button', () => {
      const html = panel.buildHtml(makeWebviewState());
      expect(html).to.include('Refresh');
    });

    it('is valid HTML with doctype', () => {
      const html = panel.buildHtml(makeWebviewState());
      expect(html).to.include('<!DOCTYPE html>');
    });
  });
});

describe('CommandRegistry', () => {
  let vscode: VscodeAdapter;
  let handlers: CommandHandlers;
  let registry: CommandRegistry;

  beforeEach(() => {
    vscode = makeVscode();
    handlers = {
      analyzeFile: sinon.stub().resolves(),
      indexLibrary: sinon.stub().resolves(),
      showPanel: sinon.stub(),
      refreshPanel: sinon.stub(),
      toggleFeature: sinon.stub(),
      clearDiagnostics: sinon.stub(),
      applyFix: sinon.stub().resolves(),
    };
    registry = new CommandRegistry(vscode, handlers);
  });

  afterEach(() => sinon.restore());

  describe('registerAll()', () => {
    it('registers all 7 commands', () => {
      registry.registerAll();
      expect((vscode.registerCommand as SinonStub).callCount).to.equal(7);
    });

    it('registers ANALYZE_FILE command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.ANALYZE_FILE);
    });

    it('registers INDEX_LIBRARY command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.INDEX_LIBRARY);
    });

    it('registers SHOW_PANEL command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.SHOW_PANEL);
    });

    it('registers REFRESH_PANEL command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.REFRESH_PANEL);
    });

    it('registers TOGGLE_FEATURE command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.TOGGLE_FEATURE);
    });

    it('registers CLEAR_DIAGNOSTICS command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.CLEAR_DIAGNOSTICS);
    });

    it('registers APPLY_FIX command', () => {
      registry.registerAll();
      const ids = (vscode.registerCommand as SinonStub).args.map((a) => a[0]);
      expect(ids).to.include(COMMANDS.APPLY_FIX);
    });

    it('invokes analyzeFile handler when command fires', async () => {
      registry.registerAll();
      const handler = (vscode.registerCommand as SinonStub).args.find(
        (a) => a[0] === COMMANDS.ANALYZE_FILE
      )?.[1];
      await handler?.();
      expect((handlers.analyzeFile as SinonStub).callCount).to.equal(1);
    });

    it('invokes toggleFeature handler when command fires', () => {
      registry.registerAll();
      const handler = (vscode.registerCommand as SinonStub).args.find(
        (a) => a[0] === COMMANDS.TOGGLE_FEATURE
      )?.[1];
      handler?.();
      expect((handlers.toggleFeature as SinonStub).callCount).to.equal(1);
    });

    it('passes warningId to applyFix handler', async () => {
      registry.registerAll();
      const handler = (vscode.registerCommand as SinonStub).args.find(
        (a) => a[0] === COMMANDS.APPLY_FIX
      )?.[1];
      await handler?.('warn-123');
      expect((handlers.applyFix as SinonStub).firstCall.args[0]).to.equal('warn-123');
    });
  });

  describe('getRegisteredCommands()', () => {
    it('returns empty array before registerAll', () => {
      expect(registry.getRegisteredCommands()).to.deep.equal([]);
    });

    it('returns all registered command IDs after registerAll', () => {
      registry.registerAll();
      expect(registry.getRegisteredCommands()).to.have.length(7);
    });
  });
});

describe('ProgressManager', () => {
  let vscode: VscodeAdapter;
  let progress: ProgressManager;

  beforeEach(() => {
    vscode = makeVscode();
    progress = new ProgressManager(vscode);
  });

  afterEach(() => sinon.restore());

  describe('withProgress()', () => {
    it('calls vscode.withProgress', async () => {
      await progress.withProgress('Test task', [], async () => {});
      expect((vscode.withProgress as SinonStub).callCount).to.equal(1);
    });

    it('executes the task', async () => {
      let ran = false;
      await progress.withProgress('Test', [], async () => {
        ran = true;
      });
      expect(ran).to.be.true;
    });

    it('passes title to vscode.withProgress', async () => {
      await progress.withProgress('My Task', [], async () => {});
      expect((vscode.withProgress as SinonStub).firstCall.args[0]).to.equal('My Task');
    });
  });

  describe('showIndexingProgress()', () => {
    it('includes library name in title', async () => {
      await progress.showIndexingProgress('react', async () => {});
      const title = (vscode.withProgress as SinonStub).firstCall.args[0] as string;
      expect(title).to.include('react');
    });

    it('provides 4 progress steps', async () => {
      await progress.showIndexingProgress('react', async () => {});
      const steps = (vscode.withProgress as SinonStub).firstCall.args[1] as unknown[];
      expect(steps).to.have.length(4);
    });

    it('executes the provided task', async () => {
      let ran = false;
      await progress.showIndexingProgress('react', async () => {
        ran = true;
      });
      expect(ran).to.be.true;
    });
  });

  describe('showAnalysisProgress()', () => {
    it('includes filename in title', async () => {
      await progress.showAnalysisProgress('src/App.tsx', async () => {});
      const title = (vscode.withProgress as SinonStub).firstCall.args[0] as string;
      expect(title).to.include('App.tsx');
    });

    it('provides 4 progress steps', async () => {
      await progress.showAnalysisProgress('src/App.tsx', async () => {});
      const steps = (vscode.withProgress as SinonStub).firstCall.args[1] as unknown[];
      expect(steps).to.have.length(4);
    });

    it('executes the provided task', async () => {
      let ran = false;
      await progress.showAnalysisProgress('src/App.tsx', async () => {
        ran = true;
      });
      expect(ran).to.be.true;
    });
  });

  describe('COMMANDS constants', () => {
    it('defines ANALYZE_FILE command', () => {
      expect(COMMANDS.ANALYZE_FILE).to.equal('devmind.versionGuard.analyzeFile');
    });

    it('defines INDEX_LIBRARY command', () => {
      expect(COMMANDS.INDEX_LIBRARY).to.equal('devmind.versionGuard.indexLibrary');
    });

    it('defines SHOW_PANEL command', () => {
      expect(COMMANDS.SHOW_PANEL).to.equal('devmind.versionGuard.showPanel');
    });

    it('defines REFRESH_PANEL command', () => {
      expect(COMMANDS.REFRESH_PANEL).to.equal('devmind.versionGuard.refreshPanel');
    });

    it('defines TOGGLE_FEATURE command', () => {
      expect(COMMANDS.TOGGLE_FEATURE).to.equal('devmind.versionGuard.toggle');
    });

    it('defines CLEAR_DIAGNOSTICS command', () => {
      expect(COMMANDS.CLEAR_DIAGNOSTICS).to.equal('devmind.versionGuard.clearDiagnostics');
    });

    it('defines APPLY_FIX command', () => {
      expect(COMMANDS.APPLY_FIX).to.equal('devmind.versionGuard.applyFix');
    });
  });
});
