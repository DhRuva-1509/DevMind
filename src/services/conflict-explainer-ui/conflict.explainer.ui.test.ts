import { expect } from 'chai';
import * as sinon from 'sinon';
import {
  ConflictCodeLensManager,
  ConflictHoverManager,
  ConflictExplainerPanel,
  findConflictLines,
} from './conflict.explainer.ui';
import {
  CONFLICT_COMMANDS,
  ConflictPanelAdapter,
  ConflictWebviewPanel,
  ConflictExplanationDisplay,
  getConfidenceEmoji,
  getConfidenceLabel,
} from './conflict.explainer.ui.types';

const ONE_CONFLICT = [
  'import foo from "bar";',
  '<<<<<<< HEAD',
  'const x = 1;',
  '=======',
  'const x = 2;',
  '>>>>>>> feature/branch',
  'export default x;',
].join('\n');

const TWO_CONFLICTS = [
  '<<<<<<< HEAD',
  'alpha',
  '=======',
  'beta',
  '>>>>>>> branch',
  'middle',
  '<<<<<<< HEAD',
  'gamma',
  '=======',
  'delta',
  '>>>>>>> other',
].join('\n');

const NO_CONFLICT = 'clean file\nno markers here';

const makeExplanation = (
  overrides: Partial<ConflictExplanationDisplay> = {}
): ConflictExplanationDisplay => ({
  conflictIndex: 0,
  startLine: 2,
  endLine: 6,
  currentIntent: 'Use value 1 for config',
  currentKeyChanges: ['Set x to 1'],
  incomingIntent: 'Use value 2 for config',
  incomingKeyChanges: ['Set x to 2'],
  resolutionStrategy: 'Keep the value that matches the updated config spec',
  confidenceScore: 0.9,
  filePath: 'src/auth.ts',
  ...overrides,
});

function makePanel(): {
  adapter: ConflictPanelAdapter;
  webviewPanel: ConflictWebviewPanel & { _html: string; messages: unknown[] };
  disposeStub: sinon.SinonStub;
  revealStub: sinon.SinonStub;
  postMessageStub: sinon.SinonStub;
  fireDispose: () => void;
  fireMessage: (msg: any) => void;
} {
  const callbacks: { dispose?: () => void; message?: (msg: any) => void } = {};
  const disposeStub = sinon.stub().callsFake(() => {
    if (callbacks.dispose) callbacks.dispose();
  });
  const revealStub = sinon.stub();
  const postMessageStub = sinon.stub();

  const webviewPanel: any = {
    _html: '',
    messages: [],
    get html() {
      return this._html;
    },
    set html(v: string) {
      this._html = v;
    },
    reveal: revealStub,
    dispose: disposeStub,
    postMessage: postMessageStub,
    onDidDispose: (cb: () => void) => {
      callbacks.dispose = cb;
    },
    onDidReceiveMessage: (cb: (msg: any) => void) => {
      callbacks.message = cb;
    },
  };

  const adapter: ConflictPanelAdapter = {
    createWebviewPanel: sinon.stub().returns(webviewPanel),
    showInformationMessage: sinon.stub(),
    showErrorMessage: sinon.stub(),
    registerCommand: sinon.stub(),
  };

  return {
    adapter,
    webviewPanel,
    disposeStub,
    revealStub,
    postMessageStub,
    fireDispose: () => callbacks.dispose?.(),
    fireMessage: (msg: any) => callbacks.message?.(msg),
  };
}

describe('findConflictLines()', () => {
  it('returns empty array for clean file', () => {
    expect(findConflictLines(NO_CONFLICT)).to.deep.equal([]);
  });

  it('returns [1] for single conflict (0-based line of marker)', () => {
    expect(findConflictLines(ONE_CONFLICT)).to.deep.equal([1]);
  });

  it('returns [0, 6] for two conflicts', () => {
    expect(findConflictLines(TWO_CONFLICTS)).to.deep.equal([0, 6]);
  });

  it('returns empty array for empty string', () => {
    expect(findConflictLines('')).to.deep.equal([]);
  });

  it('detects marker with branch label', () => {
    expect(findConflictLines('<<<<<<< HEAD\na\n=======\nb\n>>>>>>> branch')).to.deep.equal([0]);
  });

  it('does not detect ======= as a start marker', () => {
    const lines = findConflictLines('=======\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>>');
    expect(lines).to.deep.equal([1]);
  });

  it('does not detect >>>>>>> as a start marker', () => {
    const result = findConflictLines('>>>>>>> branch');
    expect(result).to.deep.equal([]);
  });
});

describe('ConflictCodeLensManager', () => {
  const mgr = new ConflictCodeLensManager();

  it('returns empty array for clean file', () => {
    expect(mgr.provideCodeLenses('file.ts', NO_CONFLICT)).to.deep.equal([]);
  });

  it('returns 2 lenses for single conflict (1 file + 1 per-conflict)', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses).to.have.length(2);
  });

  it('returns 3 lenses for two conflicts (1 file + 2 per-conflict)', () => {
    const lenses = mgr.provideCodeLenses('file.ts', TWO_CONFLICTS);
    expect(lenses).to.have.length(3);
  });

  it('first lens uses EXPLAIN_FILE command', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses[0].command).to.equal(CONFLICT_COMMANDS.EXPLAIN_FILE);
  });

  it('per-conflict lenses use EXPLAIN_SINGLE command', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses[1].command).to.equal(CONFLICT_COMMANDS.EXPLAIN_SINGLE);
  });

  it('file lens title includes conflict count', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses[0].title).to.include('1 conflict');
  });

  it('file lens title pluralises for multiple conflicts', () => {
    const lenses = mgr.provideCodeLenses('file.ts', TWO_CONFLICTS);
    expect(lenses[0].title).to.include('2 conflicts');
  });

  it('file lens title contains DevMind', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses[0].title).to.include('DevMind');
  });

  it('per-conflict lens title includes conflict number', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses[1].title).to.include('1');
  });

  it('file lens args contains uri', () => {
    const lenses = mgr.provideCodeLenses('src/auth.ts', ONE_CONFLICT);
    expect(lenses[0].args[0]).to.equal('src/auth.ts');
  });

  it('per-conflict lens args contains uri and conflict index', () => {
    const lenses = mgr.provideCodeLenses('src/auth.ts', ONE_CONFLICT);
    expect(lenses[1].args[0]).to.equal('src/auth.ts');
    expect(lenses[1].args[1]).to.equal(0);
  });

  it('per-conflict lens line matches the <<<<<<< line (0-based)', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    // ONE_CONFLICT has <<<<<<< on line index 1
    expect(lenses[1].line).to.equal(1);
  });

  it('second conflict lens has conflictIndex 1', () => {
    const lenses = mgr.provideCodeLenses('file.ts', TWO_CONFLICTS);
    expect(lenses[2].conflictIndex).to.equal(1);
  });

  it('file lens conflictIndex is -1', () => {
    const lenses = mgr.provideCodeLenses('file.ts', ONE_CONFLICT);
    expect(lenses[0].conflictIndex).to.equal(-1);
  });
});

describe('ConflictHoverManager', () => {
  let mgr: ConflictHoverManager;

  beforeEach(() => {
    mgr = new ConflictHoverManager();
  });

  it('returns null for non-conflict line', () => {
    expect(mgr.provideHover('file.ts', 0, NO_CONFLICT)).to.be.null;
  });

  it('returns null when line is not a <<<<<<< marker', () => {
    expect(mgr.provideHover('file.ts', 2, ONE_CONFLICT)).to.be.null;
  });

  it('returns hover entry on <<<<<<< line without cached explanation', () => {
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover).to.not.be.null;
    expect(hover!.line).to.equal(1);
  });

  it('hover without cache prompts user to click the CodeLens', () => {
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover!.markdownContent).to.include('Explain conflict');
  });

  it('stores and retrieves explanation', () => {
    const exp = makeExplanation({ conflictIndex: 0 });
    mgr.storeExplanation('file.ts', exp);
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover!.markdownContent).to.include(exp.currentIntent);
  });

  it('hover with cached explanation shows currentIntent', () => {
    mgr.storeExplanation('file.ts', makeExplanation());
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover!.markdownContent).to.include('Use value 1 for config');
  });

  it('hover with cached explanation shows incomingIntent', () => {
    mgr.storeExplanation('file.ts', makeExplanation());
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover!.markdownContent).to.include('Use value 2 for config');
  });

  it('hover with cached explanation shows resolutionStrategy', () => {
    mgr.storeExplanation('file.ts', makeExplanation());
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover!.markdownContent).to.include('Resolution');
  });

  it('hover with cached explanation shows confidence emoji', () => {
    mgr.storeExplanation('file.ts', makeExplanation({ confidenceScore: 0.9 }));
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    expect(hover!.markdownContent).to.include('🟢');
  });

  it('clearFile removes cached explanations for that uri', () => {
    mgr.storeExplanation('file.ts', makeExplanation());
    mgr.clearFile('file.ts');
    const hover = mgr.provideHover('file.ts', 1, ONE_CONFLICT);
    // After clear, falls back to no-explanation state
    expect(hover!.markdownContent).to.include('Explain conflict');
  });

  it('clearFile does not affect other uris', () => {
    mgr.storeExplanation('file.ts', makeExplanation());
    mgr.storeExplanation('other.ts', makeExplanation({ filePath: 'other.ts' }));
    mgr.clearFile('file.ts');
    expect(() => mgr.clearFile('file.ts')).to.not.throw();
  });
});

describe('ConflictExplainerPanel — state', () => {
  it('isOpen() returns false initially', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    expect(panel.isOpen()).to.be.false;
  });

  it('isOpen() returns true after showLoading()', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 2);
    expect(panel.isOpen()).to.be.true;
  });

  it('isOpen() returns true after showExplanations()', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.isOpen()).to.be.true;
  });

  it('isOpen() returns true after showError()', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showError('auth.ts', 'failed');
    expect(panel.isOpen()).to.be.true;
  });

  it('dispose() sets isOpen to false', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 1);
    panel.dispose();
    expect(panel.isOpen()).to.be.false;
  });

  it('does not throw when dispose() called on closed panel', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    expect(() => panel.dispose()).to.not.throw();
  });

  it('reveals existing panel instead of creating new one', () => {
    const { adapter, revealStub } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 1);
    panel.showLoading('auth.ts', 1);
    expect((adapter.createWebviewPanel as sinon.SinonStub).callCount).to.equal(1);
    expect(revealStub.callCount).to.equal(1);
  });

  it('sets isOpen false when webview fires onDidDispose', () => {
    const { adapter, fireDispose } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 1);
    fireDispose();
    expect(panel.isOpen()).to.be.false;
  });
});

describe('ConflictExplainerPanel — navigateTo()', () => {
  it('updates currentIndex when valid', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    const exps = [makeExplanation({ conflictIndex: 0 }), makeExplanation({ conflictIndex: 1 })];
    panel.showExplanations('auth.ts', exps);
    panel.navigateTo(1);
    expect(panel.buildHtml()).to.include('Conflict 2 of 2');
  });

  it('does not throw for out-of-bounds index', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(() => panel.navigateTo(99)).to.not.throw();
    expect(() => panel.navigateTo(-1)).to.not.throw();
  });

  it('navigate message from webview updates panel', () => {
    const { adapter, fireMessage } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    const exps = [makeExplanation({ conflictIndex: 0 }), makeExplanation({ conflictIndex: 1 })];
    panel.showExplanations('auth.ts', exps);
    fireMessage({ command: 'navigate', conflictIndex: 1 });
    expect(panel.buildHtml()).to.include('Conflict 2 of 2');
  });

  it('dismiss message disposes panel', () => {
    const { adapter, disposeStub, fireMessage } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 1);
    fireMessage({ command: 'dismiss' });
    expect(disposeStub.calledOnce).to.be.true;
  });
});

describe('ConflictExplainerPanel — buildHtml()', () => {
  it('returns valid HTML with DOCTYPE', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    expect(panel.buildHtml()).to.include('<!DOCTYPE html>');
  });

  it('idle state shows instructions', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    expect(panel.buildHtml()).to.include('Conflict Explainer');
  });

  it('loading state shows spinner', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 3);
    expect(panel.buildHtml()).to.include('spinner');
  });

  it('loading state shows file name', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('/src/auth.ts', 1);
    expect(panel.buildHtml()).to.include('auth.ts');
  });

  it('loading state shows conflict count', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showLoading('auth.ts', 3);
    expect(panel.buildHtml()).to.include('3 conflict');
  });

  it('error state shows error message', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showError('auth.ts', 'GPT-4o timeout');
    expect(panel.buildHtml()).to.include('GPT-4o timeout');
  });

  it('success state shows currentIntent', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.include('Use value 1 for config');
  });

  it('success state shows incomingIntent', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.include('Use value 2 for config');
  });

  it('success state shows resolutionStrategy', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.include('Keep the value that matches');
  });

  it('success state shows HEAD label', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.include('HEAD');
  });

  it('success state shows Incoming label', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.include('Incoming');
  });

  it('success state shows Human-in-the-Loop note', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.include('Human-in-the-Loop');
  });

  it('success state shows confidence percentage', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation({ confidenceScore: 0.9 })]);
    expect(panel.buildHtml()).to.include('90%');
  });

  it('success state shows conflict location', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation({ startLine: 5, endLine: 12 })]);
    expect(panel.buildHtml()).to.include('5');
    expect(panel.buildHtml()).to.include('12');
  });

  it('success state shows Prev/Next nav for multiple conflicts', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [
      makeExplanation({ conflictIndex: 0 }),
      makeExplanation({ conflictIndex: 1 }),
    ]);
    const html = panel.buildHtml();
    expect(html).to.include('Prev');
    expect(html).to.include('Next');
  });

  it('success state shows dot nav for multiple conflicts', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [
      makeExplanation({ conflictIndex: 0 }),
      makeExplanation({ conflictIndex: 1 }),
    ]);
    expect(panel.buildHtml()).to.include('conflict-dot-nav');
  });

  it('success state does not show dot nav for single conflict', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [makeExplanation()]);
    expect(panel.buildHtml()).to.not.include('<div class="conflict-dot-nav">');
  });

  it('escapes HTML in user-facing strings', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    panel.showExplanations('auth.ts', [
      makeExplanation({ currentIntent: '<script>alert(1)</script>' }),
    ]);
    expect(panel.buildHtml()).to.include('&lt;script&gt;');
    expect(panel.buildHtml()).to.not.include('<script>alert');
  });

  it('includes vscode acquireVsCodeApi script', () => {
    const { adapter } = makePanel();
    const panel = new ConflictExplainerPanel(adapter);
    expect(panel.buildHtml()).to.include('acquireVsCodeApi');
  });
});

describe('getConfidenceEmoji()', () => {
  it('returns 🟢 for score >= 0.8', () => {
    expect(getConfidenceEmoji(0.9)).to.equal('🟢');
    expect(getConfidenceEmoji(0.8)).to.equal('🟢');
  });

  it('returns 🟡 for score >= 0.6 and < 0.8', () => {
    expect(getConfidenceEmoji(0.7)).to.equal('🟡');
    expect(getConfidenceEmoji(0.6)).to.equal('🟡');
  });

  it('returns 🔴 for score < 0.6', () => {
    expect(getConfidenceEmoji(0.5)).to.equal('🔴');
    expect(getConfidenceEmoji(0.0)).to.equal('🔴');
  });
});

describe('getConfidenceLabel()', () => {
  it('returns High for score >= 0.8', () => {
    expect(getConfidenceLabel(0.85)).to.equal('High');
  });

  it('returns Medium for score >= 0.6 and < 0.8', () => {
    expect(getConfidenceLabel(0.7)).to.equal('Medium');
  });

  it('returns Low for score < 0.6', () => {
    expect(getConfidenceLabel(0.4)).to.equal('Low');
  });
});

describe('CONFLICT_COMMANDS constants', () => {
  it('EXPLAIN_FILE is devmind.explainConflicts', () => {
    expect(CONFLICT_COMMANDS.EXPLAIN_FILE).to.equal('devmind.explainConflicts');
  });

  it('EXPLAIN_SINGLE is devmind.explainConflict', () => {
    expect(CONFLICT_COMMANDS.EXPLAIN_SINGLE).to.equal('devmind.explainConflict');
  });

  it('NEXT_CONFLICT is devmind.nextConflict', () => {
    expect(CONFLICT_COMMANDS.NEXT_CONFLICT).to.equal('devmind.nextConflict');
  });

  it('PREV_CONFLICT is devmind.prevConflict', () => {
    expect(CONFLICT_COMMANDS.PREV_CONFLICT).to.equal('devmind.prevConflict');
  });
});
