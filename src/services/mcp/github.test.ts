import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { RequestError } from '@octokit/request-error';
import { GitHubMCPClient } from './github.client';
import {
  GitHubAuthError,
  GitHubNotFoundError,
  GitHubRateLimitError,
  GitHubMCPError,
} from './github.types';

// ── Helpers ───────────────────────────────────────────────────

function makeClient(overrides?: object): GitHubMCPClient {
  const client = new GitHubMCPClient({ token: 'ghp_test_token', ...overrides });
  return client;
}

/** Reach into the private octokit instance for stubbing */
function octokit(client: GitHubMCPClient): Record<string, Record<string, SinonStub>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).octokit;
}

// Minimal GitHub API response factories
const makePR = (n = 1) => ({
  number: n,
  title: `PR ${n}`,
  body: 'Closes #10',
  state: 'open',
  merged_at: null,
  user: { login: 'dev' },
  head: { ref: 'feature/test' },
  base: { ref: 'main' },
  html_url: `https://github.com/org/repo/pull/${n}`,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  draft: false,
  labels: [{ name: 'bug' }],
});

const makeIssue = (n = 10) => ({
  number: n,
  title: `Issue ${n}`,
  body: 'Some issue body',
  state: 'open',
  user: { login: 'reporter' },
  labels: [{ name: 'enhancement' }],
  html_url: `https://github.com/org/repo/issues/${n}`,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const makeComment = (id = 1) => ({
  id,
  body: 'LGTM!',
  user: { login: 'reviewer' },
  created_at: '2026-01-03T00:00:00Z',
  updated_at: '2026-01-03T00:00:00Z',
  html_url: `https://github.com/org/repo/issues/1#comment-${id}`,
});

// ── Test Suite ────────────────────────────────────────────────

describe('GitHubMCPClient', () => {
  let client: GitHubMCPClient;
  let oct: ReturnType<typeof octokit>;

  beforeEach(() => {
    client = makeClient({ retryBaseDelayMs: 0 }); // disable real delays in tests
    oct = octokit(client);
  });

  afterEach(() => sinon.restore());

  // ── Constructor / Config ─────────────────────────────────────

  describe('constructor', () => {
    it('creates an instance with default config', () => {
      expect(client).to.be.instanceOf(GitHubMCPClient);
    });

    it('accepts custom rateLimitThreshold', () => {
      const c = makeClient({ rateLimitThreshold: 100 });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((c as any).config.rateLimitThreshold).to.equal(100);
    });
  });

  // ── Rate Limit ───────────────────────────────────────────────

  describe('getRateLimit()', () => {
    it('returns parsed rate limit info', async () => {
      oct.rateLimit.get = sinon.stub().resolves({
        data: {
          resources: {
            core: { limit: 5000, remaining: 4999, reset: 9999999999 },
          },
        },
      });

      const rl = await client.getRateLimit();

      expect(rl.limit).to.equal(5000);
      expect(rl.remaining).to.equal(4999);
      expect(rl.isNearLimit).to.be.false;
    });

    it('flags isNearLimit when remaining < threshold', async () => {
      const c = makeClient({ rateLimitThreshold: 500, retryBaseDelayMs: 0 });
      octokit(c).rateLimit = { get: sinon.stub() } as never;
      octokit(c).rateLimit.get = sinon.stub().resolves({
        data: {
          resources: { core: { limit: 5000, remaining: 400, reset: 9999999999 } },
        },
      });

      const rl = await c.getRateLimit();
      expect(rl.isNearLimit).to.be.true;
    });
  });

  // ── getPR ────────────────────────────────────────────────────

  describe('getPR()', () => {
    it('returns a mapped PR object', async () => {
      oct.pulls = { get: sinon.stub().resolves({ data: makePR(42) }) } as never;

      const pr = await client.getPR('org', 'repo', 42);

      expect(pr.number).to.equal(42);
      expect(pr.title).to.equal('PR 42');
      expect(pr.author).to.equal('dev');
      expect(pr.headBranch).to.equal('feature/test');
      expect(pr.labels).to.deep.equal(['bug']);
    });

    it('extracts linked issues from PR body', async () => {
      const raw = makePR(1);
      raw.body = 'Closes #10\nAlso fixes #20';
      oct.pulls = { get: sinon.stub().resolves({ data: raw }) } as never;

      const pr = await client.getPR('org', 'repo', 1);
      expect(pr.linkedIssues).to.deep.equal([10, 20]);
    });

    it('returns empty linkedIssues when body is null', async () => {
      const raw = makePR(1);
      (raw as never as { body: null }).body = null;
      oct.pulls = { get: sinon.stub().resolves({ data: raw }) } as never;

      const pr = await client.getPR('org', 'repo', 1);
      expect(pr.linkedIssues).to.deep.equal([]);
    });

    it('marks a merged PR state as "merged"', async () => {
      const raw = { ...makePR(1), merged_at: '2026-01-05T00:00:00Z', state: 'closed' };
      oct.pulls = { get: sinon.stub().resolves({ data: raw }) } as never;

      const pr = await client.getPR('org', 'repo', 1);
      expect(pr.state).to.equal('merged');
    });

    it('throws GitHubNotFoundError on 404', async () => {
      const err = new RequestError('Not Found', 404, {
        request: { method: 'GET', url: '', headers: {} },
      });
      oct.pulls = { get: sinon.stub().rejects(err) } as never;

      try {
        await client.getPR('org', 'repo', 999);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubNotFoundError);
      }
    });

    it('throws GitHubAuthError on 401', async () => {
      const err = new RequestError('Unauthorized', 401, {
        request: { method: 'GET', url: '', headers: {} },
      });
      oct.pulls = { get: sinon.stub().rejects(err) } as never;

      try {
        await client.getPR('org', 'repo', 1);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubAuthError);
      }
    });
  });

  // ── listPRs ──────────────────────────────────────────────────

  describe('listPRs()', () => {
    it('returns an array of mapped PRs', async () => {
      oct.pulls = { list: sinon.stub().resolves({ data: [makePR(1), makePR(2)] }) } as never;

      const prs = await client.listPRs('org', 'repo');
      expect(prs).to.have.length(2);
      expect(prs[0].number).to.equal(1);
      expect(prs[1].number).to.equal(2);
    });

    it('defaults to "open" state', async () => {
      const stub = sinon.stub().resolves({ data: [] });
      oct.pulls = { list: stub } as never;

      await client.listPRs('org', 'repo');
      expect(stub.firstCall.args[0]).to.include({ state: 'open' });
    });

    it('passes through requested state', async () => {
      const stub = sinon.stub().resolves({ data: [] });
      oct.pulls = { list: stub } as never;

      await client.listPRs('org', 'repo', 'closed');
      expect(stub.firstCall.args[0]).to.include({ state: 'closed' });
    });
  });

  // ── getPRDiff ────────────────────────────────────────────────

  describe('getPRDiff()', () => {
    it('returns diff with file list and totals', async () => {
      oct.pulls = {
        listFiles: sinon.stub().resolves({
          data: [
            {
              filename: 'src/foo.ts',
              status: 'modified',
              additions: 10,
              deletions: 2,
              patch: '@@ ...',
            },
            { filename: 'src/bar.ts', status: 'added', additions: 5, deletions: 0, patch: null },
          ],
        }),
      } as never;

      const diff = await client.getPRDiff('org', 'repo', 1);

      expect(diff.totalAdditions).to.equal(15);
      expect(diff.totalDeletions).to.equal(2);
      expect(diff.totalChanges).to.equal(17);
      expect(diff.files).to.have.length(2);
      expect(diff.files[0].filename).to.equal('src/foo.ts');
    });

    it('sets patch to null when not returned by API', async () => {
      oct.pulls = {
        listFiles: sinon.stub().resolves({
          data: [{ filename: 'img.png', status: 'added', additions: 0, deletions: 0 }],
        }),
      } as never;

      const diff = await client.getPRDiff('org', 'repo', 1);
      expect(diff.files[0].patch).to.be.null;
    });
  });

  // ── getIssue ─────────────────────────────────────────────────

  describe('getIssue()', () => {
    it('returns a mapped issue', async () => {
      oct.issues = { get: sinon.stub().resolves({ data: makeIssue(10) }) } as never;

      const issue = await client.getIssue('org', 'repo', 10);

      expect(issue.number).to.equal(10);
      expect(issue.title).to.equal('Issue 10');
      expect(issue.author).to.equal('reporter');
      expect(issue.labels).to.deep.equal(['enhancement']);
    });

    it('handles string labels from API', async () => {
      const raw = { ...makeIssue(1), labels: ['bug', 'priority'] };
      oct.issues = { get: sinon.stub().resolves({ data: raw }) } as never;

      const issue = await client.getIssue('org', 'repo', 1);
      expect(issue.labels).to.deep.equal(['bug', 'priority']);
    });

    it('throws GitHubNotFoundError on 404', async () => {
      const err = new RequestError('Not Found', 404, {
        request: { method: 'GET', url: '', headers: {} },
      });
      oct.issues = { get: sinon.stub().rejects(err) } as never;

      try {
        await client.getIssue('org', 'repo', 999);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubNotFoundError);
      }
    });
  });

  // ── listPRComments ───────────────────────────────────────────

  describe('listPRComments()', () => {
    it('returns an array of comments', async () => {
      oct.issues = {
        listComments: sinon.stub().resolves({ data: [makeComment(1), makeComment(2)] }),
      } as never;

      const comments = await client.listPRComments('org', 'repo', 1);

      expect(comments).to.have.length(2);
      expect(comments[0].id).to.equal(1);
      expect(comments[0].author).to.equal('reviewer');
    });

    it('returns empty array when no comments', async () => {
      oct.issues = { listComments: sinon.stub().resolves({ data: [] }) } as never;

      const comments = await client.listPRComments('org', 'repo', 1);
      expect(comments).to.deep.equal([]);
    });
  });

  // ── createPRComment ──────────────────────────────────────────

  describe('createPRComment()', () => {
    it('creates and returns a comment', async () => {
      oct.issues = {
        createComment: sinon.stub().resolves({ data: makeComment(99) }),
      } as never;

      const comment = await client.createPRComment('org', 'repo', 1, { body: 'LGTM!' });

      expect(comment.id).to.equal(99);
      expect(comment.body).to.equal('LGTM!');
    });

    it('passes body to the API', async () => {
      const stub = sinon.stub().resolves({ data: makeComment(1) });
      oct.issues = { createComment: stub } as never;

      await client.createPRComment('org', 'repo', 5, { body: 'Nice work' });
      expect(stub.firstCall.args[0]).to.include({ body: 'Nice work', issue_number: 5 });
    });
  });

  // ── updatePRComment ──────────────────────────────────────────

  describe('updatePRComment()', () => {
    it('updates and returns the comment', async () => {
      const updated = { ...makeComment(1), body: 'Updated body' };
      oct.issues = { updateComment: sinon.stub().resolves({ data: updated }) } as never;

      const comment = await client.updatePRComment('org', 'repo', 1, { body: 'Updated body' });
      expect(comment.body).to.equal('Updated body');
    });
  });

  // ── searchCode ───────────────────────────────────────────────

  describe('searchCode()', () => {
    it('returns mapped search results', async () => {
      oct.search = {
        code: sinon.stub().resolves({
          data: {
            items: [
              {
                path: 'src/auth.ts',
                repository: { full_name: 'org/repo' },
                html_url: 'https://github.com/org/repo/blob/main/src/auth.ts',
                text_matches: [{ fragment: 'const token =' }],
              },
            ],
          },
        }),
      } as never;

      const results = await client.searchCode('org', 'repo', 'token');

      expect(results).to.have.length(1);
      expect(results[0].path).to.equal('src/auth.ts');
      expect(results[0].fragment).to.equal('const token =');
    });

    it('appends repo scoping to the query', async () => {
      const stub = sinon.stub().resolves({ data: { items: [] } });
      oct.search = { code: stub } as never;

      await client.searchCode('org', 'repo', 'myFunction');
      expect(stub.firstCall.args[0].q).to.include('repo:org/repo');
    });

    it('respects custom perPage option', async () => {
      const stub = sinon.stub().resolves({ data: { items: [] } });
      oct.search = { code: stub } as never;

      await client.searchCode('org', 'repo', 'fn', { perPage: 10 });
      expect(stub.firstCall.args[0].per_page).to.equal(10);
    });
  });

  // ── Error Handling & Retry ───────────────────────────────────

  describe('error handling', () => {
    it('retries on transient 500 errors and eventually throws', async () => {
      const err = new RequestError('Server Error', 500, {
        request: { method: 'GET', url: '', headers: {} },
      });
      const stub = sinon.stub().rejects(err);
      oct.pulls = { get: stub } as never;

      const c = makeClient({ maxRetries: 2, retryBaseDelayMs: 0 });
      octokit(c).pulls = { get: stub } as never;

      try {
        await c.getPR('org', 'repo', 1);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubMCPError);
        expect(stub.callCount).to.equal(2); // maxRetries
      }
    });

    it('does not retry on 404', async () => {
      const err = new RequestError('Not Found', 404, {
        request: { method: 'GET', url: '', headers: {} },
      });
      const stub = sinon.stub().rejects(err);
      oct.pulls = { get: stub } as never;

      try {
        await client.getPR('org', 'repo', 1);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubNotFoundError);
        expect(stub.callCount).to.equal(1);
      }
    });

    it('throws GitHubRateLimitError on 429', async () => {
      const resetTs = Math.floor((Date.now() - 1000) / 1000); // already in past → no real wait
      const err = new RequestError('Rate limit exceeded', 429, {
        request: { method: 'GET', url: '', headers: {} },
        response: {
          status: 429,
          url: '',
          headers: { 'x-ratelimit-reset': String(resetTs) },
          data: {},
        },
      });
      const stub = sinon.stub().rejects(err);
      oct.pulls = { get: stub } as never;

      const c = makeClient({ maxRetries: 1, retryBaseDelayMs: 0 });
      octokit(c).pulls = { get: stub } as never;

      try {
        await c.getPR('org', 'repo', 1);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubRateLimitError);
      }
    });

    it('wraps unknown errors in GitHubMCPError', async () => {
      const stub = sinon.stub().rejects(new Error('network failure'));
      oct.pulls = { get: stub } as never;

      const c = makeClient({ maxRetries: 1, retryBaseDelayMs: 0 });
      octokit(c).pulls = { get: stub } as never;

      try {
        await c.getPR('org', 'repo', 1);
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(GitHubMCPError);
        expect((e as GitHubMCPError).message).to.include('network failure');
      }
    });
  });

  // ── extractLinkedIssues (private via getPR) ──────────────────

  describe('linked issue extraction', () => {
    const cases: Array<[string, number[]]> = [
      ['Closes #5', [5]],
      ['fixes #10 and resolves #20', [10, 20]],
      ['CLOSES #99', [99]],
      ['No keywords here', []],
      ['Closes #5 closes #5', [5]], // deduplicated
    ];

    cases.forEach(([body, expected]) => {
      it(`extracts ${JSON.stringify(expected)} from: "${body}"`, async () => {
        const raw = { ...makePR(1), body };
        oct.pulls = { get: sinon.stub().resolves({ data: raw }) } as never;

        const pr = await client.getPR('org', 'repo', 1);
        expect(pr.linkedIssues).to.deep.equal(expected);
      });
    });
  });
});
