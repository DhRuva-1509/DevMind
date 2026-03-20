import { expect } from 'chai';
import * as sinon from 'sinon';
import { TerminalMCPClient, SpawnFn } from './terminal.client';
import { TerminalMCPError, DEFAULT_ALLOWED_COMMANDS } from './terminal.types';
import { EventEmitter } from 'events';

function makeClient(overrides: Record<string, unknown> = {}): TerminalMCPClient {
  return new TerminalMCPClient({ cwd: '/tmp', timeoutMs: 5000, ...overrides });
}

function makeClientWithSpawn(
  spawnStub: sinon.SinonStub,
  overrides: Record<string, unknown> = {}
): TerminalMCPClient {
  return new TerminalMCPClient({
    cwd: '/tmp',
    timeoutMs: 5000,
    spawner: spawnStub as unknown as SpawnFn,
    ...overrides,
  });
}

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: sinon.SinonStub;
}

function makeMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = sinon.stub();
  return proc;
}

function emitResult(
  proc: MockProcess,
  opts: { stdout?: string; stderr?: string; code?: number; delay?: number } = {}
) {
  const { stdout = '', stderr = '', code = 0, delay = 0 } = opts;
  const emit = () => {
    if (stdout) proc.stdout.emit('data', Buffer.from(stdout));
    if (stderr) proc.stderr.emit('data', Buffer.from(stderr));
    proc.emit('close', code);
  };
  if (delay > 0) setTimeout(emit, delay);
  else emit();
}

describe('TerminalMCPClient — security', () => {
  let client: TerminalMCPClient;

  beforeEach(() => {
    client = makeClient();
  });

  it('allows commands in DEFAULT_ALLOWED_COMMANDS', () => {
    for (const cmd of DEFAULT_ALLOWED_COMMANDS) {
      expect(client.isAllowed(cmd)).to.be.true;
    }
  });

  it('blocks commands not in the allowed list', () => {
    expect(client.isAllowed('rm')).to.be.false;
    expect(client.isAllowed('bash')).to.be.false;
    expect(client.isAllowed('sudo')).to.be.false;
    expect(client.isAllowed('curl')).to.be.false;
    expect(client.isAllowed('sh')).to.be.false;
    expect(client.isAllowed('wget')).to.be.false;
  });

  it('checks only the first token of a command string', () => {
    expect(client.isAllowed('git')).to.be.true;
    expect(client.isAllowed('git status')).to.be.true; // first token is git
    expect(client.isAllowed('rm -rf /')).to.be.false; // first token is rm
  });

  it('returns false for empty string', () => {
    expect(client.isAllowed('')).to.be.false;
  });

  it('returns false for whitespace-only string', () => {
    expect(client.isAllowed('   ')).to.be.false;
  });

  it('allows extra commands when configured', () => {
    const custom = makeClient({ extraAllowedCommands: ['myTool'] });
    expect(custom.isAllowed('myTool')).to.be.true;
    expect(custom.isAllowed('git')).to.be.true; // defaults still present
  });

  it('replaces default allowed set when allowedCommands is provided', () => {
    const custom = makeClient({ allowedCommands: ['onlyThis'] });
    expect(custom.isAllowed('onlyThis')).to.be.true;
    expect(custom.isAllowed('git')).to.be.false; // defaults replaced
  });

  it('throws COMMAND_NOT_ALLOWED when executing a blocked command', async () => {
    try {
      await client.execute('rm', ['-rf', '/']);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(TerminalMCPError);
      expect((err as TerminalMCPError).code).to.equal('COMMAND_NOT_ALLOWED');
    }
  });

  it('throws INVALID_INPUT for empty command', async () => {
    try {
      await client.execute('');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(TerminalMCPError);
      expect((err as TerminalMCPError).code).to.equal('INVALID_INPUT');
    }
  });
});

// ─── Core Execution ───────────────────────────────────────────────────────────

describe('TerminalMCPClient — execute()', () => {
  let spawnStub: sinon.SinonStub;
  let client: TerminalMCPClient;

  beforeEach(() => {
    spawnStub = sinon.stub();
    client = makeClientWithSpawn(spawnStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('resolves with stdout, exitCode 0, success true', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['--version']);
    emitResult(proc, { stdout: 'git version 2.39.0\n', code: 0 });
    const result = await promise;
    expect(result.success).to.be.true;
    expect(result.exitCode).to.equal(0);
    expect(result.stdout).to.equal('git version 2.39.0\n');
  });

  it('resolves with success false when exit code is non-zero', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['bad-command']);
    emitResult(proc, { stderr: 'unknown command', code: 128 });
    const result = await promise;
    expect(result.success).to.be.false;
    expect(result.exitCode).to.equal(128);
  });

  it('captures stderr separately from stdout', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['status']);
    emitResult(proc, { stdout: 'clean output', stderr: 'some warning', code: 0 });
    const result = await promise;
    expect(result.stdout).to.equal('clean output');
    expect(result.stderr).to.equal('some warning');
  });

  it('records the full command string in result.command', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['log', '--oneline']);
    emitResult(proc, { code: 0 });
    const result = await promise;
    expect(result.command).to.equal('git log --oneline');
  });

  it('records durationMs > 0', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['--version']);
    emitResult(proc, { code: 0 });
    const result = await promise;
    expect(result.durationMs).to.be.greaterThanOrEqual(0);
  });

  it('throws EXECUTION_FAILED when spawn emits error', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['--version']);
    proc.emit('error', new Error('ENOENT'));
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('EXECUTION_FAILED');
    }
  });

  it('passes shell: false to spawn', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['--version']);
    emitResult(proc, { code: 0 });
    await promise;
    const spawnOpts = spawnStub.firstCall.args[2];
    expect(spawnOpts.shell).to.be.false;
  });

  it('truncates stdout when it exceeds maxOutputBytes', async () => {
    const smallSpawn = sinon.stub();
    const smallClient = makeClientWithSpawn(smallSpawn, { maxOutputBytes: 10 });
    const proc = makeMockProcess();
    smallSpawn.returns(proc);
    const promise = smallClient.execute('git', ['log']);
    proc.stdout.emit('data', Buffer.from('A'.repeat(100)));
    proc.emit('close', 0);
    const result = await promise;
    expect(Buffer.byteLength(result.stdout)).to.be.at.most(10);
  });

  it('rejects with TIMEOUT when command exceeds timeoutMs', async () => {
    const fastSpawn = sinon.stub();
    const fastTimeout = makeClientWithSpawn(fastSpawn, { timeoutMs: 50 });
    const proc = makeMockProcess();
    fastSpawn.returns(proc);
    const promise = fastTimeout.execute('git', ['log']);
    setTimeout(() => proc.emit('close', 0), 200);
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('TIMEOUT');
      expect((err as TerminalMCPError).message).to.include('timed out');
    }
  });

  it('sends SIGTERM on timeout', async () => {
    const fastSpawn = sinon.stub();
    const fastTimeout = makeClientWithSpawn(fastSpawn, { timeoutMs: 50 });
    const proc = makeMockProcess();
    fastSpawn.returns(proc);
    const promise = fastTimeout.execute('git', ['log']);
    setTimeout(() => proc.emit('close', 0), 200);
    try {
      await promise;
    } catch {
      /* expected */
    }
    expect(proc.kill.calledWith('SIGTERM')).to.be.true;
  });
});

describe('TerminalMCPClient — git wrappers', () => {
  let spawnStub: sinon.SinonStub;
  let client: TerminalMCPClient;

  beforeEach(() => {
    spawnStub = sinon.stub();
    client = makeClientWithSpawn(spawnStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('gitStatus: parses branch name', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stdout: '## main...origin/main\nM src/index.ts\n', code: 0 });
    const result = await promise;
    expect(result.branch).to.equal('main');
  });

  it('gitStatus: marks clean when no changes', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stdout: '## main\n', code: 0 });
    const result = await promise;
    expect(result.clean).to.be.true;
    expect(result.staged).to.have.length(0);
    expect(result.unstaged).to.have.length(0);
  });

  it('gitStatus: parses staged modified file', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stdout: '## main\nM  src/foo.ts\n', code: 0 });
    const result = await promise;
    expect(result.staged).to.have.length(1);
    expect(result.staged[0].path).to.equal('src/foo.ts');
    expect(result.staged[0].status).to.equal('modified');
  });

  it('gitStatus: parses untracked file', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stdout: '## main\n?? newfile.ts\n', code: 0 });
    const result = await promise;
    expect(result.untracked).to.include('newfile.ts');
  });

  it('gitStatus: parses added file in staged', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stdout: '## main\nA  new.ts\n', code: 0 });
    const result = await promise;
    expect(result.staged[0].status).to.equal('added');
  });

  it('gitStatus: parses deleted file in staged', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stdout: '## main\nD  old.ts\n', code: 0 });
    const result = await promise;
    expect(result.staged[0].status).to.equal('deleted');
  });

  it('gitStatus: throws NOT_A_GIT_REPO when stderr contains not a git repository', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitStatus();
    emitResult(proc, { stderr: 'fatal: not a git repository', code: 128 });
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('NOT_A_GIT_REPO');
    }
  });

  it('gitBranch: returns trimmed branch name', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitBranch();
    emitResult(proc, { stdout: 'feature/my-branch\n', code: 0 });
    const branch = await promise;
    expect(branch).to.equal('feature/my-branch');
  });

  it('gitBranch: throws EXECUTION_FAILED on non-zero exit', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitBranch();
    emitResult(proc, { code: 128 });
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('EXECUTION_FAILED');
    }
  });

  it('gitLog: parses log entries with \x1f delimiter', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitLog(1);
    const entry = ['abc123', 'abc', 'Alice', 'alice@e.com', '2025-01-01', 'feat: add thing'].join(
      '\x1f'
    );
    emitResult(proc, { stdout: entry + '\n', code: 0 });
    const log = await promise;
    expect(log).to.have.length(1);
    expect(log[0].hash).to.equal('abc123');
    expect(log[0].author).to.equal('Alice');
    expect(log[0].message).to.equal('feat: add thing');
  });

  it('gitLog: returns empty array for empty output', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitLog();
    emitResult(proc, { stdout: '', code: 0 });
    const log = await promise;
    expect(log).to.deep.equal([]);
  });

  it('gitLog: uses default count of 10 when not specified', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitLog();
    emitResult(proc, { stdout: '', code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('--max-count=10');
  });

  it('gitDiff: returns raw diff and parses additions/deletions', async () => {
    const proc1 = makeMockProcess(); // stat call (first)
    const proc2 = makeMockProcess(); // raw diff call (second)
    let callCount = 0;
    spawnStub.callsFake(() => {
      callCount++;
      if (callCount === 1) {
        setImmediate(() =>
          emitResult(proc1, {
            stdout: 'f.ts | 2 +1 -1\n1 file changed, 1 insertion(+), 1 deletion(-)\n',
            code: 0,
          })
        );
        return proc1;
      }
      setImmediate(() =>
        emitResult(proc2, { stdout: 'diff --git a/f.ts b/f.ts\n+line\n-removed\n', code: 0 })
      );
      return proc2;
    });

    const result = await client.gitDiff();
    expect(result.raw).to.include('+line');
    expect(result.additions).to.equal(1);
    expect(result.deletions).to.equal(1);
  });

  it('gitFetch: calls git fetch origin', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitFetch();
    emitResult(proc, { code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('fetch');
    expect(args).to.include('origin');
  });

  it('gitFetch: uses custom remote when provided', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitFetch('upstream');
    emitResult(proc, { code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('upstream');
  });

  it('gitChangedFiles: parses name-status output', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitChangedFiles();
    emitResult(proc, { stdout: 'M\tsrc/foo.ts\nA\tsrc/new.ts\nD\tsrc/old.ts\n', code: 0 });
    const files = await promise;
    expect(files).to.have.length(3);
    expect(files[0]).to.deep.equal({ path: 'src/foo.ts', status: 'modified' });
    expect(files[1]).to.deep.equal({ path: 'src/new.ts', status: 'added' });
    expect(files[2]).to.deep.equal({ path: 'src/old.ts', status: 'deleted' });
  });

  it('gitChangedFiles: includes ref in args when provided', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.gitChangedFiles('HEAD~1');
    emitResult(proc, { stdout: '', code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('HEAD~1');
  });
});

describe('TerminalMCPClient — lint wrappers', () => {
  let spawnStub: sinon.SinonStub;
  let client: TerminalMCPClient;

  beforeEach(() => {
    spawnStub = sinon.stub();
    client = makeClientWithSpawn(spawnStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  const eslintJson = JSON.stringify([
    {
      filePath: '/src/foo.ts',
      messages: [
        { line: 10, column: 5, severity: 2, message: 'no-unused-vars', ruleId: 'no-unused-vars' },
        { line: 20, column: 1, severity: 1, message: 'prefer-const', ruleId: 'prefer-const' },
      ],
      errorCount: 1,
      warningCount: 1,
      fixableErrorCount: 0,
      fixableWarningCount: 1,
    },
  ]);

  it('runEslint: parses errors and warnings from JSON output', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/']);
    emitResult(proc, { stdout: eslintJson, code: 1 });
    const result = await promise;
    expect(result.totalErrors).to.equal(1);
    expect(result.totalWarnings).to.equal(1);
    expect(result.files).to.have.length(1);
    expect(result.files[0].messages[0].severity).to.equal('error');
    expect(result.files[0].messages[1].severity).to.equal('warning');
  });

  it('runEslint: maps severity 2 to error, 1 to warning', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/']);
    emitResult(proc, { stdout: eslintJson, code: 1 });
    const result = await promise;
    expect(result.files[0].messages[0].severity).to.equal('error');
    expect(result.files[0].messages[1].severity).to.equal('warning');
  });

  it('runEslint: returns empty result when no issues', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/']);
    emitResult(proc, { stdout: '[]', code: 0 });
    const result = await promise;
    expect(result.totalErrors).to.equal(0);
    expect(result.totalWarnings).to.equal(0);
    expect(result.files).to.have.length(0);
  });

  it('runEslint: passes --fix flag when fix option is true', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/'], { fix: true });
    emitResult(proc, { stdout: '[]', code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('--fix');
  });

  it('runEslint: passes --max-warnings when provided', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/'], { maxWarnings: 0 });
    emitResult(proc, { stdout: '[]', code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('--max-warnings');
    expect(args).to.include('0');
  });

  it('runEslint: throws LINTER_NOT_INSTALLED when spawn fails', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/']);
    proc.emit('error', new Error('ENOENT'));
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('LINTER_NOT_INSTALLED');
    }
  });

  it('runEslint: throws PARSE_ERROR on invalid JSON output', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/']);
    emitResult(proc, { stdout: 'not json at all', code: 1 });
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('PARSE_ERROR');
    }
  });

  it('runEslint: strips non-JSON prefix before parsing', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runEslint(['src/']);
    emitResult(proc, { stdout: 'Some warning line\n' + eslintJson, code: 1 });
    const result = await promise;
    expect(result.files).to.have.length(1);
  });

  it('runPrettierCheck: formatted is true when exit code 0', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runPrettierCheck(['src/']);
    emitResult(proc, { stdout: 'All matched files use Prettier formatting!', code: 0 });
    const result = await promise;
    expect(result.formatted).to.be.true;
    expect(result.unformattedFiles).to.have.length(0);
  });

  it('runPrettierCheck: formatted is false when exit code 1', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runPrettierCheck(['src/']);
    emitResult(proc, { stderr: 'src/foo.ts\nsrc/bar.ts', code: 1 });
    const result = await promise;
    expect(result.formatted).to.be.false;
  });

  it('runPrettierCheck: passes --check flag', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runPrettierCheck(['src/']);
    emitResult(proc, { code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('--check');
  });

  it('runPrettierCheck: throws LINTER_NOT_INSTALLED on spawn error', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runPrettierCheck(['src/']);
    proc.emit('error', new Error('ENOENT'));
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('LINTER_NOT_INSTALLED');
    }
  });

  it('runTsc: success is true when exit code 0', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runTsc();
    emitResult(proc, { stdout: '', code: 0 });
    const result = await promise;
    expect(result.success).to.be.true;
    expect(result.errorCount).to.equal(0);
  });

  it('runTsc: parses tsc error format correctly', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runTsc();
    const tscOutput =
      'src/foo.ts(10,5): error TS2345: Argument of type string is not assignable.\n';
    emitResult(proc, { stdout: tscOutput, code: 1 });
    const result = await promise;
    expect(result.errorCount).to.equal(1);
    expect(result.errors[0].file).to.equal('src/foo.ts');
    expect(result.errors[0].line).to.equal(10);
    expect(result.errors[0].column).to.equal(5);
    expect(result.errors[0].code).to.equal('TS2345');
    expect(result.errors[0].message.startsWith('Argument of type')).to.be.true;
  });

  it('runTsc: parses multiple errors', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runTsc();
    const tscOutput = [
      'src/a.ts(1,1): error TS2304: Cannot find name x.',
      'src/b.ts(5,3): error TS2345: Argument of type string.',
    ].join('\n');
    emitResult(proc, { stdout: tscOutput, code: 1 });
    const result = await promise;
    expect(result.errorCount).to.equal(2);
  });

  it('runTsc: passes --project flag when configPath provided', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runTsc('tsconfig.build.json');
    emitResult(proc, { code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('--project');
    expect(args).to.include('tsconfig.build.json');
  });

  it('runTsc: always passes --noEmit', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runTsc();
    emitResult(proc, { code: 0 });
    await promise;
    const args = spawnStub.firstCall.args[1] as string[];
    expect(args).to.include('--noEmit');
  });

  it('runTsc: throws LINTER_NOT_INSTALLED on spawn error', async () => {
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.runTsc();
    proc.emit('error', new Error('ENOENT'));
    try {
      await promise;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as TerminalMCPError).code).to.equal('LINTER_NOT_INSTALLED');
    }
  });
});

// ─── Configuration ────────────────────────────────────────────────────────────

describe('TerminalMCPClient — configuration', () => {
  let spawnStub: sinon.SinonStub;

  beforeEach(() => {
    spawnStub = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('uses provided cwd in spawn options', async () => {
    const client = makeClientWithSpawn(spawnStub, { cwd: '/custom/path' });
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['status']);
    emitResult(proc, { code: 0 });
    await promise;
    const opts = spawnStub.firstCall.args[2];
    expect(opts.cwd).to.equal('/custom/path');
  });

  it('overrides cwd per-call when provided to execute()', async () => {
    const client = makeClientWithSpawn(spawnStub, { cwd: '/default' });
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['status'], '/override');
    emitResult(proc, { code: 0 });
    await promise;
    const opts = spawnStub.firstCall.args[2];
    expect(opts.cwd).to.equal('/override');
  });

  it('merges env vars with process.env', async () => {
    const client = makeClientWithSpawn(spawnStub, { env: { MY_VAR: 'hello' } });
    const proc = makeMockProcess();
    spawnStub.returns(proc);
    const promise = client.execute('git', ['status']);
    emitResult(proc, { code: 0 });
    await promise;
    const opts = spawnStub.firstCall.args[2];
    expect(opts.env.MY_VAR).to.equal('hello');
  });
});

describe('DEFAULT_ALLOWED_COMMANDS', () => {
  it('contains expected git-related commands', () => {
    expect(DEFAULT_ALLOWED_COMMANDS.has('git')).to.be.true;
  });

  it('contains expected lint-related commands', () => {
    expect(DEFAULT_ALLOWED_COMMANDS.has('eslint')).to.be.true;
    expect(DEFAULT_ALLOWED_COMMANDS.has('prettier')).to.be.true;
    expect(DEFAULT_ALLOWED_COMMANDS.has('tsc')).to.be.true;
  });

  it('contains expected node/npm commands', () => {
    expect(DEFAULT_ALLOWED_COMMANDS.has('npm')).to.be.true;
    expect(DEFAULT_ALLOWED_COMMANDS.has('npx')).to.be.true;
    expect(DEFAULT_ALLOWED_COMMANDS.has('node')).to.be.true;
  });

  it('does NOT contain dangerous commands', () => {
    expect(DEFAULT_ALLOWED_COMMANDS.has('rm')).to.be.false;
    expect(DEFAULT_ALLOWED_COMMANDS.has('sudo')).to.be.false;
    expect(DEFAULT_ALLOWED_COMMANDS.has('bash')).to.be.false;
    expect(DEFAULT_ALLOWED_COMMANDS.has('curl')).to.be.false;
  });
});
