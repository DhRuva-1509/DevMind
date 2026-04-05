import { expect } from 'chai';
import * as sinon from 'sinon';
import { TempIndexManager } from './temp.index.manager.service';
import {
  TempIndexManagerConfig,
  TempIndexRecord,
  TempSearchIndexAdapter,
  TempEmbeddingAdapter,
  TempStateAdapter,
  TempIndexError,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_STORAGE_BYTES,
  MAX_ACTIVE_INDEXES,
} from './temp.index.manager.types';

const SESSION_ID = 'session-abc123';
const SOURCE_LABEL = 'https://docs.example.com/api';
const FAKE_VECTOR = Array(1536).fill(0.1);

function makeRecord(overrides: Partial<TempIndexRecord> = {}): TempIndexRecord {
  return {
    sessionId: SESSION_ID,
    indexName: `tmp-${SESSION_ID}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    pinTarget: { type: 'none' },
    documentCount: 0,
    estimatedStorageBytes: 0,
    sourceLabel: SOURCE_LABEL,
    ...overrides,
  };
}

function makeExpiredRecord(): TempIndexRecord {
  return makeRecord({ expiresAt: new Date(Date.now() - 1000).toISOString() });
}

function makeAdapters(
  overrides: {
    search?: Partial<TempSearchIndexAdapter>;
    embed?: Partial<TempEmbeddingAdapter>;
    state?: Partial<TempStateAdapter>;
  } = {}
) {
  const search: TempSearchIndexAdapter = {
    indexExists: sinon.stub().resolves(false),
    createIndex: sinon.stub().resolves(),
    deleteIndex: sinon.stub().resolves(),
    listIndexesByPrefix: sinon.stub().resolves([]),
    upsertDocuments: sinon.stub().resolves(),
    search: sinon.stub().resolves([]),
    ...overrides.search,
  };
  const embed: TempEmbeddingAdapter = {
    embed: sinon.stub().resolves(FAKE_VECTOR),
    ...overrides.embed,
  };
  const state: TempStateAdapter = {
    saveRecord: sinon.stub().resolves(),
    readRecord: sinon.stub().resolves(null),
    deleteRecord: sinon.stub().resolves(),
    listRecords: sinon.stub().resolves([]),
    ...overrides.state,
  };
  return { search, embed, state };
}

function makeManager(
  config: TempIndexManagerConfig = {},
  adapters = makeAdapters()
): TempIndexManager {
  return new TempIndexManager(config, adapters.search, adapters.embed, adapters.state);
}

describe('TempIndexManager', () => {
  describe('buildIndexName()', () => {
    it('returns prefix-sessionId by default', () => {
      const mgr = makeManager();
      expect(mgr.buildIndexName('my-session')).to.equal('tmp-my-session');
    });

    it('uses configured prefix', () => {
      const mgr = makeManager({ indexPrefix: 'live' });
      expect(mgr.buildIndexName('abc')).to.equal('live-abc');
    });

    it('lowercases sessionId', () => {
      const mgr = makeManager();
      expect(mgr.buildIndexName('MySession')).to.equal('tmp-mysession');
    });

    it('replaces invalid chars with dashes', () => {
      const mgr = makeManager();
      expect(mgr.buildIndexName('hello world')).to.equal('tmp-hello-world');
    });

    it('collapses multiple dashes', () => {
      const mgr = makeManager();
      const result = mgr.buildIndexName('a  b');
      expect(result).to.equal('tmp-a--b'.replace(/--+/g, '-'));
    });

    it('truncates long sessionIds', () => {
      const mgr = makeManager();
      const long = 'a'.repeat(100);
      const result = mgr.buildIndexName(long);
      expect(result.length).to.be.lessThan(80);
    });
  });

  describe('createIndex()', () => {
    it('creates a new index and returns a record', async () => {
      const adapters = makeAdapters();
      const mgr = makeManager({}, adapters);

      const result = await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      expect(result.reused).to.be.false;
      expect(result.record.sessionId).to.equal(SESSION_ID);
      expect(result.record.sourceLabel).to.equal(SOURCE_LABEL);
      expect(result.record.indexName).to.equal(`tmp-${SESSION_ID}`);
      expect(result.record.pinTarget).to.deep.equal({ type: 'none' });
    });

    it('calls searchAdapter.createIndex with correct name and dimensions', async () => {
      const adapters = makeAdapters();
      const mgr = makeManager({ embeddingDimensions: 768 }, adapters);

      await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      expect((adapters.search.createIndex as sinon.SinonStub).calledOnce).to.be.true;
      const [indexName, dims] = (adapters.search.createIndex as sinon.SinonStub).firstCall.args;
      expect(indexName).to.equal(`tmp-${SESSION_ID}`);
      expect(dims).to.equal(768);
    });

    it('saves the record via stateAdapter', async () => {
      const adapters = makeAdapters();
      const mgr = makeManager({}, adapters);

      await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      expect((adapters.state.saveRecord as sinon.SinonStub).calledOnce).to.be.true;
      const saved = (adapters.state.saveRecord as sinon.SinonStub).firstCall.args[0];
      expect(saved.sessionId).to.equal(SESSION_ID);
    });

    it('sets expiresAt based on configured TTL', async () => {
      const ttlMs = 10 * 60 * 1000; // 10 minutes
      const adapters = makeAdapters();
      const mgr = makeManager({ ttlMs }, adapters);
      const before = Date.now();

      const result = await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      const expiresAt = new Date(result.record.expiresAt).getTime();
      expect(expiresAt).to.be.gte(before + ttlMs - 50);
      expect(expiresAt).to.be.lte(before + ttlMs + 200);
    });

    it('reuses an existing session and refreshes TTL', async () => {
      const existing = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(existing) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      expect(result.reused).to.be.true;
      expect((adapters.search.createIndex as sinon.SinonStub).called).to.be.false;
    });

    it('accepts a project pin', async () => {
      const adapters = makeAdapters();
      const mgr = makeManager({}, adapters);

      const result = await mgr.createIndex({
        sessionId: SESSION_ID,
        sourceLabel: SOURCE_LABEL,
        pinTarget: { type: 'project', projectId: 'my-project' },
      });

      expect(result.record.pinTarget).to.deep.equal({ type: 'project', projectId: 'my-project' });
    });

    it('accepts a branch pin', async () => {
      const adapters = makeAdapters();
      const mgr = makeManager({}, adapters);

      const result = await mgr.createIndex({
        sessionId: SESSION_ID,
        sourceLabel: SOURCE_LABEL,
        pinTarget: { type: 'branch', owner: 'acme', repo: 'api', branch: 'main' },
      });

      expect(result.record.pinTarget).to.deep.equal({
        type: 'branch',
        owner: 'acme',
        repo: 'api',
        branch: 'main',
      });
    });

    it('throws INVALID_SESSION_ID for empty sessionId', async () => {
      const mgr = makeManager();
      let threw = false;
      try {
        await mgr.createIndex({ sessionId: '', sourceLabel: SOURCE_LABEL });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('INVALID_SESSION_ID');
      }
      expect(threw).to.be.true;
    });

    it('throws MAX_INDEXES_REACHED when at capacity', async () => {
      const fullRecords = Array.from({ length: MAX_ACTIVE_INDEXES }, (_, i) =>
        makeRecord({ sessionId: `s-${i}`, indexName: `tmp-s-${i}` })
      );
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves(fullRecords) },
      });
      const mgr = makeManager({}, adapters);

      let threw = false;
      try {
        await mgr.createIndex({ sessionId: 'new-session', sourceLabel: SOURCE_LABEL });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('MAX_INDEXES_REACHED');
      }
      expect(threw).to.be.true;
    });

    it('throws QUOTA_EXCEEDED when storage is full', async () => {
      const bigRecord = makeRecord({ estimatedStorageBytes: DEFAULT_MAX_STORAGE_BYTES });
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([bigRecord]) },
      });
      const mgr = makeManager({}, adapters);

      let threw = false;
      try {
        await mgr.createIndex({ sessionId: 'new-session', sourceLabel: SOURCE_LABEL });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('QUOTA_EXCEEDED');
      }
      expect(threw).to.be.true;
    });

    it('throws INDEX_CREATE_FAILED when searchAdapter.createIndex rejects', async () => {
      const adapters = makeAdapters({
        search: { createIndex: sinon.stub().rejects(new Error('Azure error')) },
      });
      const mgr = makeManager({}, adapters);

      let threw = false;
      try {
        await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('INDEX_CREATE_FAILED');
      }
      expect(threw).to.be.true;
    });

    it('auto-expires stale records before quota check when enableAutoExpiry is true', async () => {
      const expired = makeExpiredRecord();
      const listStub = sinon.stub().resolves([expired]);
      const adapters = makeAdapters({
        state: { listRecords: listStub, deleteRecord: sinon.stub().resolves() },
      });
      const mgr = makeManager({ enableAutoExpiry: true }, adapters);

      await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      // deleteRecord should have been called for the expired session
      expect((adapters.state.deleteRecord as sinon.SinonStub).called).to.be.true;
    });

    it('skips auto-expiry when enableAutoExpiry is false', async () => {
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([expired]) },
      });
      const mgr = makeManager({ enableAutoExpiry: false, maxActiveIndexes: 5 }, adapters);

      // Should not throw even if an expired record is in the list,
      // since it is counted against the quota without being cleaned up
      // (expired record is still in count without auto-expiry)
      await mgr.createIndex({ sessionId: SESSION_ID, sourceLabel: SOURCE_LABEL });

      expect((adapters.state.deleteRecord as sinon.SinonStub).called).to.be.false;
    });
  });

  describe('upsertChunks()', () => {
    const CHUNKS = [
      {
        content: 'Hello world',
        sourceRef: 'https://example.com',
        sourceType: 'url' as const,
        chunkIndex: 0,
        tokenCount: 3,
      },
      {
        content: 'Second chunk',
        sourceRef: 'https://example.com',
        sourceType: 'url' as const,
        chunkIndex: 1,
        tokenCount: 2,
      },
    ];

    it('embeds each chunk and upserts to search', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });

      expect(result.uploaded).to.equal(2);
      expect(result.skipped).to.equal(0);
      expect(result.errors).to.have.length(0);
      expect((adapters.embed.embed as sinon.SinonStub).callCount).to.equal(2);
      expect((adapters.search.upsertDocuments as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('skips a chunk and records error when embed fails', async () => {
      const record = makeRecord();
      const embedStub = sinon.stub();
      embedStub.onFirstCall().rejects(new Error('embed error'));
      embedStub.onSecondCall().resolves(FAKE_VECTOR);
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        embed: { embed: embedStub },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });

      expect(result.uploaded).to.equal(1);
      expect(result.skipped).to.equal(1);
      expect(result.errors).to.have.length(1);
      expect(result.errors[0]).to.include('embed error');
    });

    it('assigns zero-padded chunk IDs', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });

      const docs = (adapters.search.upsertDocuments as sinon.SinonStub).firstCall.args[1];
      expect(docs[0].id).to.equal(`${SESSION_ID}-0000`);
      expect(docs[1].id).to.equal(`${SESSION_ID}-0001`);
    });

    it('updates documentCount and estimatedStorageBytes in record', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });

      const saved = (adapters.state.saveRecord as sinon.SinonStub).firstCall.args[0];
      expect(saved.documentCount).to.equal(2);
      expect(saved.estimatedStorageBytes).to.be.greaterThan(0);
    });

    it('refreshes TTL on successful upsert', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({ ttlMs: 5 * 60 * 1000 }, adapters);
      const before = Date.now();

      await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });

      const saved = (adapters.state.saveRecord as sinon.SinonStub).firstCall.args[0];
      const expiresAt = new Date(saved.expiresAt).getTime();
      expect(expiresAt).to.be.gte(before + 5 * 60 * 1000 - 50);
    });

    it('throws SESSION_NOT_FOUND when session does not exist', async () => {
      const mgr = makeManager();

      let threw = false;
      try {
        await mgr.upsertChunks({ sessionId: 'missing', chunks: CHUNKS });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SESSION_NOT_FOUND');
      }
      expect(threw).to.be.true;
    });

    it('throws SESSION_NOT_FOUND when session is expired', async () => {
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(expired) },
      });
      const mgr = makeManager({}, adapters);

      let threw = false;
      try {
        await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SESSION_NOT_FOUND');
      }
      expect(threw).to.be.true;
    });

    it('throws UPSERT_FAILED when searchAdapter.upsertDocuments rejects', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: { upsertDocuments: sinon.stub().rejects(new Error('azure fail')) },
      });
      const mgr = makeManager({}, adapters);

      let threw = false;
      try {
        await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('UPSERT_FAILED');
      }
      expect(threw).to.be.true;
    });

    it('does not call upsertDocuments when all embeds fail', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        embed: { embed: sinon.stub().rejects(new Error('fail')) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.upsertChunks({ sessionId: SESSION_ID, chunks: CHUNKS });

      expect(result.uploaded).to.equal(0);
      expect((adapters.search.upsertDocuments as sinon.SinonStub).called).to.be.false;
    });
  });

  describe('search()', () => {
    it('returns results from searchAdapter', async () => {
      const record = makeRecord();
      const hits = [{ id: 'h1', content: 'hi', sourceRef: 'url', chunkIndex: 0, score: 0.9 }];
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: { search: sinon.stub().resolves(hits) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.search({ sessionId: SESSION_ID, query: 'test' });

      expect(result.results).to.deep.equal(hits);
      expect(result.indexName).to.equal(record.indexName);
    });

    it('passes topK to searchAdapter', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      await mgr.search({ sessionId: SESSION_ID, query: 'q', topK: 10 });

      const args = (adapters.search.search as sinon.SinonStub).firstCall.args;
      expect(args[3]).to.equal(10);
    });

    it('passes vector when provided', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      await mgr.search({ sessionId: SESSION_ID, query: 'q', vector: FAKE_VECTOR });

      const args = (adapters.search.search as sinon.SinonStub).firstCall.args;
      expect(args[2]).to.deep.equal(FAKE_VECTOR);
    });

    it('returns durationMs', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.search({ sessionId: SESSION_ID, query: 'q' });

      expect(result.durationMs).to.be.gte(0);
    });

    it('throws SESSION_NOT_FOUND for unknown sessionId', async () => {
      const mgr = makeManager();
      let threw = false;
      try {
        await mgr.search({ sessionId: 'nope', query: 'q' });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SESSION_NOT_FOUND');
      }
      expect(threw).to.be.true;
    });

    it('throws SESSION_NOT_FOUND for expired session', async () => {
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(expired) },
      });
      const mgr = makeManager({}, adapters);
      let threw = false;
      try {
        await mgr.search({ sessionId: SESSION_ID, query: 'q' });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SESSION_NOT_FOUND');
      }
      expect(threw).to.be.true;
    });

    it('throws SEARCH_FAILED when searchAdapter.search rejects', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: { search: sinon.stub().rejects(new Error('azure fail')) },
      });
      const mgr = makeManager({}, adapters);
      let threw = false;
      try {
        await mgr.search({ sessionId: SESSION_ID, query: 'q' });
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SEARCH_FAILED');
      }
      expect(threw).to.be.true;
    });
  });

  describe('deleteIndex()', () => {
    it('deletes the index and record when both exist', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: { indexExists: sinon.stub().resolves(true) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.deleteIndex(SESSION_ID);

      expect(result.deleted).to.be.true;
      expect(result.wasAlreadyGone).to.be.false;
      expect((adapters.search.deleteIndex as sinon.SinonStub).calledOnce).to.be.true;
      expect((adapters.state.deleteRecord as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('sets wasAlreadyGone when index does not exist in search', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: { indexExists: sinon.stub().resolves(false) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.deleteIndex(SESSION_ID);

      expect(result.wasAlreadyGone).to.be.true;
      expect((adapters.search.deleteIndex as sinon.SinonStub).called).to.be.false;
    });

    it('still deletes state record even when index was already gone', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: { indexExists: sinon.stub().resolves(false) },
      });
      const mgr = makeManager({}, adapters);

      await mgr.deleteIndex(SESSION_ID);

      expect((adapters.state.deleteRecord as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('falls back to buildIndexName when no state record exists', async () => {
      const adapters = makeAdapters({
        search: { indexExists: sinon.stub().resolves(true) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.deleteIndex(SESSION_ID);

      expect(result.indexName).to.equal(`tmp-${SESSION_ID}`);
      expect(result.deleted).to.be.true;
    });

    it('throws INDEX_DELETE_FAILED when deleteIndex rejects', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
        search: {
          indexExists: sinon.stub().resolves(true),
          deleteIndex: sinon.stub().rejects(new Error('azure fail')),
        },
      });
      const mgr = makeManager({}, adapters);

      let threw = false;
      try {
        await mgr.deleteIndex(SESSION_ID);
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('INDEX_DELETE_FAILED');
      }
      expect(threw).to.be.true;
    });
  });

  describe('listActiveIndexes()', () => {
    it('returns only non-expired records', async () => {
      const active = makeRecord({ sessionId: 'active' });
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([active, expired]) },
      });
      const mgr = makeManager({ enableAutoExpiry: false }, adapters);

      const result = await mgr.listActiveIndexes();

      expect(result).to.have.length(1);
      expect(result[0].sessionId).to.equal('active');
    });

    it('returns empty array when no active indexes', async () => {
      const mgr = makeManager();
      const result = await mgr.listActiveIndexes();
      expect(result).to.have.length(0);
    });

    it('auto-expires stale sessions before listing when enabled', async () => {
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: {
          listRecords: sinon.stub().resolves([expired]),
          deleteRecord: sinon.stub().resolves(),
        },
      });
      const mgr = makeManager({ enableAutoExpiry: true }, adapters);

      await mgr.listActiveIndexes();

      expect((adapters.state.deleteRecord as sinon.SinonStub).called).to.be.true;
    });
  });

  describe('cleanupExpired()', () => {
    it('deletes expired indexes and records', async () => {
      const expired1 = makeExpiredRecord();
      const expired2 = makeRecord({
        sessionId: 'exp2',
        indexName: 'tmp-exp2',
        expiresAt: new Date(0).toISOString(),
      });
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([expired1, expired2]) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.cleanupExpired();

      expect(result.deletedCount).to.equal(2);
      expect(result.expiredSessionIds).to.include(SESSION_ID);
      expect(result.expiredSessionIds).to.include('exp2');
      expect(result.errors).to.have.length(0);
    });

    it('returns empty result when no expired indexes', async () => {
      const mgr = makeManager();
      const result = await mgr.cleanupExpired();
      expect(result.deletedCount).to.equal(0);
      expect(result.expiredSessionIds).to.have.length(0);
    });

    it('records error and continues when a delete fails', async () => {
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([expired]) },
        search: { deleteIndex: sinon.stub().rejects(new Error('fail')) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.cleanupExpired();

      expect(result.deletedCount).to.equal(0);
      expect(result.errors).to.have.length(1);
      expect(result.errors[0]).to.include('fail');
    });

    it('does not touch active indexes', async () => {
      const active = makeRecord({ sessionId: 'active' });
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([active]) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.cleanupExpired();

      expect(result.deletedCount).to.equal(0);
      expect((adapters.search.deleteIndex as sinon.SinonStub).called).to.be.false;
    });
  });

  describe('pinToProject()', () => {
    it('updates pinTarget to project', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.pinToProject(SESSION_ID, 'proj-123');

      expect(result.pinTarget).to.deep.equal({ type: 'project', projectId: 'proj-123' });
      expect((adapters.state.saveRecord as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('throws SESSION_NOT_FOUND when record missing', async () => {
      const mgr = makeManager();
      let threw = false;
      try {
        await mgr.pinToProject('nope', 'proj');
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SESSION_NOT_FOUND');
      }
      expect(threw).to.be.true;
    });
  });

  describe('pinToBranch()', () => {
    it('updates pinTarget to branch', async () => {
      const record = makeRecord();
      const adapters = makeAdapters({
        state: { readRecord: sinon.stub().resolves(record) },
      });
      const mgr = makeManager({}, adapters);

      const result = await mgr.pinToBranch(SESSION_ID, 'acme', 'api', 'feature/x');

      expect(result.pinTarget).to.deep.equal({
        type: 'branch',
        owner: 'acme',
        repo: 'api',
        branch: 'feature/x',
      });
    });

    it('throws SESSION_NOT_FOUND when record missing', async () => {
      const mgr = makeManager();
      let threw = false;
      try {
        await mgr.pinToBranch('nope', 'o', 'r', 'b');
      } catch (err) {
        threw = true;
        expect((err as TempIndexError).code).to.equal('SESSION_NOT_FOUND');
      }
      expect(threw).to.be.true;
    });
  });

  describe('getQuotaStatus()', () => {
    it('returns withinQuota true when under limits', async () => {
      const active = makeRecord({ estimatedStorageBytes: 1024 });
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([active]) },
      });
      const mgr = makeManager({ enableAutoExpiry: false }, adapters);

      const status = await mgr.getQuotaStatus();

      expect(status.withinQuota).to.be.true;
      expect(status.activeIndexCount).to.equal(1);
      expect(status.totalEstimatedBytes).to.equal(1024);
    });

    it('returns withinQuota false when storage exceeded', async () => {
      const big = makeRecord({ estimatedStorageBytes: DEFAULT_MAX_STORAGE_BYTES + 1 });
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([big]) },
      });
      const mgr = makeManager({ enableAutoExpiry: false }, adapters);

      const status = await mgr.getQuotaStatus();

      expect(status.withinQuota).to.be.false;
    });

    it('returns withinQuota false when index count exceeded', async () => {
      const records = Array.from({ length: MAX_ACTIVE_INDEXES }, (_, i) =>
        makeRecord({ sessionId: `s-${i}`, indexName: `tmp-s-${i}` })
      );
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves(records) },
      });
      const mgr = makeManager({ enableAutoExpiry: false }, adapters);

      const status = await mgr.getQuotaStatus();

      expect(status.withinQuota).to.be.false;
    });

    it('calculates usedPercent correctly', async () => {
      const half = makeRecord({ estimatedStorageBytes: DEFAULT_MAX_STORAGE_BYTES / 2 });
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([half]) },
      });
      const mgr = makeManager({ enableAutoExpiry: false }, adapters);

      const status = await mgr.getQuotaStatus();

      expect(status.usedPercent).to.equal(50);
    });

    it('excludes expired records from quota', async () => {
      const expired = makeExpiredRecord();
      const adapters = makeAdapters({
        state: { listRecords: sinon.stub().resolves([expired]) },
      });
      const mgr = makeManager({ enableAutoExpiry: false }, adapters);

      const status = await mgr.getQuotaStatus();

      expect(status.activeIndexCount).to.equal(0);
      expect(status.totalEstimatedBytes).to.equal(0);
    });
  });

  describe('TempIndexError', () => {
    it('carries code, sessionId, and cause', () => {
      const cause = new Error('root');
      const err = new TempIndexError('msg', 'SESSION_NOT_FOUND', 'my-session', cause);
      expect(err.code).to.equal('SESSION_NOT_FOUND');
      expect(err.sessionId).to.equal('my-session');
      expect(err.cause).to.equal(cause);
      expect(err.name).to.equal('TempIndexError');
    });

    it('is an instance of Error', () => {
      const err = new TempIndexError('msg', 'INVALID_SESSION_ID');
      expect(err).to.be.instanceOf(Error);
    });
  });
});
