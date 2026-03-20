import {
  CONFLICT_MARKER_START,
  CONFLICT_MARKER_SEPARATOR,
  CONFLICT_MARKER_END,
  CONFLICT_MARKER_BASE,
  CONTEXT_LINES_DEFAULT,
  ConflictBlock,
  ConflictContext,
  ConflictContextValidation,
  ConflictFormat,
  ConflictParserError,
  ParseOptions,
  ParseResult,
} from './conflict.parser.types';

type ParserState = 'idle' | 'current' | 'base' | 'incoming';

export class GitConflictParserService {
  /**
   * Parse a file's content string for merge conflicts.
   * Returns a ConflictContext with all blocks, context lines, and validation.
   */
  parse(filePath: string, content: string, options: ParseOptions = {}): ParseResult {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new ConflictParserError('filePath must be a non-empty string', 'INVALID_INPUT');
    }
    if (typeof content !== 'string') {
      throw new ConflictParserError('content must be a string', 'INVALID_INPUT');
    }

    const startTime = Date.now();
    const contextLines = options.contextLines ?? CONTEXT_LINES_DEFAULT;
    const lines = this._splitLines(content);

    const conflicts = this._extractConflicts(lines, filePath);
    const { contextLinesBefore, contextLinesAfter } = this._extractContext(
      lines,
      conflicts,
      contextLines
    );

    const context: ConflictContext = {
      filePath,
      conflicts,
      conflictCount: conflicts.length,
      contextLinesBefore,
      contextLinesAfter,
      rawContent: content,
      parsedAt: new Date().toISOString(),
      validation: { isValid: true, errors: [], warnings: [] },
    };

    if (!options.skipValidation) {
      context.validation = this.validateContext(context);
    }

    return {
      context,
      hasConflicts: conflicts.length > 0,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Quick check — returns true if the content string contains any conflict markers.
   * Does not parse the full structure.
   */
  hasConflicts(content: string): boolean {
    if (typeof content !== 'string') return false;
    return content.includes(CONFLICT_MARKER_START);
  }

  /**
   * Validate a ConflictContext for completeness before passing downstream.
   * Implements the Reflection pattern validation step (AC-7, AC-8).
   */
  validateContext(context: ConflictContext): ConflictContextValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // AC-8: both sides present for every conflict
    for (let i = 0; i < context.conflicts.length; i++) {
      const c = context.conflicts[i];
      const label = `Conflict #${i + 1} (lines ${c.startLine}–${c.endLine})`;

      if (c.current.length === 0 && c.incoming.length === 0) {
        errors.push(`${label}: both current and incoming are empty`);
      } else {
        if (c.current.length === 0) {
          warnings.push(`${label}: current (HEAD) block is empty`);
        }
        if (c.incoming.length === 0) {
          warnings.push(`${label}: incoming block is empty`);
        }
      }

      // AC-3: line ranges valid
      if (c.startLine < 1) {
        errors.push(`${label}: startLine ${c.startLine} is invalid (< 1)`);
      }
      if (c.endLine < c.startLine) {
        errors.push(`${label}: endLine ${c.endLine} is before startLine ${c.startLine}`);
      }

      // AC-4: surrounding context captured
      const before = context.contextLinesBefore[i] ?? [];
      const after = context.contextLinesAfter[i] ?? [];
      if (before.length === 0 && c.startLine > 1) {
        warnings.push(`${label}: no context lines captured before conflict`);
      }
      if (after.length === 0) {
        warnings.push(`${label}: no context lines captured after conflict`);
      }
    }

    // AC-1: file path present
    if (!context.filePath || context.filePath.trim() === '') {
      errors.push('filePath is missing');
    }

    // conflictCount must match actual array length
    if (context.conflictCount !== context.conflicts.length) {
      errors.push(
        `conflictCount ${context.conflictCount} does not match actual conflicts array length ${context.conflicts.length}`
      );
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private _extractConflicts(lines: string[], filePath: string): ConflictBlock[] {
    const conflicts: ConflictBlock[] = [];
    let state: ParserState = 'idle';
    let currentBlock: string[] = [];
    let baseBlock: string[] = [];
    let incomingBlock: string[] = [];
    let startLine = 0;
    let currentLabel = '';
    let incomingLabel = '';
    let baseLabel = '';
    let format: ConflictFormat = 'standard';
    let hasBase = false;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1; // 1-based
      const line = lines[i];

      if (state === 'idle') {
        if (line.startsWith(CONFLICT_MARKER_START)) {
          state = 'current';
          startLine = lineNum;
          currentLabel = line.slice(CONFLICT_MARKER_START.length).trim();
          currentBlock = [];
          baseBlock = [];
          incomingBlock = [];
          format = 'standard';
          hasBase = false;
          continue;
        }
      } else if (state === 'current') {
        if (line.startsWith(CONFLICT_MARKER_BASE)) {
          state = 'base';
          baseLabel = line.slice(CONFLICT_MARKER_BASE.length).trim();
          format = 'diff3';
          hasBase = true;
          continue;
        }
        if (line.startsWith(CONFLICT_MARKER_SEPARATOR)) {
          state = 'incoming';
          continue;
        }
        if (line.startsWith(CONFLICT_MARKER_START)) {
          currentBlock = [];
          startLine = lineNum;
          currentLabel = line.slice(CONFLICT_MARKER_START.length).trim();
          continue;
        }
        currentBlock.push(line);
      } else if (state === 'base') {
        if (line.startsWith(CONFLICT_MARKER_SEPARATOR)) {
          state = 'incoming';
          continue;
        }
        baseBlock.push(line);
      } else if (state === 'incoming') {
        if (line.startsWith(CONFLICT_MARKER_END)) {
          incomingLabel = line.slice(CONFLICT_MARKER_END.length).trim();
          conflicts.push({
            current: [...currentBlock],
            incoming: [...incomingBlock],
            base: hasBase ? [...baseBlock] : null,
            currentLabel,
            incomingLabel,
            baseLabel: hasBase ? baseLabel : null,
            startLine,
            endLine: lineNum,
            format,
          });
          state = 'idle';
          continue;
        }
        if (line.startsWith(CONFLICT_MARKER_START)) {
          // Malformed — nested start inside incoming; treat as end of current + start of new
          // Push what we have, then reset
          incomingLabel = '(truncated)';
          conflicts.push({
            current: [...currentBlock],
            incoming: [...incomingBlock],
            base: hasBase ? [...baseBlock] : null,
            currentLabel,
            incomingLabel,
            baseLabel: hasBase ? baseLabel : null,
            startLine,
            endLine: lineNum - 1,
            format,
          });
          state = 'current';
          startLine = lineNum;
          currentLabel = line.slice(CONFLICT_MARKER_START.length).trim();
          currentBlock = [];
          baseBlock = [];
          incomingBlock = [];
          hasBase = false;
          format = 'standard';
          continue;
        }
        incomingBlock.push(line);
      }
    }

    // Unclosed conflict at EOF — incomplete block is silently dropped.
    // Complete conflicts parsed so far are returned; validateContext()
    // will surface any completeness issues downstream.
    return conflicts;
  }

  private _extractContext(
    lines: string[],
    conflicts: ConflictBlock[],
    contextLines: number
  ): {
    contextLinesBefore: Record<number, string[]>;
    contextLinesAfter: Record<number, string[]>;
  } {
    const contextLinesBefore: Record<number, string[]> = {};
    const contextLinesAfter: Record<number, string[]> = {};

    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      // startLine and endLine are 1-based
      const beforeStart = Math.max(0, conflict.startLine - 1 - contextLines);
      const beforeEnd = conflict.startLine - 1; // exclusive (0-based index of the <<<< line)

      const afterStart = conflict.endLine; // 0-based index after the >>>> line
      const afterEnd = Math.min(lines.length, conflict.endLine + contextLines);

      contextLinesBefore[i] = lines.slice(beforeStart, beforeEnd);
      contextLinesAfter[i] = lines.slice(afterStart, afterEnd);
    }

    return { contextLinesBefore, contextLinesAfter };
  }

  private _splitLines(content: string): string[] {
    return content.replace(/\r\n/g, '\n').split('\n');
  }
}
