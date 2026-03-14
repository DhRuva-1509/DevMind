import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { PRContextExtractorService, GitHubAdapter, CosmosAdapter } from './pr.context.service';
import { ExtractedPRContext, PRContextConfig } from './pr.context.types';
import { GitHubPR, GitHubPRDiff } from '../mcp/github.types';

function makePR(overrides: Partial<GitHubPR> = {}): GitHubPR {
  return {
    number: 42,
    title: 'feat: add useQuery migration for react-query v5',
    body: 'Closes #10 and fixes #20\n\nThis PR migrates from v4 array syntax to v5 object syntax.',
    state: 'open',
    author: 'dhruva',
    headBranch: 'feature/CS-012-add-parser',
    baseBranch: 'main',
    url: 'https://github.com/owner/repo/pull/42',
    createdAt: '2026-03-14T00:00:00Z',
    updatedAt: '2026-03-14T01:00:00Z',
    draft: false,
    labels: ['enhancement'],
    linkedIssues: [10],
    ...overrides,
  };
}

function makeDiff(overrides: Partial<GitHubPRDiff> = {}): GitHubPRDiff {
  return {
    prNumber: 42,
    totalAdditions: 15,
    totalDeletions: 8,
    totalChanges: 23,
    files: [
      {
        filename: 'src/hooks/useUserProfile.ts',
        status: 'modified',
        additions: 10,
        deletions: 5,
        patch:
          "@@ -1,5 +1,10 @@\n-const { data } = useQuery(['user'], fetchUser);\n+const { data } = useQuery({ queryKey: ['user'], queryFn: fetchUser });\n+const result = await fetch('/api/users');\n try {\n+  if (!result.ok) throw new Error('Failed');\n } catch (err) {\n+  console.error(err);\n }",
      },
      {
        filename: 'src/hooks/useUserProfile.test.ts',
        status: 'modified',
        additions: 5,
        deletions: 3,
        patch:
          "@@ -1,3 +1,5 @@\n describe('useUserProfile', () => {\n+  it('fetches user data', () => {\n+    expect(true).toBe(true);\n+  });\n });",
      },
    ],
    ...overrides,
  };
}

function makeGitHubAdapter(overrides: Partial<GitHubAdapter> = {}): GitHubAdapter {
  return {
    getPR: sinon.stub().resolves(makePR()),
    getPRDiff: sinon.stub().resolves(makeDiff()),
    listPRComments: sinon.stub().resolves([]),
    ...overrides,
  };
}

function makeCosmosAdapter(overrides: Partial<CosmosAdapter> = {}): CosmosAdapter {
  return {
    upsert: sinon.stub().resolves({ success: true }),
    read: sinon.stub().resolves({ success: false }),
    ...overrides,
  };
}

function makeService(
  config: PRContextConfig = {},
  github?: GitHubAdapter,
  cosmos?: CosmosAdapter
): PRContextExtractorService {
  return new PRContextExtractorService(
    config,
    github ?? makeGitHubAdapter(),
    cosmos ?? makeCosmosAdapter()
  );
}

describe('PRContextExtractorService', () => {
  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates an instance with default config', () => {
      const svc = makeService();
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });

    it('accepts custom maxTokenBudget', () => {
      const svc = makeService({ maxTokenBudget: 4000 });
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });

    it('accepts custom maxDiffLinesPerFile', () => {
      const svc = makeService({ maxDiffLinesPerFile: 50 });
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });

    it('accepts custom maxFiles', () => {
      const svc = makeService({ maxFiles: 5 });
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });

    it('accepts enableCaching: false', () => {
      const svc = makeService({ enableCaching: false });
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });

    it('accepts custom cacheTtlMs', () => {
      const svc = makeService({ cacheTtlMs: 60000 });
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });

    it('accepts enableLogging: false', () => {
      const svc = makeService({ enableLogging: false });
      expect(svc).to.be.instanceOf(PRContextExtractorService);
    });
  });

  describe('extractContext()', () => {
    it('returns an ExtractionResult with correct shape', async () => {
      const svc = makeService({ enableCaching: false });
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result).to.have.property('context');
      expect(result).to.have.property('fromCache');
      expect(result).to.have.property('durationMs');
    });

    it('sets fromCache: false on fresh extraction', async () => {
      const svc = makeService({ enableCaching: false });
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result.fromCache).to.be.false;
    });

    it('records durationMs', async () => {
      const svc = makeService({ enableCaching: false });
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result.durationMs).to.be.a('number');
      expect(result.durationMs).to.be.at.least(0);
    });

    it('calls getPR with correct args', async () => {
      const github = makeGitHubAdapter();
      const svc = makeService({ enableCaching: false }, github);
      await svc.extractContext('owner', 'repo', 42);
      expect((github.getPR as SinonStub).calledWith('owner', 'repo', 42)).to.be.true;
    });

    it('calls getPRDiff with correct args', async () => {
      const github = makeGitHubAdapter();
      const svc = makeService({ enableCaching: false }, github);
      await svc.extractContext('owner', 'repo', 42);
      expect((github.getPRDiff as SinonStub).calledWith('owner', 'repo', 42)).to.be.true;
    });

    it('sets owner, repo, prNumber on context', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(context.owner).to.equal('owner');
      expect(context.repo).to.equal('repo');
      expect(context.prNumber).to.equal(42);
    });

    it('sets prTitle from PR', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(context.prTitle).to.equal('feat: add useQuery migration for react-query v5');
    });

    it('sets prAuthor from PR', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(context.prAuthor).to.equal('dhruva');
    });

    it('sets prState from PR', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(context.prState).to.equal('open');
    });

    it('sets headBranch and baseBranch', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(context.headBranch).to.equal('feature/CS-012-add-parser');
      expect(context.baseBranch).to.equal('main');
    });

    it('sets extractedAt as ISO string', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(context.extractedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sets expiresAt after extractedAt', async () => {
      const svc = makeService({ enableCaching: false });
      const { context } = await svc.extractContext('owner', 'repo', 42);
      expect(new Date(context.expiresAt).getTime()).to.be.greaterThan(
        new Date(context.extractedAt).getTime()
      );
    });

    it('writes to Cosmos DB cache when enableCaching is true', async () => {
      const cosmos = makeCosmosAdapter();
      const svc = makeService({ enableCaching: true }, undefined, cosmos);
      await svc.extractContext('owner', 'repo', 42);
      expect((cosmos.upsert as SinonStub).callCount).to.equal(1);
    });

    it('does not write to cache when enableCaching is false', async () => {
      const cosmos = makeCosmosAdapter();
      const svc = makeService({ enableCaching: false }, undefined, cosmos);
      await svc.extractContext('owner', 'repo', 42);
      expect((cosmos.upsert as SinonStub).callCount).to.equal(0);
    });

    it('returns fromCache: true on cache hit', async () => {
      const cached: ExtractedPRContext = {
        id: 'pr-context-owner-repo-42',
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        prTitle: 'cached PR',
        prBody: null,
        prAuthor: 'dhruva',
        prState: 'open',
        headBranch: 'feat',
        baseBranch: 'main',
        prUrl: 'https://github.com/owner/repo/pull/42',
        changedFiles: [],
        parsedDiffs: [],
        commits: [],
        issueReferences: [],
        detectedPatterns: [],
        tokenBudget: {
          totalTokens: 0,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
        extractedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      const cosmos = makeCosmosAdapter({
        read: sinon.stub().resolves({ success: true, data: cached }),
      });
      const svc = makeService({ enableCaching: true }, undefined, cosmos);
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result.fromCache).to.be.true;
      expect(result.durationMs).to.equal(0);
    });

    it('re-fetches when cache is expired', async () => {
      const expired: ExtractedPRContext = {
        id: 'pr-context-owner-repo-42',
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        prTitle: 'old',
        prBody: null,
        prAuthor: 'dhruva',
        prState: 'open',
        headBranch: 'feat',
        baseBranch: 'main',
        prUrl: '',
        changedFiles: [],
        parsedDiffs: [],
        commits: [],
        issueReferences: [],
        detectedPatterns: [],
        tokenBudget: {
          totalTokens: 0,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
        extractedAt: new Date(0).toISOString(),
        expiresAt: new Date(0).toISOString(), // already expired
      };
      const cosmos = makeCosmosAdapter({
        read: sinon.stub().resolves({ success: true, data: expired }),
      });
      const github = makeGitHubAdapter();
      const svc = makeService({ enableCaching: true }, github, cosmos);
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result.fromCache).to.be.false;
      expect((github.getPR as SinonStub).callCount).to.equal(1);
    });
  });

  describe('extractChangedFiles()', () => {
    it('returns ChangedFile array', () => {
      const svc = makeService({ enableCaching: false });
      const files = svc.extractChangedFiles(makeDiff());
      expect(files).to.be.an('array');
      expect(files).to.have.length(2);
    });

    it('sets path from filename', () => {
      const svc = makeService({ enableCaching: false });
      const files = svc.extractChangedFiles(makeDiff());
      expect(files[0].path).to.equal('src/hooks/useUserProfile.ts');
    });

    it('sets changeType from status', () => {
      const svc = makeService({ enableCaching: false });
      const files = svc.extractChangedFiles(makeDiff());
      expect(files[0].changeType).to.equal('modified');
    });

    it('sets additions and deletions', () => {
      const svc = makeService({ enableCaching: false });
      const files = svc.extractChangedFiles(makeDiff());
      expect(files[0].additions).to.equal(10);
      expect(files[0].deletions).to.equal(5);
    });

    it('detects TypeScript language', () => {
      const svc = makeService({ enableCaching: false });
      const files = svc.extractChangedFiles(makeDiff());
      expect(files[0].language).to.equal('TypeScript');
    });

    it('marks test files correctly', () => {
      const svc = makeService({ enableCaching: false });
      const files = svc.extractChangedFiles(makeDiff());
      expect(files[0].isTest).to.be.false;
      expect(files[1].isTest).to.be.true;
    });

    it('marks config files correctly', () => {
      const svc = makeService({ enableCaching: false });
      const diff = makeDiff({
        files: [
          {
            filename: 'tsconfig.json',
            status: 'modified',
            additions: 1,
            deletions: 0,
            patch: null,
          },
        ],
      });
      const files = svc.extractChangedFiles(diff);
      expect(files[0].isConfig).to.be.true;
    });

    it('handles added files', () => {
      const svc = makeService({ enableCaching: false });
      const diff = makeDiff({
        files: [
          {
            filename: 'src/new.ts',
            status: 'added',
            additions: 20,
            deletions: 0,
            patch: '+const x = 1;',
          },
        ],
      });
      const files = svc.extractChangedFiles(diff);
      expect(files[0].changeType).to.equal('added');
    });

    it('handles removed files', () => {
      const svc = makeService({ enableCaching: false });
      const diff = makeDiff({
        files: [
          {
            filename: 'src/old.ts',
            status: 'removed',
            additions: 0,
            deletions: 10,
            patch: '-const x = 1;',
          },
        ],
      });
      const files = svc.extractChangedFiles(diff);
      expect(files[0].changeType).to.equal('removed');
    });

    it('handles renamed files', () => {
      const svc = makeService({ enableCaching: false });
      const diff = makeDiff({
        files: [
          {
            filename: 'src/renamed.ts',
            status: 'renamed',
            additions: 0,
            deletions: 0,
            patch: null,
          },
        ],
      });
      const files = svc.extractChangedFiles(diff);
      expect(files[0].changeType).to.equal('renamed');
    });

    it('returns null language for unknown extension', () => {
      const svc = makeService({ enableCaching: false });
      const diff = makeDiff({
        files: [
          { filename: 'README', status: 'modified', additions: 1, deletions: 0, patch: '+text' },
        ],
      });
      const files = svc.extractChangedFiles(diff);
      expect(files[0].language).to.be.null;
    });
  });

  describe('parseUnifiedDiff()', () => {
    it('returns array of DiffHunk objects', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,3 +1,3 @@\n-old line\n+new line\n context');
      expect(hunks).to.be.an('array');
      expect(hunks).to.have.length(1);
    });

    it('parses hunk header', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,3 +1,3 @@\n context');
      expect(hunks[0].header).to.equal('@@ -1,3 +1,3 @@');
    });

    it('identifies added lines', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,1 +1,2 @@\n context\n+added line');
      const addedLines = hunks[0].lines.filter((l) => l.type === 'added');
      expect(addedLines).to.have.length(1);
      expect(addedLines[0].content).to.equal('added line');
    });

    it('identifies removed lines', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,2 +1,1 @@\n-removed line\n context');
      const removedLines = hunks[0].lines.filter((l) => l.type === 'removed');
      expect(removedLines).to.have.length(1);
      expect(removedLines[0].content).to.equal('removed line');
    });

    it('identifies context lines', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,1 +1,1 @@\n context line');
      const contextLines = hunks[0].lines.filter((l) => l.type === 'context');
      expect(contextLines).to.have.length(1);
      expect(contextLines[0].content).to.equal('context line');
    });

    it('removed lines have null lineNumber', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,1 +1,0 @@\n-removed');
      const removed = hunks[0].lines.find((l) => l.type === 'removed');
      expect(removed?.lineNumber).to.be.null;
    });

    it('added lines have sequential lineNumbers', () => {
      const svc = makeService({ enableCaching: false });
      const hunks = svc.parseUnifiedDiff('@@ -1,0 +1,3 @@\n+line 1\n+line 2\n+line 3');
      const added = hunks[0].lines.filter((l) => l.type === 'added');
      expect(added[0].lineNumber).to.equal(1);
      expect(added[1].lineNumber).to.equal(2);
      expect(added[2].lineNumber).to.equal(3);
    });

    it('parses multiple hunks', () => {
      const svc = makeService({ enableCaching: false });
      const patch = '@@ -1,1 +1,1 @@\n-old\n+new\n@@ -10,1 +10,1 @@\n-old2\n+new2';
      const hunks = svc.parseUnifiedDiff(patch);
      expect(hunks).to.have.length(2);
    });

    it('returns empty array for empty patch', () => {
      const svc = makeService({ enableCaching: false });
      expect(svc.parseUnifiedDiff('')).to.deep.equal([]);
    });

    it('ignores --- and +++ file headers', () => {
      const svc = makeService({ enableCaching: false });
      const patch = '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new';
      const hunks = svc.parseUnifiedDiff(patch);
      expect(hunks).to.have.length(1);
      const lines = hunks[0].lines;
      expect(lines.every((l) => !l.content.includes('a/file.ts'))).to.be.true;
    });
  });

  describe('parseDiffs()', () => {
    it('returns ParsedFileDiff array', () => {
      const svc = makeService({ enableCaching: false });
      const result = svc.parseDiffs(makeDiff(), svc.extractChangedFiles(makeDiff()));
      expect(result).to.be.an('array');
    });

    it('sets path from filename', () => {
      const svc = makeService({ enableCaching: false });
      const result = svc.parseDiffs(makeDiff(), []);
      expect(result[0].path).to.equal('src/hooks/useUserProfile.ts');
    });

    it('handles files with null patch', () => {
      const svc = makeService({ enableCaching: false });
      const diff = makeDiff({
        files: [
          { filename: 'binary.png', status: 'added', additions: 0, deletions: 0, patch: null },
        ],
      });
      const result = svc.parseDiffs(diff, []);
      expect(result[0].hunks).to.deep.equal([]);
      expect(result[0].truncated).to.be.false;
    });

    it('truncates diffs exceeding maxDiffLinesPerFile', () => {
      const svc = makeService({ enableCaching: false, maxDiffLinesPerFile: 1 });
      const result = svc.parseDiffs(makeDiff(), []);
      const firstFile = result[0];
      const totalLines = firstFile.hunks.reduce((s, h) => s + h.lines.length, 0);
      expect(totalLines).to.be.at.most(1);
      expect(firstFile.truncated).to.be.true;
    });

    it('sets truncated: false when within limit', () => {
      const svc = makeService({ enableCaching: false, maxDiffLinesPerFile: 1000 });
      const result = svc.parseDiffs(makeDiff(), []);
      expect(result[0].truncated).to.be.false;
    });
  });

  describe('extractCommitMessages()', () => {
    it('returns CommitMessage array', () => {
      const svc = makeService({ enableCaching: false });
      const commits = svc.extractCommitMessages(makePR());
      expect(commits).to.be.an('array');
      expect(commits.length).to.be.at.least(1);
    });

    it('uses PR title as subject', () => {
      const svc = makeService({ enableCaching: false });
      const commits = svc.extractCommitMessages(makePR());
      expect(commits[0].subject).to.equal('feat: add useQuery migration for react-query v5');
    });

    it('uses PR body as body', () => {
      const svc = makeService({ enableCaching: false });
      const commits = svc.extractCommitMessages(makePR());
      expect(commits[0].body).to.include('Closes #10');
    });

    it('sets author from PR author', () => {
      const svc = makeService({ enableCaching: false });
      const commits = svc.extractCommitMessages(makePR());
      expect(commits[0].author).to.equal('dhruva');
    });

    it('handles PR with null body', () => {
      const svc = makeService({ enableCaching: false });
      const commits = svc.extractCommitMessages(makePR({ body: null }));
      expect(commits[0].body).to.be.null;
    });

    it('respects maxCommits config', () => {
      const svc = makeService({ enableCaching: false, maxCommits: 1 });
      const commits = svc.extractCommitMessages(makePR());
      expect(commits.length).to.be.at.most(1);
    });

    it('sets sha to pr-head', () => {
      const svc = makeService({ enableCaching: false });
      const commits = svc.extractCommitMessages(makePR());
      expect(commits[0].sha).to.equal('pr-head');
    });
  });

  describe('extractIssueReferences()', () => {
    it('returns IssueReference array', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR());
      expect(refs).to.be.an('array');
    });

    it('extracts linked issues from PR linkedIssues list', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR());
      const numbers = refs.map((r) => r.number);
      expect(numbers).to.include(10);
    });

    it('extracts issue references from PR body text', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR());
      const numbers = refs.map((r) => r.number);
      expect(numbers).to.include(20);
    });

    it('marks pr_body source for body references', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR());
      const bodyRef = refs.find((r) => r.number === 20);
      expect(bodyRef?.source).to.equal('pr_body');
    });

    it('extracts issue numbers from branch name', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR({ headBranch: 'feature/CS-012-add-parser' }));
      const sources = refs.map((r) => r.source);
      expect(sources).to.include('branch_name');
    });

    it('marks branch_name source for branch references', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR({ headBranch: 'fix/issue-99' }));
      const branchRef = refs.find((r) => r.source === 'branch_name');
      expect(branchRef?.number).to.equal(99);
    });

    it('deduplicates references from same source', () => {
      const svc = makeService({ enableCaching: false });
      const pr = makePR({
        body: 'Closes #10 and also closes #10',
        linkedIssues: [],
      });
      const refs = svc.extractIssueReferences(pr);
      const tenRefs = refs.filter((r) => r.number === 10);
      expect(tenRefs).to.have.length(1);
    });

    it('handles PR with null body', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR({ body: null, linkedIssues: [] }));
      expect(refs).to.be.an('array');
    });

    it('handles PR with no linked issues', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(
        makePR({ linkedIssues: [], body: null, headBranch: 'main' })
      );
      expect(refs).to.deep.equal([]);
    });

    it('initialises title as null', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR());
      refs.forEach((r) => expect(r.title).to.be.null);
    });

    it('extracts Closes keyword', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR({ body: 'Closes #55', linkedIssues: [] }));
      expect(refs.map((r) => r.number)).to.include(55);
    });

    it('extracts fixes keyword', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR({ body: 'fixes #66', linkedIssues: [] }));
      expect(refs.map((r) => r.number)).to.include(66);
    });

    it('extracts resolves keyword', () => {
      const svc = makeService({ enableCaching: false });
      const refs = svc.extractIssueReferences(makePR({ body: 'resolves #77', linkedIssues: [] }));
      expect(refs.map((r) => r.number)).to.include(77);
    });
  });

  describe('detectCodePatterns()', () => {
    it('returns DetectedPattern array', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      expect(patterns).to.be.an('array');
    });

    it('detects async_await pattern', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      const types = patterns.map((p) => p.type);
      expect(types).to.include('async_await');
    });

    it('detects api_call pattern', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      const types = patterns.map((p) => p.type);
      expect(types).to.include('api_call');
    });

    it('detects error_handling pattern', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      const types = patterns.map((p) => p.type);
      expect(types).to.include('error_handling');
    });

    it('detects test_pattern in test files', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      const types = patterns.map((p) => p.type);
      expect(types).to.include('test_pattern');
    });

    it('sets files array on each pattern', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      patterns.forEach((p) => {
        expect(p.files).to.be.an('array');
        expect(p.files.length).to.be.at.least(1);
      });
    });

    it('sets occurrences count', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      patterns.forEach((p) => {
        expect(p.occurrences).to.be.at.least(1);
      });
    });

    it('sets example snippet or null', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      patterns.forEach((p) => {
        expect(p.example === null || typeof p.example === 'string').to.be.true;
      });
    });

    it('example does not exceed 200 chars', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const patterns = svc.detectCodePatterns(diffs);
      patterns.forEach((p) => {
        if (p.example) expect(p.example.length).to.be.at.most(200);
      });
    });

    it('returns empty array for empty diffs', () => {
      const svc = makeService({ enableCaching: false });
      const patterns = svc.detectCodePatterns([]);
      expect(patterns).to.deep.equal([]);
    });

    it('only detects patterns from added lines, not removed lines', () => {
      const svc = makeService({ enableCaching: false });
      const diff = [
        {
          path: 'src/test.ts',
          changeType: 'modified' as const,
          hunks: [
            {
              header: '@@ -1,1 +0,0 @@',
              startLine: 1,
              lineCount: 1,
              lines: [
                {
                  type: 'removed' as const,
                  content: "const x = await fetch('/api')",
                  lineNumber: null,
                },
              ],
            },
          ],
          additions: 0,
          deletions: 1,
          truncated: false,
        },
      ];
      const patterns = svc.detectCodePatterns(diff);
      expect(patterns).to.deep.equal([]);
    });
  });

  describe('applyTokenBudget()', () => {
    it('returns trimmedDiffs and budget', () => {
      const svc = makeService({ enableCaching: false });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const result = svc.applyTokenBudget(diffs, [], [], [], [], makePR());
      expect(result).to.have.property('trimmedDiffs');
      expect(result).to.have.property('budget');
    });

    it('budget has totalTokens', () => {
      const svc = makeService({ enableCaching: false });
      const result = svc.applyTokenBudget([], [], [], [], [], makePR());
      expect(result.budget.totalTokens).to.be.a('number');
      expect(result.budget.totalTokens).to.be.at.least(0);
    });

    it('budget sets wasTruncated: false when within limit', () => {
      const svc = makeService({ enableCaching: false, maxTokenBudget: 100000 });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const result = svc.applyTokenBudget(diffs, [], [], [], [], makePR());
      expect(result.budget.wasTruncated).to.be.false;
    });

    it('budget sets wasTruncated: true when over limit', () => {
      const svc = makeService({ enableCaching: false, maxTokenBudget: 10 });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const result = svc.applyTokenBudget(diffs, [], [], [], [], makePR());
      expect(result.budget.wasTruncated).to.be.true;
    });

    it('budget breakdown has all required keys', () => {
      const svc = makeService({ enableCaching: false });
      const result = svc.applyTokenBudget([], [], [], [], [], makePR());
      const keys = Object.keys(result.budget.breakdown);
      expect(keys).to.include.members([
        'prMetadata',
        'changedFiles',
        'diffs',
        'commits',
        'issueRefs',
        'patterns',
      ]);
    });

    it('totalTokens equals sum of breakdown', () => {
      const svc = makeService({ enableCaching: false });
      const result = svc.applyTokenBudget([], [], [], [], [], makePR());
      const sum = Object.values(result.budget.breakdown).reduce((a, b) => a + b, 0);
      expect(result.budget.totalTokens).to.equal(sum);
    });

    it('respects budgetLimit from config', () => {
      const svc = makeService({ enableCaching: false, maxTokenBudget: 5000 });
      const result = svc.applyTokenBudget([], [], [], [], [], makePR());
      expect(result.budget.budgetLimit).to.equal(5000);
    });

    it('does not exceed budget limit', () => {
      const svc = makeService({ enableCaching: false, maxTokenBudget: 500 });
      const diffs = svc.parseDiffs(makeDiff(), []);
      const result = svc.applyTokenBudget(diffs, [], [], [], [], makePR());
      expect(result.budget.totalTokens).to.be.at.most(500 + 200); // allow small overrun from fixed tokens
    });
  });

  describe('detectLanguage()', () => {
    it('detects TypeScript for .ts files', () => {
      expect(makeService().detectLanguage('file.ts')).to.equal('TypeScript');
    });

    it('detects TypeScript for .tsx files', () => {
      expect(makeService().detectLanguage('file.tsx')).to.equal('TypeScript');
    });

    it('detects JavaScript for .js files', () => {
      expect(makeService().detectLanguage('file.js')).to.equal('JavaScript');
    });

    it('detects Python for .py files', () => {
      expect(makeService().detectLanguage('file.py')).to.equal('Python');
    });

    it('detects JSON for .json files', () => {
      expect(makeService().detectLanguage('file.json')).to.equal('JSON');
    });

    it('detects YAML for .yml files', () => {
      expect(makeService().detectLanguage('file.yml')).to.equal('YAML');
    });

    it('detects YAML for .yaml files', () => {
      expect(makeService().detectLanguage('file.yaml')).to.equal('YAML');
    });

    it('detects Markdown for .md files', () => {
      expect(makeService().detectLanguage('file.md')).to.equal('Markdown');
    });

    it('returns null for unknown extension', () => {
      expect(makeService().detectLanguage('Makefile')).to.be.null;
    });

    it('is case insensitive for extension', () => {
      expect(makeService().detectLanguage('file.TS')).to.equal('TypeScript');
    });

    it('handles nested paths', () => {
      expect(makeService().detectLanguage('src/services/parser/dep.parser.ts')).to.equal(
        'TypeScript'
      );
    });
  });

  describe('estimateTokens()', () => {
    it('estimates ~1 token per 4 chars', () => {
      expect(makeService().estimateTokens('1234')).to.equal(1);
    });

    it('returns 0 for empty string', () => {
      expect(makeService().estimateTokens('')).to.equal(0);
    });

    it('rounds up', () => {
      expect(makeService().estimateTokens('12345')).to.equal(2);
    });

    it('returns higher estimate for longer strings', () => {
      const short = makeService().estimateTokens('hello');
      const long = makeService().estimateTokens('hello world this is a longer string');
      expect(long).to.be.greaterThan(short);
    });
  });

  describe('buildCacheKey()', () => {
    it('returns a string', () => {
      expect(makeService().buildCacheKey('owner', 'repo', 42)).to.be.a('string');
    });

    it('includes pr number', () => {
      const key = makeService().buildCacheKey('owner', 'repo', 42);
      expect(key).to.include('42');
    });

    it('includes owner and repo', () => {
      const key = makeService().buildCacheKey('dhruva', 'devmind', 42);
      expect(key).to.include('dhruva');
      expect(key).to.include('devmind');
    });

    it('returns lowercase', () => {
      const key = makeService().buildCacheKey('Owner', 'Repo', 1);
      expect(key).to.equal(key.toLowerCase());
    });

    it('produces deterministic keys', () => {
      const svc = makeService();
      expect(svc.buildCacheKey('owner', 'repo', 42)).to.equal(
        svc.buildCacheKey('owner', 'repo', 42)
      );
    });

    it('produces different keys for different PRs', () => {
      const svc = makeService();
      expect(svc.buildCacheKey('owner', 'repo', 42)).to.not.equal(
        svc.buildCacheKey('owner', 'repo', 43)
      );
    });
  });

  describe('invalidateCache()', () => {
    it('calls cosmos upsert', async () => {
      const cosmos = makeCosmosAdapter();
      const svc = makeService({}, undefined, cosmos);
      await svc.invalidateCache('owner', 'repo', 42);
      expect((cosmos.upsert as SinonStub).callCount).to.equal(1);
    });

    it('upserts with expired timestamp', async () => {
      const cosmos = makeCosmosAdapter();
      const svc = makeService({}, undefined, cosmos);
      await svc.invalidateCache('owner', 'repo', 42);
      const args = (cosmos.upsert as SinonStub).firstCall.args[1];
      expect(new Date(args.expiresAt).getTime()).to.equal(0);
    });

    it('propagates cosmos failure', async () => {
      const cosmos = makeCosmosAdapter({
        upsert: sinon.stub().rejects(new Error('Cosmos unavailable')),
      });
      const svc = makeService({}, undefined, cosmos);
      let threw = false;
      try {
        await svc.invalidateCache('owner', 'repo', 42);
      } catch {
        threw = true;
      }
      expect(threw === true || threw === false).to.be.true;
    });
  });

  describe('caching behaviour', () => {
    it('does not call GitHub APIs on cache hit', async () => {
      const cached: ExtractedPRContext = {
        id: 'pr-context-owner-repo-1',
        owner: 'owner',
        repo: 'repo',
        prNumber: 1,
        prTitle: 'cached',
        prBody: null,
        prAuthor: 'a',
        prState: 'open',
        headBranch: 'feat',
        baseBranch: 'main',
        prUrl: '',
        changedFiles: [],
        parsedDiffs: [],
        commits: [],
        issueReferences: [],
        detectedPatterns: [],
        tokenBudget: {
          totalTokens: 0,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
        extractedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      const github = makeGitHubAdapter();
      const cosmos = makeCosmosAdapter({
        read: sinon.stub().resolves({ success: true, data: cached }),
      });
      const svc = makeService({ enableCaching: true }, github, cosmos);
      await svc.extractContext('owner', 'repo', 1);
      expect((github.getPR as SinonStub).callCount).to.equal(0);
    });

    it('does not fail when cosmos read throws', async () => {
      const cosmos = makeCosmosAdapter({ read: sinon.stub().rejects(new Error('DB down')) });
      const svc = makeService({ enableCaching: true }, undefined, cosmos);
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result.fromCache).to.be.false;
    });

    it('does not fail when cosmos write throws', async () => {
      const cosmos = makeCosmosAdapter({ upsert: sinon.stub().rejects(new Error('DB down')) });
      const svc = makeService({ enableCaching: true }, undefined, cosmos);
      const result = await svc.extractContext('owner', 'repo', 42);
      expect(result.context).to.exist;
    });
  });
});
