export const CONFLICT_MARKER_START = '<<<<<<<';
export const CONFLICT_MARKER_SEPARATOR = '=======';
export const CONFLICT_MARKER_END = '>>>>>>>';

export const CONFLICT_MARKER_BASE = '|||||||';

export const CONTEXT_LINES_DEFAULT = 10;

export type ConflictFormat = 'standard' | 'diff3' | 'zdiff3';

export interface ConflictBlock {
  current: string[];
  incoming: string[];
  base: string[] | null;
  currentLabel: string;
  incomingLabel: string;
  baseLabel: string | null;
  startLine: number;
  endLine: number;
  format: ConflictFormat;
}

export interface ConflictContext {
  filePath: string;
  conflicts: ConflictBlock[];
  conflictCount: number;
  contextLinesBefore: Record<number, string[]>;
  contextLinesAfter: Record<number, string[]>;
  rawContent: string;
  parsedAt: string;
  validation: ConflictContextValidation;
}

export interface ConflictContextValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ParseOptions {
  contextLines?: number;
  skipValidation?: boolean;
}

export interface ParseResult {
  context: ConflictContext;
  hasConflicts: boolean;
  durationMs: number;
}

export class ConflictParserError extends Error {
  constructor(
    message: string,
    public readonly code: ConflictParserErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ConflictParserError';
  }
}

export type ConflictParserErrorCode =
  | 'INVALID_INPUT'
  | 'MALFORMED_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'EMPTY_FILE';
