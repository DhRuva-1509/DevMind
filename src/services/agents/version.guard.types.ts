export interface VersionGuardConfig {
  enabled?: boolean;
  topK?: number;
  maxPromptTokens?: number;
  minConfidence?: number;
  enableLogging?: boolean;
  analysisDeployment?: string;
  projectId?: string;
}

export interface ImportStatement {
  module: string;
  named: string[];
  defaultImport?: string;
  namespace?: boolean;
  line: number;
}

export interface ApiUsage {
  symbol: string;
  callText: string;
  line: number;
  character: number;
  sourceModule: string;
}

export interface ExtractedPatterns {
  filePath: string;
  language: 'typescript' | 'javascript' | 'typescriptreact' | 'javascriptreact' | 'unknown';
  imports: ImportStatement[];
  apiUsages: ApiUsage[];
  detectedLibraries: string[];
}

export interface VersionGuardWarning {
  id: string;
  library: string;
  version: string;
  symbol: string;
  message: string;
  suggestion: string;
  confidence: number;
  severity: 'error' | 'warning' | 'info';
  location: CodeLocation;
  quickFix?: QuickFix;
}

export interface CodeLocation {
  filePath: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
}

export interface QuickFix {
  title: string;
  newText: string;
  range: CodeLocation;
}

export interface AnalysisResult {
  filePath: string;
  projectId: string;
  warnings: VersionGuardWarning[];
  analyzedLibraries: string[];
  skippedLibraries: string[];
  durationMs: number;
  triggeredBy: 'save' | 'command' | 'manual';
}

export interface AnalysisPromptContext {
  library: string;
  version: string;
  codeSnippet: string;
  relevantDocs: string[];
  symbols: string[];
}

export interface OpenAIWarningOutput {
  symbol: string;
  message: string;
  suggestion: string;
  confidence: number;
  severity: 'error' | 'warning' | 'info';
  line: number;
  character: number;
}

export interface OpenAIAnalysisResponse {
  warnings: OpenAIWarningOutput[];
}

export interface InteractionLog {
  id: string;
  projectId: string;
  filePath: string;
  triggeredBy: string;
  librariesAnalyzed: string[];
  warningsFound: number;
  durationMs: number;
  timestamp: string;
  warnings: Array<{ symbol: string; library: string; severity: string }>;
}

export class VersionGuardError extends Error {
  constructor(
    message: string,
    public readonly filePath: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'VersionGuardError';
  }
}

export class FeatureDisabledError extends VersionGuardError {
  constructor(filePath: string) {
    super('Version Guard feature is disabled', filePath);
    this.name = 'FeatureDisabledError';
  }
}
