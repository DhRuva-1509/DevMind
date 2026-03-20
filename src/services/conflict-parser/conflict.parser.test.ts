import { expect } from 'chai';
import { GitConflictParserService } from './conflict.parser.service';
import {
  ConflictParserError,
  CONFLICT_MARKER_START,
  CONFLICT_MARKER_SEPARATOR,
  CONFLICT_MARKER_END,
  CONFLICT_MARKER_BASE,
} from './conflict.parser.types';

const SIMPLE_CONFLICT = [
  'line before',
  '<<<<<<< HEAD',
  'current version',
  '=======',
  'incoming version',
  '>>>>>>> feature/my-branch',
  'line after',
].join('\n');

const TWO_CONFLICTS = [
  'top line',
  '<<<<<<< HEAD',
  'current A',
  '=======',
  'incoming A',
  '>>>>>>> branch-a',
  'middle line',
  '<<<<<<< HEAD',
  'current B',
  'current B line 2',
  '=======',
  'incoming B',
  '>>>>>>> branch-b',
  'bottom line',
].join('\n');

const DIFF3_CONFLICT = [
  'before',
  '<<<<<<< HEAD',
  'current',
  '||||||| base',
  'original base',
  '=======',
  'incoming',
  '>>>>>>> feature',
  'after',
].join('\n');

const EMPTY_CURRENT = ['<<<<<<< HEAD', '=======', 'incoming only', '>>>>>>> branch'].join('\n');

const EMPTY_INCOMING = ['<<<<<<< HEAD', 'current only', '=======', '>>>>>>> branch'].join('\n');

const MULTILINE_BLOCKS = [
  'before',
  '<<<<<<< HEAD',
  'current line 1',
  'current line 2',
  'current line 3',
  '=======',
  'incoming line 1',
  'incoming line 2',
  '>>>>>>> feature',
  'after',
].join('\n');

const CRLF_CONFLICT = [
  'before\r',
  '<<<<<<< HEAD\r',
  'current\r',
  '=======\r',
  'incoming\r',
  '>>>>>>> branch\r',
  'after\r',
].join('\n');

const NO_CONFLICT = 'just normal\ncontent here\nno markers';

const parser = new GitConflictParserService();

describe('GitConflictParserService — hasConflicts()', () => {
  it('returns true when content has conflict markers', () => {
    expect(parser.hasConflicts(SIMPLE_CONFLICT)).to.be.true;
  });

  it('returns false for clean file', () => {
    expect(parser.hasConflicts(NO_CONFLICT)).to.be.false;
  });

  it('returns false for empty string', () => {
    expect(parser.hasConflicts('')).to.be.false;
  });

  it('returns false for non-string input', () => {
    expect(parser.hasConflicts(null as unknown as string)).to.be.false;
  });

  it('returns true when marker appears anywhere in content', () => {
    expect(parser.hasConflicts('some code\n<<<<<<< HEAD\nmore')).to.be.true;
  });
});

describe('GitConflictParserService — parse() input validation', () => {
  it('throws INVALID_INPUT for empty filePath', () => {
    try {
      parser.parse('', SIMPLE_CONFLICT);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(ConflictParserError);
      expect((err as ConflictParserError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for whitespace-only filePath', () => {
    try {
      parser.parse('   ', SIMPLE_CONFLICT);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ConflictParserError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT when content is not a string', () => {
    try {
      parser.parse('file.ts', null as unknown as string);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ConflictParserError).code).to.equal('INVALID_INPUT');
    }
  });

  it('does not throw for empty content string', () => {
    const result = parser.parse('file.ts', '');
    expect(result.hasConflicts).to.be.false;
  });
});

describe('GitConflictParserService — parse() result shape', () => {
  it('returns a ParseResult with context, hasConflicts, durationMs', () => {
    const result = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(result).to.have.keys(['context', 'hasConflicts', 'durationMs']);
  });

  it('sets hasConflicts: true when conflicts found', () => {
    expect(parser.parse('file.ts', SIMPLE_CONFLICT).hasConflicts).to.be.true;
  });

  it('sets hasConflicts: false when no conflicts', () => {
    expect(parser.parse('file.ts', NO_CONFLICT).hasConflicts).to.be.false;
  });

  it('sets durationMs >= 0', () => {
    expect(parser.parse('file.ts', SIMPLE_CONFLICT).durationMs).to.be.greaterThanOrEqual(0);
  });

  it('sets context.filePath', () => {
    expect(parser.parse('src/auth.ts', SIMPLE_CONFLICT).context.filePath).to.equal('src/auth.ts');
  });

  it('sets context.parsedAt as ISO string', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.parsedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('sets context.rawContent to the original content', () => {
    expect(parser.parse('file.ts', SIMPLE_CONFLICT).context.rawContent).to.equal(SIMPLE_CONFLICT);
  });

  it('sets context.conflictCount to 0 for clean file', () => {
    expect(parser.parse('file.ts', NO_CONFLICT).context.conflictCount).to.equal(0);
  });

  it('sets context.conflictCount to 1 for single conflict', () => {
    expect(parser.parse('file.ts', SIMPLE_CONFLICT).context.conflictCount).to.equal(1);
  });

  it('sets context.conflictCount to 2 for two conflicts', () => {
    expect(parser.parse('file.ts', TWO_CONFLICTS).context.conflictCount).to.equal(2);
  });
});

describe('GitConflictParserService — conflict block extraction (AC-2)', () => {
  it('extracts current block lines', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].current).to.deep.equal(['current version']);
  });

  it('extracts incoming block lines', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].incoming).to.deep.equal(['incoming version']);
  });

  it('extracts currentLabel from <<<<<<< line', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].currentLabel).to.equal('HEAD');
  });

  it('extracts incomingLabel from >>>>>>> line', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].incomingLabel).to.equal('feature/my-branch');
  });

  it('extracts multi-line current block', () => {
    const { context } = parser.parse('file.ts', MULTILINE_BLOCKS);
    expect(context.conflicts[0].current).to.deep.equal([
      'current line 1',
      'current line 2',
      'current line 3',
    ]);
  });

  it('extracts multi-line incoming block', () => {
    const { context } = parser.parse('file.ts', MULTILINE_BLOCKS);
    expect(context.conflicts[0].incoming).to.deep.equal(['incoming line 1', 'incoming line 2']);
  });

  it('handles empty current block', () => {
    const { context } = parser.parse('file.ts', EMPTY_CURRENT);
    expect(context.conflicts[0].current).to.deep.equal([]);
  });

  it('handles empty incoming block', () => {
    const { context } = parser.parse('file.ts', EMPTY_INCOMING);
    expect(context.conflicts[0].incoming).to.deep.equal([]);
  });

  it('base is null for standard format', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].base).to.be.null;
  });

  it('baseLabel is null for standard format', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].baseLabel).to.be.null;
  });
});

describe('GitConflictParserService — conflict location (AC-3)', () => {
  it('sets startLine to the 1-based line of the <<<<<<< marker', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    // 'line before' is line 1, '<<<<<<< HEAD' is line 2
    expect(context.conflicts[0].startLine).to.equal(2);
  });

  it('sets endLine to the 1-based line of the >>>>>>> marker', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    // <<<2 current3 sep4 incoming5 >>>6
    expect(context.conflicts[0].endLine).to.equal(6);
  });

  it('conflict starts at line 1 when file begins with marker', () => {
    const content = '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts[0].startLine).to.equal(1);
  });

  it('sets correct locations for second conflict in two-conflict file', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    // TWO_CONFLICTS: conflict 2 starts at line 8
    expect(context.conflicts[1].startLine).to.equal(8);
  });

  it('endLine is greater than startLine', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].endLine).to.be.greaterThan(context.conflicts[0].startLine);
  });
});

describe('GitConflictParserService — surrounding context (AC-4)', () => {
  it('captures lines before conflict', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.contextLinesBefore[0]).to.deep.equal(['line before']);
  });

  it('captures lines after conflict', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.contextLinesAfter[0]).to.deep.equal(['line after']);
  });

  it('captures up to 10 lines by default', () => {
    const prefix = Array.from({ length: 15 }, (_, i) => `pre ${i}`).join('\n');
    const content = prefix + '\n' + SIMPLE_CONFLICT;
    const { context } = parser.parse('file.ts', content);
    expect(context.contextLinesBefore[0]).to.have.length(10);
  });

  it('respects custom contextLines option', () => {
    const prefix = 'a\nb\nc\nd\ne\n';
    const content = prefix + SIMPLE_CONFLICT;
    const { context } = parser.parse('file.ts', content, { contextLines: 3 });
    expect(context.contextLinesBefore[0]).to.have.length(3);
  });

  it('captures zero before-lines when conflict is at start of file', () => {
    const content = '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.contextLinesBefore[0]).to.deep.equal([]);
  });

  it('captures zero after-lines when conflict is at end of file', () => {
    const content = 'before\n<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.contextLinesAfter[0]).to.deep.equal([]);
  });

  it('captures context for each conflict independently', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.contextLinesBefore[0]).to.be.an('array');
    expect(context.contextLinesBefore[1]).to.be.an('array');
    expect(context.contextLinesAfter[0]).to.be.an('array');
    expect(context.contextLinesAfter[1]).to.be.an('array');
  });

  it('does not include conflict marker lines in context', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    const before = context.contextLinesBefore[0];
    const after = context.contextLinesAfter[0];
    for (const line of [...before, ...after]) {
      expect(line.startsWith('<<<<<<<')).to.be.false;
      expect(line.startsWith('=======')).to.be.false;
      expect(line.startsWith('>>>>>>>')).to.be.false;
    }
  });
});

describe('GitConflictParserService — multiple conflicts (AC-5)', () => {
  it('returns two conflicts for two-conflict file', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.conflicts).to.have.length(2);
  });

  it('each conflict has independent current block', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.conflicts[0].current).to.deep.equal(['current A']);
    expect(context.conflicts[1].current).to.deep.equal(['current B', 'current B line 2']);
  });

  it('each conflict has independent incoming block', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.conflicts[0].incoming).to.deep.equal(['incoming A']);
    expect(context.conflicts[1].incoming).to.deep.equal(['incoming B']);
  });

  it('conflicts are ordered by appearance in file', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.conflicts[0].startLine).to.be.lessThan(context.conflicts[1].startLine);
  });

  it('returns correct conflictCount for three conflicts', () => {
    const three = TWO_CONFLICTS + '\n<<<<<<< HEAD\nC\n=======\nD\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', three);
    expect(context.conflictCount).to.equal(3);
  });
});

describe('GitConflictParserService — conflict formats (AC-6)', () => {
  it('detects standard format', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0].format).to.equal('standard');
  });

  it('detects diff3 format when ||||||| marker is present', () => {
    const { context } = parser.parse('file.ts', DIFF3_CONFLICT);
    expect(context.conflicts[0].format).to.equal('diff3');
  });

  it('diff3: extracts base block', () => {
    const { context } = parser.parse('file.ts', DIFF3_CONFLICT);
    expect(context.conflicts[0].base).to.deep.equal(['original base']);
  });

  it('diff3: extracts baseLabel', () => {
    const { context } = parser.parse('file.ts', DIFF3_CONFLICT);
    expect(context.conflicts[0].baseLabel).to.equal('base');
  });

  it('diff3: still extracts current and incoming correctly', () => {
    const { context } = parser.parse('file.ts', DIFF3_CONFLICT);
    expect(context.conflicts[0].current).to.deep.equal(['current']);
    expect(context.conflicts[0].incoming).to.deep.equal(['incoming']);
  });

  it('handles CRLF line endings', () => {
    const { context } = parser.parse('file.ts', CRLF_CONFLICT);
    expect(context.conflicts).to.have.length(1);
    // CRLF stripped — content should not have \r
    expect(context.conflicts[0].current[0]).to.not.include('\r');
  });

  it('handles conflict with no label on <<<<<<< line', () => {
    const content = '<<<<<<<\ncurrent\n=======\nincoming\n>>>>>>>';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts).to.have.length(1);
    expect(context.conflicts[0].currentLabel).to.equal('');
    expect(context.conflicts[0].incomingLabel).to.equal('');
  });

  it('handles conflict with commit hash as label', () => {
    const content = '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> abc1234def5678';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts[0].incomingLabel).to.equal('abc1234def5678');
  });

  it('handles conflict with full branch path as label', () => {
    const content = '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> refs/heads/feature/auth';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts[0].incomingLabel).to.equal('refs/heads/feature/auth');
  });

  it('parses file with no trailing newline', () => {
    const content = '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts).to.have.length(1);
  });
});

describe('GitConflictParserService — ConflictContext structure (AC-7)', () => {
  it('context has all required top-level keys', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context).to.have.keys([
      'filePath',
      'conflicts',
      'conflictCount',
      'contextLinesBefore',
      'contextLinesAfter',
      'rawContent',
      'parsedAt',
      'validation',
    ]);
  });

  it('each ConflictBlock has all required keys', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.conflicts[0]).to.have.keys([
      'current',
      'incoming',
      'base',
      'currentLabel',
      'incomingLabel',
      'baseLabel',
      'startLine',
      'endLine',
      'format',
    ]);
  });

  it('contextLinesBefore is keyed by 0-based conflict index', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.contextLinesBefore).to.have.property('0');
    expect(context.contextLinesBefore).to.have.property('1');
  });

  it('contextLinesAfter is keyed by 0-based conflict index', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.contextLinesAfter).to.have.property('0');
    expect(context.contextLinesAfter).to.have.property('1');
  });

  it('conflictCount equals conflicts.length', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.conflictCount).to.equal(context.conflicts.length);
  });

  it('validation object has isValid, errors, warnings', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.validation).to.have.keys(['isValid', 'errors', 'warnings']);
  });

  it('skipValidation option skips validation', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT, { skipValidation: true });
    // validation is the default uninvoked value set before validateContext call
    expect(context.validation.isValid).to.be.true;
    expect(context.validation.errors).to.deep.equal([]);
  });
});

describe('GitConflictParserService — validateContext() (AC-8)', () => {
  it('isValid: true for well-formed single conflict', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.validation.isValid).to.be.true;
  });

  it('isValid: true for two well-formed conflicts', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    expect(context.validation.isValid).to.be.true;
  });

  it('isValid: true for file with no conflicts', () => {
    const { context } = parser.parse('file.ts', NO_CONFLICT);
    expect(context.validation.isValid).to.be.true;
  });

  it('errors is empty for valid context', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.validation.errors).to.deep.equal([]);
  });

  it('adds warning when current block is empty', () => {
    const { context } = parser.parse('file.ts', EMPTY_CURRENT);
    expect(context.validation.warnings.some((w) => w.includes('current'))).to.be.true;
  });

  it('adds warning when incoming block is empty', () => {
    const { context } = parser.parse('file.ts', EMPTY_INCOMING);
    expect(context.validation.warnings.some((w) => w.includes('incoming'))).to.be.true;
  });

  it('adds error when both current and incoming are empty', () => {
    const content = '<<<<<<< HEAD\n=======\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.validation.errors.some((e) => e.includes('both current and incoming are empty')))
      .to.be.true;
    expect(context.validation.isValid).to.be.false;
  });

  it('adds error when conflictCount does not match conflicts.length', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    // manually break it
    context.conflictCount = 99;
    const validation = parser.validateContext(context);
    expect(validation.errors.some((e) => e.includes('conflictCount'))).to.be.true;
    expect(validation.isValid).to.be.false;
  });

  it('adds error when filePath is empty', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    context.filePath = '';
    const validation = parser.validateContext(context);
    expect(validation.errors.some((e) => e.includes('filePath'))).to.be.true;
    expect(validation.isValid).to.be.false;
  });

  it('adds error when startLine < 1', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    context.conflicts[0].startLine = 0;
    const validation = parser.validateContext(context);
    expect(validation.errors.some((e) => e.includes('startLine'))).to.be.true;
    expect(validation.isValid).to.be.false;
  });

  it('adds error when endLine is before startLine', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    context.conflicts[0].endLine = context.conflicts[0].startLine - 1;
    const validation = parser.validateContext(context);
    expect(validation.errors.some((e) => e.includes('endLine'))).to.be.true;
    expect(validation.isValid).to.be.false;
  });

  it('warns when no context captured before mid-file conflict', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    context.contextLinesBefore[0] = [];
    const validation = parser.validateContext(context);
    expect(validation.warnings.some((w) => w.includes('no context lines captured before'))).to.be
      .true;
  });

  it('warns when no context captured after conflict', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    context.contextLinesAfter[0] = [];
    const validation = parser.validateContext(context);
    expect(validation.warnings.some((w) => w.includes('no context lines captured after'))).to.be
      .true;
  });

  it('warnings is empty for well-formed conflict with context', () => {
    const content = 'before\n' + SIMPLE_CONFLICT + '\nafter';
    const { context } = parser.parse('file.ts', content);
    // Reparse to get fresh context with surrounding lines
    expect(context.validation.warnings).to.deep.equal([]);
  });

  it('validation can be called independently on any ConflictContext', () => {
    const { context } = parser.parse('file.ts', TWO_CONFLICTS);
    const validation = parser.validateContext(context);
    expect(validation).to.have.keys(['isValid', 'errors', 'warnings']);
  });
});

describe('GitConflictParserService — edge cases', () => {
  it('returns empty conflicts array for clean file', () => {
    const { context } = parser.parse('file.ts', NO_CONFLICT);
    expect(context.conflicts).to.deep.equal([]);
  });

  it('returns empty conflicts for empty file', () => {
    const { context } = parser.parse('file.ts', '');
    expect(context.conflicts).to.deep.equal([]);
  });

  it('handles file with only whitespace', () => {
    const { context } = parser.parse('file.ts', '   \n  \n  ');
    expect(context.conflicts).to.deep.equal([]);
  });

  it('does not throw for unclosed conflict marker at EOF', () => {
    const content = '<<<<<<< HEAD\ncurrent\n=======\nno closing marker';
    expect(() => parser.parse('file.ts', content)).to.not.throw();
  });

  it('handles large file with many conflicts', () => {
    const block = '<<<<<<< HEAD\ncurrent\n=======\nincoming\n>>>>>>> b\n';
    const content = Array.from({ length: 50 }, () => block).join('between\n');
    const { context } = parser.parse('file.ts', content);
    expect(context.conflictCount).to.equal(50);
  });

  it('does not include marker lines in current or incoming blocks', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    const allLines = [...context.conflicts[0].current, ...context.conflicts[0].incoming];
    for (const line of allLines) {
      expect(line.startsWith('<<<<<<<')).to.be.false;
      expect(line.startsWith('>>>>>>>')).to.be.false;
      expect(line.startsWith('=======')).to.be.false;
    }
  });

  it('handles conflict where current and incoming are identical', () => {
    const content = '<<<<<<< HEAD\nsame\n=======\nsame\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts[0].current).to.deep.equal(['same']);
    expect(context.conflicts[0].incoming).to.deep.equal(['same']);
  });

  it('handles file path with directories', () => {
    const { context } = parser.parse('src/services/auth/auth.service.ts', SIMPLE_CONFLICT);
    expect(context.filePath).to.equal('src/services/auth/auth.service.ts');
  });

  it('contextLinesBefore and contextLinesAfter are arrays', () => {
    const { context } = parser.parse('file.ts', SIMPLE_CONFLICT);
    expect(context.contextLinesBefore[0]).to.be.an('array');
    expect(context.contextLinesAfter[0]).to.be.an('array');
  });

  it('handles diff3 format with empty base', () => {
    const content = '<<<<<<< HEAD\ncurrent\n|||||||\n=======\nincoming\n>>>>>>> branch';
    const { context } = parser.parse('file.ts', content);
    expect(context.conflicts[0].format).to.equal('diff3');
    expect(context.conflicts[0].base).to.deep.equal([]);
  });
});

describe('Conflict marker constants', () => {
  it('CONFLICT_MARKER_START is <<<<<<<', () => {
    expect(CONFLICT_MARKER_START).to.equal('<<<<<<<');
  });

  it('CONFLICT_MARKER_SEPARATOR is =======', () => {
    expect(CONFLICT_MARKER_SEPARATOR).to.equal('=======');
  });

  it('CONFLICT_MARKER_END is >>>>>>>', () => {
    expect(CONFLICT_MARKER_END).to.equal('>>>>>>>');
  });

  it('CONFLICT_MARKER_BASE is |||||||', () => {
    expect(CONFLICT_MARKER_BASE).to.equal('|||||||');
  });
});
