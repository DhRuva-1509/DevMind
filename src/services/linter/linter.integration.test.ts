import { expect } from 'chai';
import * as sinon from 'sinon';
import { LinterIntegrationService } from './linter.integration.service';
import {
  TerminalAdapter,
  FileSystemAdapter,
  LinterNotInstalledError,
  NoLintersDetectedError,
  LinterIntegrationError,
  LINTER_CONFIG_FILES,
  INSTALL_HINTS,
  DEFAULT_LINT_PATHS,
} from './linter.integration.types';
import { LintResult, PrettierCheckResult } from '../mcp/terminal.types';

function makeLintResult(overrides: Partial<LintResult> = {}): LintResult {
  return {
    files: [
      {
        filePath: '/project/src/auth.ts',
        messages: [
          {
            line: 10,
            column: 5,
            severity: 'warning',
            message: 'no-unused-vars',
            ruleId: 'no-unused-vars',
          },
        ],
        errorCount: 0,
        warningCount: 1,
        fixableErrorCount: 0,
        fixableWarningCount: 1,
      },
    ],
    totalErrors: 0,
    totalWarnings: 1,
    fixableErrors: 0,
    fixableWarnings: 1,
    raw: '[]',
    ...overrides,
  };
}

function makeCleanLintResult(): LintResult {
  return {
    files: [],
    totalErrors: 0,
    totalWarnings: 0,
    fixableErrors: 0,
    fixableWarnings: 0,
    raw: '[]',
  };
}

function makePrettierResult(overrides: Partial<PrettierCheckResult> = {}): PrettierCheckResult {
  return {
    unformattedFiles: [],
    formatted: true,
    raw: '',
    ...overrides,
  };
}

function makeTerminalAdapter(
  overrides: Partial<TerminalAdapter> = {}
): sinon.SinonStubbedInstance<TerminalAdapter> & TerminalAdapter {
  return {
    runEslint: sinon.stub().resolves(makeCleanLintResult()),
    runPrettierCheck: sinon.stub().resolves(makePrettierResult()),
    runPrettierWrite: sinon.stub().resolves({ exitCode: 0, raw: '' }),
    execute: sinon.stub().resolves({ exitCode: 0, stdout: '', stderr: '' }),
    ...overrides,
  } as any;
}

function makeFsAdapter(
  existsFiles: string[] = [],
  fileContents: Record<string, string> = {}
): FileSystemAdapter {
  return {
    exists: sinon.stub().callsFake(async (p: string) => existsFiles.some((f) => p.endsWith(f))),
    readFile: sinon.stub().callsFake(async (p: string) => fileContents[p] ?? ''),
  };
}

function makeService(
  terminalAdapter: TerminalAdapter,
  fsAdapter: FileSystemAdapter,
  config: object = {}
): LinterIntegrationService {
  return new LinterIntegrationService(
    { cwd: '/project', enableLogging: false, ...config },
    terminalAdapter,
    fsAdapter
  );
}

describe('LinterIntegrationService', () => {
  describe('constructor', () => {
    it('creates an instance with default config', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc).to.be.instanceOf(LinterIntegrationService);
    });

    it('accepts autoFix: false', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter(), { autoFix: false });
      expect(svc).to.be.instanceOf(LinterIntegrationService);
    });

    it('accepts custom cwd', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter(), { cwd: '/custom' });
      expect(svc).to.be.instanceOf(LinterIntegrationService);
    });

    it('accepts custom timeoutMs', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter(), { timeoutMs: 10000 });
      expect(svc).to.be.instanceOf(LinterIntegrationService);
    });

    it('accepts enableLogging: true', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter(), { enableLogging: true });
      expect(svc).to.be.instanceOf(LinterIntegrationService);
    });
  });

  describe('detectLinters()', () => {
    it('returns DetectionResult with correct shape', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '8.0.0', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result).to.have.keys(['detected', 'notInstalled', 'scannedRoot']);
    });

    it('sets scannedRoot to provided cwd', async () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = await svc.detectLinters('/project');
      expect(result.scannedRoot).to.equal('/project');
    });

    it('detects ESLint when .eslintrc.json is present', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '8.0.0', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'eslint')).to.be.true;
    });

    it('detects ESLint when eslint.config.js is present', async () => {
      const fs = makeFsAdapter(['eslint.config.js']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'eslint')).to.be.true;
    });

    it('detects Prettier when .prettierrc is present', async () => {
      const fs = makeFsAdapter(['.prettierrc']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'prettier')).to.be.true;
    });

    it('detects Prettier when prettier.config.js is present', async () => {
      const fs = makeFsAdapter(['prettier.config.js']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'prettier')).to.be.true;
    });

    it('detects ruff when ruff.toml is present', async () => {
      const fs = makeFsAdapter(['ruff.toml']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'ruff')).to.be.true;
    });

    it('detects ruff when pyproject.toml has [tool.ruff] section', async () => {
      const fs = makeFsAdapter(['pyproject.toml'], {
        '/project/pyproject.toml': '[tool.ruff]\nline-length = 88\n',
      });
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'ruff')).to.be.true;
    });

    it('does not detect ruff when pyproject.toml has no [tool.ruff] section', async () => {
      const fs = makeFsAdapter(['pyproject.toml'], {
        '/project/pyproject.toml': '[tool.poetry]\nname = "myproject"\n',
      });
      const svc = makeService(makeTerminalAdapter(), fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'ruff')).to.be.false;
    });

    it('detects black when pyproject.toml has [tool.black] section', async () => {
      const fs = makeFsAdapter(['pyproject.toml'], {
        '/project/pyproject.toml': '[tool.black]\nline-length = 88\n',
      });
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.some((d) => d.kind === 'black')).to.be.true;
    });

    it('returns empty detected array when no config files found', async () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = await svc.detectLinters('/project');
      expect(result.detected).to.have.length(0);
    });

    it('sets installed: true when binary is available', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '8.0.0', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      const eslint = result.detected.find((d) => d.kind === 'eslint');
      expect(eslint?.installed).to.be.true;
    });

    it('sets installed: false when binary is not available', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).rejects(new Error('command not found'));
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      const eslint = result.detected.find((d) => d.kind === 'eslint');
      expect(eslint?.installed).to.be.false;
    });

    it('adds uninstalled linters to notInstalled list', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).rejects(new Error('command not found'));
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.notInstalled).to.include('eslint');
    });

    it('sets configFile on detected linter', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      const eslint = result.detected.find((d) => d.kind === 'eslint');
      expect(eslint?.configFile).to.equal('.eslintrc.json');
    });

    it('sets fixCommand on detected linter', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      const eslint = result.detected.find((d) => d.kind === 'eslint');
      expect(eslint?.fixCommand).to.be.a('string');
      expect(eslint?.fixCommand.includes('eslint')).to.be.true;
    });

    it('sets checkCommand on detected linter', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      const eslint = result.detected.find((d) => d.kind === 'eslint');
      expect(eslint?.checkCommand).to.be.a('string');
    });

    it('detects multiple linters simultaneously', async () => {
      const fs = makeFsAdapter(['.eslintrc.json', '.prettierrc']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.detectLinters('/project');
      expect(result.detected.length).to.be.at.least(2);
    });
  });

  describe('runLinter()', () => {
    it('returns a LinterRunResult with correct shape', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result).to.have.keys([
        'linter',
        'success',
        'appliedFixes',
        'remainingIssues',
        'raw',
        'durationMs',
        'eslintResult',
      ]);
    });

    it('sets linter on result', async () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result.linter).to.equal('eslint');
    });

    it('sets durationMs >= 0', async () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result.durationMs).to.be.at.least(0);
    });

    it('calls runEslint on terminal adapter for eslint kind', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter());
      await svc.runLinter('eslint', ['src'], '/project');
      expect((terminal.runEslint as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('passes paths to runEslint', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter());
      await svc.runLinter('eslint', ['src', 'lib'], '/project');
      const [paths] = (terminal.runEslint as sinon.SinonStub).firstCall.args;
      expect(paths).to.deep.equal(['src', 'lib']);
    });

    it('passes fix: true to runEslint when autoFix is true', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: true });
      await svc.runLinter('eslint', ['src'], '/project');
      const [, options] = (terminal.runEslint as sinon.SinonStub).firstCall.args;
      expect(options.fix).to.be.true;
    });

    it('passes fix: false to runEslint when autoFix is false', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: false });
      await svc.runLinter('eslint', ['src'], '/project');
      const [, options] = (terminal.runEslint as sinon.SinonStub).firstCall.args;
      expect(options.fix).to.not.be.true;
    });

    it('sets success: true when eslint has no errors', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.runEslint as sinon.SinonStub).resolves(makeCleanLintResult());
      const svc = makeService(terminal, makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result.success).to.be.true;
    });

    it('sets success: false when eslint has errors', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.runEslint as sinon.SinonStub).resolves(
        makeLintResult({
          totalErrors: 2,
          files: [
            {
              filePath: '/project/src/auth.ts',
              messages: [
                { line: 1, column: 1, severity: 'error', message: 'error', ruleId: 'rule' },
              ],
              errorCount: 2,
              warningCount: 0,
              fixableErrorCount: 0,
              fixableWarningCount: 0,
            },
          ],
        })
      );
      const svc = makeService(terminal, makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result.success).to.be.false;
    });

    it('sets remainingIssues correctly for eslint', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.runEslint as sinon.SinonStub).resolves(
        makeLintResult({ totalErrors: 1, totalWarnings: 2 })
      );
      const svc = makeService(terminal, makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result.remainingIssues).to.equal(3);
    });

    it('sets eslintResult on result for eslint kind', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter());
      const result = await svc.runLinter('eslint', ['src'], '/project');
      expect(result.eslintResult).to.exist;
    });

    it('calls runPrettierWrite when autoFix is true for prettier kind', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: true });
      await svc.runLinter('prettier', ['src'], '/project');
      expect((terminal.runPrettierWrite as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('calls runPrettierCheck (not write) when autoFix is false for prettier kind', async () => {
      const terminal = makeTerminalAdapter();
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: false });
      await svc.runLinter('prettier', ['src'], '/project');
      expect((terminal.runPrettierWrite as sinon.SinonStub).called).to.be.false;
      expect((terminal.runPrettierCheck as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('sets prettierResult on result for prettier kind', async () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter(), { autoFix: false });
      const result = await svc.runLinter('prettier', ['src'], '/project');
      expect(result.prettierResult).to.exist;
    });

    it('sets remainingIssues to unformatted file count for prettier', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.runPrettierCheck as sinon.SinonStub).resolves(
        makePrettierResult({
          unformattedFiles: ['src/a.ts', 'src/b.ts'],
          formatted: false,
        })
      );
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: false });
      const result = await svc.runLinter('prettier', ['src'], '/project');
      expect(result.remainingIssues).to.equal(2);
    });

    it('runs ruff via execute adapter', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '[]', stderr: '' });
      const svc = makeService(terminal, makeFsAdapter());
      await svc.runLinter('ruff', ['.'], '/project');
      expect((terminal.execute as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('passes --fix to ruff when autoFix is true', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '[]', stderr: '' });
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: true });
      await svc.runLinter('ruff', ['.'], '/project');
      const [, args] = (terminal.execute as sinon.SinonStub).firstCall.args;
      expect(args).to.include('--fix');
    });

    it('does not pass --fix to ruff when autoFix is false', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '[]', stderr: '' });
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: false });
      await svc.runLinter('ruff', ['.'], '/project');
      const [, args] = (terminal.execute as sinon.SinonStub).firstCall.args;
      expect(args).to.not.include('--fix');
    });

    it('runs black via execute adapter', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({
        exitCode: 0,
        stdout: '',
        stderr: 'All done!',
      });
      const svc = makeService(terminal, makeFsAdapter());
      await svc.runLinter('black', ['.'], '/project');
      expect((terminal.execute as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('passes --check to black when autoFix is false', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: false });
      await svc.runLinter('black', ['.'], '/project');
      const [, args] = (terminal.execute as sinon.SinonStub).firstCall.args;
      expect(args).to.include('--check');
    });

    it('does not pass --check to black when autoFix is true', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({
        exitCode: 0,
        stdout: '',
        stderr: 'All done!',
      });
      const svc = makeService(terminal, makeFsAdapter(), { autoFix: true });
      await svc.runLinter('black', ['.'], '/project');
      const [, args] = (terminal.execute as sinon.SinonStub).firstCall.args;
      expect(args).to.not.include('--check');
    });

    it('throws LinterNotInstalledError when eslint binary is missing', async () => {
      const terminal = makeTerminalAdapter();
      const err: any = new Error('LINTER_NOT_INSTALLED');
      err.code = 'LINTER_NOT_INSTALLED';
      (terminal.runEslint as sinon.SinonStub).rejects(err);
      const svc = makeService(terminal, makeFsAdapter());
      try {
        await svc.runLinter('eslint', ['src'], '/project');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(LinterNotInstalledError);
      }
    });

    it('throws LinterNotInstalledError when prettier binary is missing', async () => {
      const terminal = makeTerminalAdapter();
      const err: any = new Error('LINTER_NOT_INSTALLED');
      err.code = 'LINTER_NOT_INSTALLED';
      (terminal.runPrettierWrite as sinon.SinonStub).rejects(err);
      (terminal.runPrettierCheck as sinon.SinonStub).rejects(err);
      const svc = makeService(terminal, makeFsAdapter());
      try {
        await svc.runLinter('prettier', ['src'], '/project');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(LinterNotInstalledError);
      }
    });

    it('throws LinterNotInstalledError when ruff binary is missing', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).rejects(new Error('command not found: ruff'));
      const svc = makeService(terminal, makeFsAdapter());
      try {
        await svc.runLinter('ruff', ['.'], '/project');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(LinterNotInstalledError);
      }
    });

    it('throws LinterNotInstalledError when black binary is missing', async () => {
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).rejects(new Error('command not found: black'));
      const svc = makeService(terminal, makeFsAdapter());
      try {
        await svc.runLinter('black', ['.'], '/project');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(LinterNotInstalledError);
      }
    });

    it('LinterNotInstalledError message includes install hint', () => {
      const err = new LinterNotInstalledError('eslint');
      expect(err.message).to.include('npm install');
    });

    it('LinterNotInstalledError exposes linter property', () => {
      const err = new LinterNotInstalledError('prettier');
      expect(err.linter).to.equal('prettier');
    });
  });

  describe('runAll()', () => {
    it('returns a LinterSuiteResult with correct shape', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.runAll(['src'], '/project');
      expect(result).to.have.keys([
        'cwd',
        'results',
        'allFixes',
        'totalRemainingIssues',
        'completedAt',
        'durationMs',
      ]);
    });

    it('sets cwd on result', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.runAll(['src'], '/project');
      expect(result.cwd).to.equal('/project');
    });

    it('sets completedAt as ISO string', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.runAll(['src'], '/project');
      expect(new Date(result.completedAt).toISOString()).to.equal(result.completedAt);
    });

    it('sets durationMs >= 0', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.runAll(['src'], '/project');
      expect(result.durationMs).to.be.at.least(0);
    });

    it('throws NoLintersDetectedError when no configs found', async () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      try {
        await svc.runAll(['src'], '/project');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(NoLintersDetectedError);
      }
    });

    it('NoLintersDetectedError has correct code', () => {
      const err = new NoLintersDetectedError('/project');
      expect(err.code).to.equal('NO_LINTERS_DETECTED');
    });

    it('NoLintersDetectedError message includes cwd', () => {
      const err = new NoLintersDetectedError('/project');
      expect(err.message).to.include('/project');
    });

    it('throws LinterNotInstalledError when detected linter is not installed', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      // Binary check fails → not installed
      (terminal.execute as sinon.SinonStub).rejects(new Error('not found'));
      const svc = makeService(terminal, fs);
      try {
        await svc.runAll(['src'], '/project');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(LinterNotInstalledError);
      }
    });

    it('runs all detected linters', async () => {
      const fs = makeFsAdapter(['.eslintrc.json', '.prettierrc']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      const svc = makeService(terminal, fs);
      const result = await svc.runAll(['src'], '/project');
      expect(result.results.length).to.be.at.least(2);
    });

    it('aggregates allFixes across linters', async () => {
      const fs = makeFsAdapter(['.eslintrc.json', '.prettierrc']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      (terminal.runPrettierWrite as sinon.SinonStub).resolves({
        exitCode: 0,
        raw: 'src/auth.ts 12ms\n',
      });
      (terminal.runPrettierCheck as sinon.SinonStub).resolves(makePrettierResult());
      const svc = makeService(terminal, fs, { autoFix: true });
      const result = await svc.runAll(['src'], '/project');
      expect(result.allFixes).to.be.an('array');
    });

    it('aggregates totalRemainingIssues across linters', async () => {
      const fs = makeFsAdapter(['.eslintrc.json']);
      const terminal = makeTerminalAdapter();
      (terminal.execute as sinon.SinonStub).resolves({ exitCode: 0, stdout: '', stderr: '' });
      (terminal.runEslint as sinon.SinonStub).resolves(
        makeLintResult({ totalErrors: 2, totalWarnings: 1 })
      );
      const svc = makeService(terminal, fs);
      const result = await svc.runAll(['src'], '/project');
      expect(result.totalRemainingIssues).to.equal(3);
    });
  });

  describe('parseEslintFixes()', () => {
    it('returns empty array when wasFixed is false', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parseEslintFixes(makeLintResult(), false);
      expect(fixes).to.have.length(0);
    });

    it('returns AppliedFix for each fixable message with ruleId', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = makeLintResult({
        files: [
          {
            filePath: '/project/src/auth.ts',
            messages: [
              {
                line: 1,
                column: 1,
                severity: 'warning',
                message: 'no-unused-vars',
                ruleId: 'no-unused-vars',
              },
            ],
            errorCount: 0,
            warningCount: 1,
            fixableErrorCount: 0,
            fixableWarningCount: 1,
          },
        ],
      });
      const fixes = svc.parseEslintFixes(result, true);
      expect(fixes.length).to.be.at.least(1);
      expect(fixes[0].ruleId).to.equal('no-unused-vars');
    });

    it('sets linter: eslint on each fix', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parseEslintFixes(makeLintResult(), true);
      fixes.forEach((f) => expect(f.linter).to.equal('eslint'));
    });

    it('sets filePath on each fix', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parseEslintFixes(makeLintResult(), true);
      fixes.forEach((f) => expect(f.filePath).to.be.a('string'));
    });

    it('returns generic fix when no messages remain but fixable count > 0', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = makeLintResult({
        files: [
          {
            filePath: '/project/src/auth.ts',
            messages: [],
            errorCount: 0,
            warningCount: 0,
            fixableErrorCount: 0,
            fixableWarningCount: 2,
          },
        ],
      });
      const fixes = svc.parseEslintFixes(result, true);
      expect(fixes.length).to.be.at.least(1);
      expect(fixes[0].ruleId).to.be.null;
    });

    it('returns empty array when no fixable issues', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const result = makeLintResult({
        files: [
          {
            filePath: '/project/src/auth.ts',
            messages: [],
            errorCount: 0,
            warningCount: 0,
            fixableErrorCount: 0,
            fixableWarningCount: 0,
          },
        ],
        totalErrors: 0,
        totalWarnings: 0,
      });
      const fixes = svc.parseEslintFixes(result, true);
      expect(fixes).to.have.length(0);
    });
  });

  describe('parsePrettierFixes()', () => {
    it('returns empty array when wasFixed is false', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parsePrettierFixes(
        makePrettierResult({ unformattedFiles: ['src/a.ts'], formatted: false }),
        false
      );
      expect(fixes).to.have.length(0);
    });

    it('returns one AppliedFix per unformatted file', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parsePrettierFixes(
        makePrettierResult({ unformattedFiles: ['src/a.ts', 'src/b.ts'], formatted: false }),
        true
      );
      expect(fixes).to.have.length(2);
    });

    it('sets linter: prettier on each fix', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parsePrettierFixes(
        makePrettierResult({ unformattedFiles: ['src/a.ts'], formatted: false }),
        true
      );
      expect(fixes[0].linter).to.equal('prettier');
    });

    it('sets filePath correctly', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parsePrettierFixes(
        makePrettierResult({ unformattedFiles: ['src/a.ts'], formatted: false }),
        true
      );
      expect(fixes[0].filePath).to.equal('src/a.ts');
    });

    it('sets ruleId: null for prettier fixes', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parsePrettierFixes(
        makePrettierResult({ unformattedFiles: ['src/a.ts'], formatted: false }),
        true
      );
      expect(fixes[0].ruleId).to.be.null;
    });

    it('returns empty array when formatted is true', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      const fixes = svc.parsePrettierFixes(
        makePrettierResult({ unformattedFiles: [], formatted: true }),
        true
      );
      expect(fixes).to.have.length(0);
    });
  });

  describe('getFixCommand()', () => {
    it('returns fix command string for eslint', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getFixCommand('eslint')).to.include('eslint');
      expect(svc.getFixCommand('eslint')).to.include('--fix');
    });

    it('returns fix command string for prettier', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getFixCommand('prettier')).to.include('prettier');
      expect(svc.getFixCommand('prettier')).to.include('--write');
    });

    it('returns fix command string for ruff', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getFixCommand('ruff')).to.include('ruff');
      expect(svc.getFixCommand('ruff')).to.include('--fix');
    });

    it('returns fix command string for black', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getFixCommand('black')).to.include('black');
    });
  });

  describe('getCheckCommand()', () => {
    it('returns check command string for eslint', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getCheckCommand('eslint')).to.include('eslint');
    });

    it('returns check command string for prettier', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getCheckCommand('prettier')).to.include('--check');
    });

    it('returns check command string for ruff', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getCheckCommand('ruff')).to.include('ruff');
    });

    it('returns check command string for black', () => {
      const svc = makeService(makeTerminalAdapter(), makeFsAdapter());
      expect(svc.getCheckCommand('black')).to.include('--check');
    });
  });

  describe('LINTER_CONFIG_FILES', () => {
    it('has entries for all four linters', () => {
      expect(LINTER_CONFIG_FILES).to.have.keys(['eslint', 'prettier', 'ruff', 'black']);
    });

    it('eslint includes .eslintrc.json', () => {
      expect(LINTER_CONFIG_FILES.eslint).to.include('.eslintrc.json');
    });

    it('eslint includes eslint.config.js', () => {
      expect(LINTER_CONFIG_FILES.eslint).to.include('eslint.config.js');
    });

    it('prettier includes .prettierrc', () => {
      expect(LINTER_CONFIG_FILES.prettier).to.include('.prettierrc');
    });

    it('ruff includes ruff.toml', () => {
      expect(LINTER_CONFIG_FILES.ruff).to.include('ruff.toml');
    });

    it('ruff includes pyproject.toml', () => {
      expect(LINTER_CONFIG_FILES.ruff).to.include('pyproject.toml');
    });

    it('black includes pyproject.toml', () => {
      expect(LINTER_CONFIG_FILES.black).to.include('pyproject.toml');
    });
  });

  describe('INSTALL_HINTS', () => {
    it('has hints for all four linters', () => {
      expect(INSTALL_HINTS).to.have.keys(['eslint', 'prettier', 'ruff', 'black']);
    });

    it('eslint hint references npm', () => {
      expect(INSTALL_HINTS.eslint).to.include('npm');
    });

    it('prettier hint references npm', () => {
      expect(INSTALL_HINTS.prettier).to.include('npm');
    });

    it('ruff hint references pip', () => {
      expect(INSTALL_HINTS.ruff).to.include('pip');
    });

    it('black hint references pip', () => {
      expect(INSTALL_HINTS.black).to.include('pip');
    });
  });

  describe('DEFAULT_LINT_PATHS', () => {
    it('has paths for all four linters', () => {
      expect(DEFAULT_LINT_PATHS).to.have.keys(['eslint', 'prettier', 'ruff', 'black']);
    });

    it('each linter has at least one default path', () => {
      (['eslint', 'prettier', 'ruff', 'black'] as const).forEach((k) => {
        expect(DEFAULT_LINT_PATHS[k].length).to.be.at.least(1);
      });
    });
  });

  describe('LinterIntegrationError', () => {
    it('has correct name', () => {
      const err = new LinterIntegrationError('msg', 'RUN_FAILED');
      expect(err.name).to.equal('LinterIntegrationError');
    });

    it('exposes code property', () => {
      const err = new LinterIntegrationError('msg', 'INVALID_INPUT');
      expect(err.code).to.equal('INVALID_INPUT');
    });

    it('exposes cause property', () => {
      const cause = new Error('cause');
      const err = new LinterIntegrationError('msg', 'RUN_FAILED', cause);
      expect(err.cause).to.equal(cause);
    });
  });

  describe('LinterNotInstalledError', () => {
    it('has correct name', () => {
      const err = new LinterNotInstalledError('eslint');
      expect(err.name).to.equal('LinterNotInstalledError');
    });

    it('has code LINTER_NOT_INSTALLED', () => {
      const err = new LinterNotInstalledError('ruff');
      expect(err.code).to.equal('LINTER_NOT_INSTALLED');
    });

    it('exposes linter property', () => {
      const err = new LinterNotInstalledError('black');
      expect(err.linter).to.equal('black');
    });

    it('message includes linter name', () => {
      const err = new LinterNotInstalledError('prettier');
      expect(err.message).to.include('prettier');
    });

    it('message includes install hint', () => {
      const err = new LinterNotInstalledError('eslint');
      expect(err.message).to.include('npm install');
    });
  });

  describe('NoLintersDetectedError', () => {
    it('has correct name', () => {
      const err = new NoLintersDetectedError('/project');
      expect(err.name).to.equal('NoLintersDetectedError');
    });

    it('has code NO_LINTERS_DETECTED', () => {
      const err = new NoLintersDetectedError('/project');
      expect(err.code).to.equal('NO_LINTERS_DETECTED');
    });

    it('message includes cwd', () => {
      const err = new NoLintersDetectedError('/my/project');
      expect(err.message).to.include('/my/project');
    });

    it('message mentions config files', () => {
      const err = new NoLintersDetectedError('/project');
      expect(err.message.toLowerCase()).to.include('config');
    });
  });
});
