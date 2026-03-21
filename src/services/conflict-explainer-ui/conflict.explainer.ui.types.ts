export interface ConflictLensEntry {
  line: number;
  conflictIndex: number;
  command: string;
  title: string;
  args: unknown[];
}

export interface ConflictHoverEntry {
  line: number;
  markdownContent: string;
}

export interface ConflictExplanationDisplay {
  conflictIndex: number;
  startLine: number;
  endLine: number;
  currentIntent: string;
  currentKeyChanges: string[];
  incomingIntent: string;
  incomingKeyChanges: string[];
  resolutionStrategy: string;
  confidenceScore: number;
  filePath: string;
}

export type ConflictPanelLoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface ConflictPanelState {
  loadingState: ConflictPanelLoadingState;
  filePath: string | null;
  conflictCount: number;
  currentIndex: number;
  explanations: ConflictExplanationDisplay[];
  errorMessage: string | null;
}

export interface ConflictPanelAdapter {
  createWebviewPanel(viewType: string, title: string): ConflictWebviewPanel;
  showInformationMessage(msg: string): void;
  showErrorMessage(msg: string): void;
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): void;
}

export interface ConflictWebviewPanel {
  html: string;
  reveal(): void;
  dispose(): void;
  postMessage(msg: unknown): void;
  onDidDispose(cb: () => void): void;
  onDidReceiveMessage(cb: (msg: ConflictPanelMessage) => void): void;
}

export interface ConflictPanelMessage {
  command: 'navigate' | 'dismiss';
  conflictIndex?: number;
}

export interface ConflictExplainerAdapter {
  explain(filePath: string, content: string): Promise<ConflictExplainerResult>;
}

export interface ConflictExplainerResult {
  status: 'complete' | 'partial' | 'failed';
  explanations: ConflictExplanationDisplay[];
  conflictCount: number;
  errorMessage?: string;
}

export const CONFLICT_COMMANDS = {
  EXPLAIN_FILE: 'devmind.explainConflicts',
  EXPLAIN_SINGLE: 'devmind.explainConflict',
  NEXT_CONFLICT: 'devmind.nextConflict',
  PREV_CONFLICT: 'devmind.prevConflict',
} as const;

export type ConflictCommand = (typeof CONFLICT_COMMANDS)[keyof typeof CONFLICT_COMMANDS];

export function getConfidenceEmoji(score: number): string {
  if (score >= 0.8) return '🟢';
  if (score >= 0.6) return '🟡';
  return '🔴';
}

export function getConfidenceLabel(score: number): string {
  if (score >= 0.8) return 'High';
  if (score >= 0.6) return 'Medium';
  return 'Low';
}

export class ConflictUIError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_CONFLICTS_FOUND' | 'PANEL_NOT_OPEN' | 'EXPLAINER_FAILED'
  ) {
    super(message);
    this.name = 'ConflictUIError';
  }
}
