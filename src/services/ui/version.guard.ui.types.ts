export type StatusBarState = 'idle' | 'indexing' | 'analyzing' | 'ready' | 'error' | 'disabled';

export interface StatusBarInfo {
  state: StatusBarState;
  label: string;
  tooltip: string;
  warningCount?: number;
  currentLibrary?: string;
}

export interface DiagnosticEntry {
  uri: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  warningId: string;
  source: string;
  code?: string;
}

export interface CodeActionEntry {
  title: string;
  newText: string;
  range: {
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
  };
  warningId: string;
  uri: string;
  isPreferred: boolean;
}

export interface IndexedLibraryInfo {
  name: string;
  version: string;
  documentCount: number;
  storageBytes: number;
  lastIndexed?: string;
  status: 'indexed' | 'indexing' | 'error' | 'pending';
}

export interface WebviewState {
  projectId: string;
  libraries: IndexedLibraryInfo[];
  totalDocuments: number;
  totalStorageBytes: number;
  lastRefreshed: string;
}

export const COMMANDS = {
  ANALYZE_FILE: 'devmind.versionGuard.analyzeFile',
  INDEX_LIBRARY: 'devmind.versionGuard.indexLibrary',
  SHOW_PANEL: 'devmind.versionGuard.showPanel',
  REFRESH_PANEL: 'devmind.versionGuard.refreshPanel',
  TOGGLE_FEATURE: 'devmind.versionGuard.toggle',
  CLEAR_DIAGNOSTICS: 'devmind.versionGuard.clearDiagnostics',
  APPLY_FIX: 'devmind.versionGuard.applyFix',
} as const;

export type CommandId = (typeof COMMANDS)[keyof typeof COMMANDS];

export interface ProgressStep {
  message: string;
  increment?: number;
}

export class UIError extends Error {
  constructor(
    message: string,
    public readonly command?: string
  ) {
    super(message);
    this.name = 'UIError';
  }
}
