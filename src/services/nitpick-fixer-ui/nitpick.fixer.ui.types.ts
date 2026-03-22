import {
  NitpickDiff,
  NitpickResult,
  NitpickStatus,
  FileDiff,
} from '../nitpick-fixer/nitpick.fixer.types';

export type NitpickPanelLoadingState =
  | 'idle'
  | 'running'
  | 'confirming'
  | 'committing'
  | 'success'
  | 'error';

export interface FileToggleState {
  filePath: string;
  included: boolean;
  additions: number;
  deletions: number;
  diff: string;
}

export interface NitpickPanelState {
  loadingState: NitpickPanelLoadingState;
  files: FileToggleState[];
  summary: string;
  commitMessage: string;
  remainingIssues: number;
  result: NitpickResult | null;
  errorMessage: string | null;
  progressText: string | null;
}

export type NitpickPanelMessage =
  | { command: 'accept-all' }
  | { command: 'accept-selected'; selectedFiles: string[] }
  | { command: 'reject' }
  | { command: 'toggle-file'; filePath: string; included: boolean }
  | { command: 'update-commit-message'; message: string }
  | { command: 'dismiss-error' }
  | { command: 'rerun' };

export interface NitpickPanelWebviewPanel {
  get html(): string;
  set html(v: string);
  reveal(): void;
  dispose(): void;
  postMessage(msg: unknown): void;
  onDidDispose(cb: () => void): void;
  onDidReceiveMessage(cb: (msg: NitpickPanelMessage) => void): void;
}

export interface NitpickPanelAdapter {
  createWebviewPanel(viewType: string, title: string): NitpickPanelWebviewPanel;
  showInformationMessage(msg: string): void;
  showErrorMessage(msg: string): void;
  registerCommand(id: string, handler: (...args: unknown[]) => unknown): void;
}

export const NITPICK_COMMANDS = {
  FIX_NITPICKS: 'devmind.fixNitpicks',
  SHOW_PANEL: 'devmind.nitpick.showPanel',
} as const;
