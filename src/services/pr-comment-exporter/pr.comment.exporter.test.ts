import { expect } from 'chai';
import * as sinon from 'sinon';
import { PRCommentExporterService } from './pr.comment.exporter.service';
import {
  PRCommentExporterError,
  DEFAULT_BOT_PATTERNS,
  DEFAULT_CONFIG,
  GitHubCommentFetchAdapter,
  CosmosExportAdapter,
  PRSummaryItem,
  RawComment,
  RepoSyncState,
  ExportedPRComment,
} from './pr.comment.exporter.types';

function makePR(overrides: Partial<PRSummaryItem> = {}): PRSummaryItem {
  return {
    number: 42,
    title: 'feat: add auth',
    updatedAt: new Date().toISOString(),
    state: 'open',
    ...overrides,
  };
}

function makeRawComment(overrides: Partial<RawComment> = {}): RawComment {
  return {
    id: 1001,
    body: 'This looks good, but consider extracting the logic.',
    user: 'alice',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    path: 'src/auth.ts',
    line: 42,
    source: 'pr_review_comment',
    ...overrides,
  };
}

function makeSyncState(overrides: Partial<RepoSyncState> = {}): RepoSyncState {
  return {
    id: 'sync-state/owner/repo',
    partitionKey: 'owner/repo',
    owner: 'owner',
    repo: 'repo',
    lastSyncedAt: new Date(Date.now() - 86400000).toISOString(),
    totalExported: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGitHub(overrides: Partial<GitHubCommentFetchAdapter> = {}): GitHubCommentFetchAdapter {
  return {
    listPRs: sinon.stub().resolves([makePR()]),
    listPRComments: sinon.stub().resolves([makeRawComment()]),
    ...overrides,
  };
}

function makeCosmos(overrides: Partial<CosmosExportAdapter> = {}): CosmosExportAdapter {
  return {
    upsertComment: sinon.stub().resolves(),
    readComment: sinon.stub().resolves(null),
    readSyncState: sinon.stub().resolves(null),
    upsertSyncState: sinon.stub().resolves(),
    ...overrides,
  };
}

function makeService(
  githubOverrides: Partial<GitHubCommentFetchAdapter> = {},
  cosmosOverrides: Partial<CosmosExportAdapter> = {},
  configOverrides = {},
  loggingAdapter?: any
) {
  return new PRCommentExporterService(
    configOverrides,
    makeGitHub(githubOverrides),
    makeCosmos(cosmosOverrides),
    loggingAdapter
  );
}

describe('PRCommentExporterService', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      expect(makeService()).to.be.instanceOf(PRCommentExporterService);
    });

    it('accepts custom pageSize', () => {
      expect(() => makeService({}, {}, { pageSize: 50 })).to.not.throw();
    });

    it('accepts custom maxPages', () => {
      expect(() => makeService({}, {}, { maxPages: 10 })).to.not.throw();
    });

    it('accepts enableLogging: false', () => {
      expect(() => makeService({}, {}, { enableLogging: false })).to.not.throw();
    });

    it('accepts enableStorage: false', () => {
      expect(() => makeService({}, {}, { enableStorage: false })).to.not.throw();
    });

    it('accepts custom botPatterns', () => {
      expect(() => makeService({}, {}, { botPatterns: ['mybot'] })).to.not.throw();
    });
  });

  describe('isBot()', () => {
    it('returns true for username containing [bot]', () => {
      expect(makeService().isBot('github-actions[bot]')).to.be.true;
    });

    it('returns true for dependabot', () => {
      expect(makeService().isBot('dependabot')).to.be.true;
    });

    it('returns true for renovate', () => {
      expect(makeService().isBot('renovate')).to.be.true;
    });

    it('returns true for codecov', () => {
      expect(makeService().isBot('codecov')).to.be.true;
    });

    it('returns false for a real user', () => {
      expect(makeService().isBot('alice')).to.be.false;
    });

    it('returns false for a username that contains partial match by coincidence', () => {
      expect(makeService().isBot('robotics-dev')).to.be.false;
    });

    it('returns true for empty username', () => {
      expect(makeService().isBot('')).to.be.true;
    });

    it('is case insensitive', () => {
      expect(makeService().isBot('DependaBot')).to.be.true;
    });

    it('returns true for custom bot pattern', () => {
      const svc = makeService({}, {}, { botPatterns: ['mybot'] });
      expect(svc.isBot('mybot-user')).to.be.true;
    });
  });

  describe('isExportable()', () => {
    it('returns true for a normal user comment with body', () => {
      expect(makeService().isExportable(makeRawComment())).to.be.true;
    });

    it('returns false when body is null', () => {
      expect(makeService().isExportable(makeRawComment({ body: null }))).to.be.false;
    });

    it('returns false when body is empty string', () => {
      expect(makeService().isExportable(makeRawComment({ body: '' }))).to.be.false;
    });

    it('returns false when body is whitespace-only', () => {
      expect(makeService().isExportable(makeRawComment({ body: '   ' }))).to.be.false;
    });

    it('returns false when user is a bot', () => {
      expect(makeService().isExportable(makeRawComment({ user: 'dependabot' }))).to.be.false;
    });

    it('returns false when user is github-actions[bot]', () => {
      expect(makeService().isExportable(makeRawComment({ user: 'github-actions[bot]' }))).to.be
        .false;
    });
  });

  describe('ID helpers', () => {
    const svc = makeService();

    it('buildCommentId returns lowercase path', () => {
      expect(svc.buildCommentId('Owner', 'Repo', 123)).to.equal('owner/repo/comments/123');
    });

    it('buildPartitionKey returns lowercase owner/repo', () => {
      expect(svc.buildPartitionKey('Owner', 'Repo')).to.equal('owner/repo');
    });

    it('buildSyncStateId returns deterministic key', () => {
      expect(svc.buildSyncStateId('Owner', 'Repo')).to.equal('sync-state/owner/repo');
    });

    it('buildCommentId is deterministic', () => {
      expect(svc.buildCommentId('o', 'r', 1)).to.equal(svc.buildCommentId('o', 'r', 1));
    });

    it('buildCommentId differs for different comment IDs', () => {
      expect(svc.buildCommentId('o', 'r', 1)).to.not.equal(svc.buildCommentId('o', 'r', 2));
    });
  });

  describe('exportComments() — input validation', () => {
    it('throws INVALID_INPUT for empty owner', async () => {
      try {
        await makeService().exportComments('', 'repo');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as PRCommentExporterError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT for whitespace owner', async () => {
      try {
        await makeService().exportComments('   ', 'repo');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as PRCommentExporterError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT for empty repo', async () => {
      try {
        await makeService().exportComments('owner', '');
        expect.fail('should have thrown');
      } catch (err) {
        expect((err as PRCommentExporterError).code).to.equal('INVALID_INPUT');
      }
    });
  });

  describe('exportComments() — result shape', () => {
    it('returns ExportResult with correct keys', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result).to.include.keys([
        'owner',
        'repo',
        'prsProcessed',
        'commentsExported',
        'commentsSkipped',
        'commentsAlreadySynced',
        'isIncremental',
        'wasPaginated',
        'durationMs',
        'exportedAt',
      ]);
    });

    it('sets owner and repo on result', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.owner).to.equal('owner');
      expect(result.repo).to.equal('repo');
    });

    it('sets durationMs >= 0', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.durationMs).to.be.greaterThanOrEqual(0);
    });

    it('sets exportedAt as ISO string', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.exportedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sets prsProcessed to 1 for single PR', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.prsProcessed).to.equal(1);
    });

    it('sets commentsExported to 1 for single exportable comment', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.commentsExported).to.equal(1);
    });

    it('sets commentsSkipped to 1 for a bot comment', async () => {
      const gh = makeGitHub({
        listPRComments: sinon.stub().resolves([makeRawComment({ user: 'dependabot' })]),
      });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      const result = await svc.exportComments('owner', 'repo');
      expect(result.commentsSkipped).to.equal(1);
      expect(result.commentsExported).to.equal(0);
    });

    it('sets isIncremental: false on first run (no sync state)', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.isIncremental).to.be.false;
    });

    it('sets isIncremental: true when sync state exists', async () => {
      const cosmos = makeCosmos({ readSyncState: sinon.stub().resolves(makeSyncState()) });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.isIncremental).to.be.true;
    });

    it('sets wasPaginated: false when all PRs fit in one page', async () => {
      const result = await makeService().exportComments('owner', 'repo');
      expect(result.wasPaginated).to.be.false;
    });
  });

  describe('exportComments() — GitHub adapter interaction', () => {
    it('calls listPRs with correct owner, repo, page 1', async () => {
      const listPRs = sinon.stub().resolves([]);
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      await svc.exportComments('owner', 'repo');
      expect(listPRs.calledWith('owner', 'repo', 1, DEFAULT_CONFIG.pageSize)).to.be.true;
    });

    it('calls listPRComments for each PR', async () => {
      const listPRComments = sinon.stub().resolves([]);
      const gh = makeGitHub({ listPRComments });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      await svc.exportComments('owner', 'repo');
      expect(listPRComments.calledOnce).to.be.true;
      expect(listPRComments.firstCall.args[2]).to.equal(42);
    });

    it('stops pagination when page returns empty array', async () => {
      const listPRs = sinon.stub();
      listPRs.onFirstCall().resolves([makePR({ number: 1 }), makePR({ number: 2 })]);
      listPRs.onSecondCall().resolves([]);
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({ pageSize: 2 }, gh, makeCosmos());
      await svc.exportComments('owner', 'repo');
      expect(listPRs.callCount).to.equal(2);
    });

    it('stops pagination when page returns fewer than pageSize items', async () => {
      const listPRs = sinon.stub().resolves([makePR()]);
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({ pageSize: 100 }, gh, makeCosmos());
      await svc.exportComments('owner', 'repo');
      expect(listPRs.callCount).to.equal(1);
    });

    it('respects maxPages limit', async () => {
      const listPRs = sinon
        .stub()
        .resolves(Array.from({ length: 2 }, (_, i) => makePR({ number: i + 1 })));
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({ maxPages: 2, pageSize: 2 }, gh, makeCosmos());
      await svc.exportComments('owner', 'repo');
      expect(listPRs.callCount).to.equal(2);
    });

    it('passes custom pageSize to listPRs', async () => {
      const listPRs = sinon.stub().resolves([]);
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({ pageSize: 25 }, gh, makeCosmos());
      await svc.exportComments('owner', 'repo');
      expect(listPRs.firstCall.args[3]).to.equal(25);
    });
  });

  describe('exportComments() — Cosmos adapter interaction', () => {
    it('calls upsertComment for each exportable comment', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      expect(upsertComment.calledOnce).to.be.true;
    });

    it('upserted comment has correct id', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      const doc: ExportedPRComment = upsertComment.firstCall.args[0];
      expect(doc.id).to.equal('owner/repo/comments/1001');
    });

    it('upserted comment has correct partitionKey', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      const doc: ExportedPRComment = upsertComment.firstCall.args[0];
      expect(doc.partitionKey).to.equal('owner/repo');
    });

    it('upserted comment has correct prNumber', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      const doc: ExportedPRComment = upsertComment.firstCall.args[0];
      expect(doc.prNumber).to.equal(42);
    });

    it('upserted comment has trimmed body', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const gh = makeGitHub({
        listPRComments: sinon.stub().resolves([makeRawComment({ body: '  good point  ' })]),
      });
      const svc = new PRCommentExporterService({}, gh, cosmos);
      await svc.exportComments('owner', 'repo');
      const doc: ExportedPRComment = upsertComment.firstCall.args[0];
      expect(doc.body).to.equal('good point');
    });

    it('upserted comment has filePath from raw comment', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      const doc: ExportedPRComment = upsertComment.firstCall.args[0];
      expect(doc.filePath).to.equal('src/auth.ts');
    });

    it('upserted comment has null filePath for top-level comment', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const gh = makeGitHub({
        listPRComments: sinon.stub().resolves([makeRawComment({ path: undefined })]),
      });
      const svc = new PRCommentExporterService({}, gh, cosmos);
      await svc.exportComments('owner', 'repo');
      const doc: ExportedPRComment = upsertComment.firstCall.args[0];
      expect(doc.filePath).to.be.null;
    });

    it('does not upsert comment when enableStorage is false', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertComment });
      const svc = new PRCommentExporterService({ enableStorage: false }, makeGitHub(), cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(upsertComment.called).to.be.false;
      expect(result.commentsExported).to.equal(1);
    });

    it('calls upsertSyncState after export', async () => {
      const upsertSyncState = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertSyncState });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      expect(upsertSyncState.calledOnce).to.be.true;
    });

    it('sync state has correct owner and repo', async () => {
      const upsertSyncState = sinon.stub().resolves();
      const cosmos = makeCosmos({ upsertSyncState });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      const state: RepoSyncState = upsertSyncState.firstCall.args[0];
      expect(state.owner).to.equal('owner');
      expect(state.repo).to.equal('repo');
    });

    it('sync state totalExported accumulates from prior state', async () => {
      const upsertSyncState = sinon.stub().resolves();
      const cosmos = makeCosmos({
        upsertSyncState,
        readSyncState: sinon.stub().resolves(makeSyncState({ totalExported: 10 })),
      });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      const state: RepoSyncState = upsertSyncState.firstCall.args[0];
      expect(state.totalExported).to.equal(11); // 10 prior + 1 new
    });
  });

  describe('incremental sync', () => {
    it('skips PRs updated before lastSyncedAt', async () => {
      const oldDate = new Date(Date.now() - 7 * 86400000).toISOString();
      const recentSyncDate = new Date(Date.now() - 86400000).toISOString();
      const listPRs = sinon.stub().resolves([makePR({ updatedAt: oldDate })]);
      const cosmos = makeCosmos({
        readSyncState: sinon.stub().resolves(makeSyncState({ lastSyncedAt: recentSyncDate })),
      });
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({}, gh, cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.prsProcessed).to.equal(0);
    });

    it('processes PRs updated after lastSyncedAt', async () => {
      const recentPRDate = new Date().toISOString();
      const oldSyncDate = new Date(Date.now() - 7 * 86400000).toISOString();
      const listPRs = sinon.stub().resolves([makePR({ updatedAt: recentPRDate })]);
      const cosmos = makeCosmos({
        readSyncState: sinon.stub().resolves(makeSyncState({ lastSyncedAt: oldSyncDate })),
      });
      const gh = makeGitHub({ listPRs });
      const svc = new PRCommentExporterService({}, gh, cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.prsProcessed).to.equal(1);
    });

    it('counts alreadySynced when comment exists in Cosmos', async () => {
      const cosmos = makeCosmos({
        readSyncState: sinon.stub().resolves(null),
        readComment: sinon.stub().resolves({ id: 'existing' } as any),
      });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.commentsAlreadySynced).to.equal(1);
      expect(result.commentsExported).to.equal(0);
    });

    it('writes comment when not previously synced', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({
        readComment: sinon.stub().resolves(null),
        upsertComment,
      });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      expect(upsertComment.calledOnce).to.be.true;
    });
  });

  describe('rate limit handling', () => {
    it('throws RATE_LIMIT_EXCEEDED when listPRs returns 429', async () => {
      const err = Object.assign(new Error('rate limit'), { status: 429 });
      const gh = makeGitHub({ listPRs: sinon.stub().rejects(err) });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      try {
        await svc.exportComments('owner', 'repo');
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as PRCommentExporterError).code).to.equal('RATE_LIMIT_EXCEEDED');
      }
    });

    it('throws RATE_LIMIT_EXCEEDED when listPRComments returns 429', async () => {
      const err = Object.assign(new Error('rate limit'), { status: 429 });
      const gh = makeGitHub({ listPRComments: sinon.stub().rejects(err) });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      try {
        await svc.exportComments('owner', 'repo');
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as PRCommentExporterError).code).to.equal('RATE_LIMIT_EXCEEDED');
      }
    });

    it('throws GITHUB_FETCH_FAILED on non-rate-limit error from listPRs', async () => {
      const err = new Error('network error');
      const gh = makeGitHub({ listPRs: sinon.stub().rejects(err) });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      try {
        await svc.exportComments('owner', 'repo');
        expect.fail('should have thrown');
      } catch (e) {
        expect((e as PRCommentExporterError).code).to.equal('GITHUB_FETCH_FAILED');
      }
    });

    it('skips PR (non-fatal) when listPRComments throws non-rate-limit error', async () => {
      const gh = makeGitHub({
        listPRComments: sinon.stub().rejects(new Error('forbidden')),
      });
      const svc = new PRCommentExporterService({}, gh, makeCosmos());
      const result = await svc.exportComments('owner', 'repo');
      expect(result.prsProcessed).to.equal(1);
      expect(result.commentsExported).to.equal(0);
    });
  });

  describe('resilience', () => {
    it('does not throw when readSyncState fails', async () => {
      const cosmos = makeCosmos({ readSyncState: sinon.stub().rejects(new Error('DB down')) });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.isIncremental).to.be.false;
    });

    it('does not throw when upsertSyncState fails', async () => {
      const cosmos = makeCosmos({ upsertSyncState: sinon.stub().rejects(new Error('DB down')) });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.commentsExported).to.equal(1);
    });

    it('counts skipped when upsertComment fails', async () => {
      const cosmos = makeCosmos({ upsertComment: sinon.stub().rejects(new Error('write failed')) });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.commentsSkipped).to.equal(1);
      expect(result.commentsExported).to.equal(0);
    });

    it('does not throw when loggingAdapter.log fails', async () => {
      const logging = { log: sinon.stub().rejects(new Error('log failed')) };
      const svc = new PRCommentExporterService({}, makeGitHub(), makeCosmos(), logging);
      const result = await svc.exportComments('owner', 'repo');
      expect(result.commentsExported).to.equal(1);
    });

    it('does not throw when readComment fails (proceeds to write)', async () => {
      const upsertComment = sinon.stub().resolves();
      const cosmos = makeCosmos({
        readComment: sinon.stub().rejects(new Error('read failed')),
        upsertComment,
      });
      const svc = new PRCommentExporterService({}, makeGitHub(), cosmos);
      await svc.exportComments('owner', 'repo');
      expect(upsertComment.calledOnce).to.be.true;
    });
  });

  describe('logging', () => {
    it('calls loggingAdapter.log after export', async () => {
      const log = sinon.stub().resolves();
      const svc = new PRCommentExporterService({}, makeGitHub(), makeCosmos(), { log });
      await svc.exportComments('owner', 'repo');
      expect(log.calledOnce).to.be.true;
    });

    it('log entry has type pr-comment-export', async () => {
      const log = sinon.stub().resolves();
      const svc = new PRCommentExporterService({}, makeGitHub(), makeCosmos(), { log });
      await svc.exportComments('owner', 'repo');
      expect(log.firstCall.args[0].type).to.equal('pr-comment-export');
    });

    it('log entry includes owner and repo', async () => {
      const log = sinon.stub().resolves();
      const svc = new PRCommentExporterService({}, makeGitHub(), makeCosmos(), { log });
      await svc.exportComments('owner', 'repo');
      const entry = log.firstCall.args[0];
      expect(entry.owner).to.equal('owner');
      expect(entry.repo).to.equal('repo');
    });

    it('does not call loggingAdapter when enableLogging is false', async () => {
      const log = sinon.stub().resolves();
      const svc = new PRCommentExporterService(
        { enableLogging: false },
        makeGitHub(),
        makeCosmos(),
        { log }
      );
      await svc.exportComments('owner', 'repo');
      expect(log.called).to.be.false;
    });

    it('does not call loggingAdapter when none provided', async () => {
      const svc = new PRCommentExporterService({}, makeGitHub(), makeCosmos());
      const result = await svc.exportComments('owner', 'repo');
      expect(result.commentsExported).to.equal(1);
    });
  });

  describe('DEFAULT_BOT_PATTERNS', () => {
    it('contains [bot]', () => {
      expect(DEFAULT_BOT_PATTERNS).to.include('[bot]');
    });

    it('contains dependabot', () => {
      expect(DEFAULT_BOT_PATTERNS).to.include('dependabot');
    });

    it('contains github-actions', () => {
      expect(DEFAULT_BOT_PATTERNS).to.include('github-actions');
    });

    it('contains renovate', () => {
      expect(DEFAULT_BOT_PATTERNS).to.include('renovate');
    });

    it('is readonly', () => {
      expect(() => {
        (DEFAULT_BOT_PATTERNS as string[]).push('hacker');
      }).to.throw();
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('pageSize is 100', () => {
      expect(DEFAULT_CONFIG.pageSize).to.equal(100);
    });

    it('maxPages is 50', () => {
      expect(DEFAULT_CONFIG.maxPages).to.equal(50);
    });

    it('enableLogging is true', () => {
      expect(DEFAULT_CONFIG.enableLogging).to.be.true;
    });

    it('enableStorage is true', () => {
      expect(DEFAULT_CONFIG.enableStorage).to.be.true;
    });

    it('containerName is pr-comments', () => {
      expect(DEFAULT_CONFIG.containerName).to.equal('pr-comments');
    });
  });
});
