import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { DocIndexService, SearchServiceAdapter, EmbeddingAdapter } from './doc.index.service';
import {
  DocIndexError,
  IndexNotFoundError,
  EmbeddingError,
  IndexChunkInput,
} from './doc.index.types';

function makeSearch(
  overrides: Partial<Record<keyof SearchServiceAdapter, unknown>> = {}
): SearchServiceAdapter {
  return {
    createIndex: sinon.stub().resolves({ success: true }),
    indexExists: sinon.stub().resolves(false),
    deleteIndex: sinon.stub().resolves({ success: true }),
    listIndexes: sinon.stub().resolves([]),
    upsertDocuments: sinon.stub().resolves({ succeeded: 0, failed: 0, errors: [] }),
    deleteDocuments: sinon.stub().resolves({ success: true }),
    hybridSearch: sinon.stub().resolves({ results: [], durationMs: 10 }),
    getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
    ...overrides,
  } as SearchServiceAdapter;
}

function makeEmbedder(vectors?: number[][]): EmbeddingAdapter {
  const defaultVector = Array(3072).fill(0.1);
  return {
    embed: sinon.stub().callsFake(async (texts: string[]) => ({
      embeddings: vectors ?? texts.map(() => defaultVector),
    })),
  };
}

function makeService(
  searchOverrides: Partial<Record<keyof SearchServiceAdapter, unknown>> = {},
  config: object = {}
): { service: DocIndexService; search: SearchServiceAdapter; embedder: EmbeddingAdapter } {
  const search = makeSearch(searchOverrides);
  const embedder = makeEmbedder();
  const service = new DocIndexService({ enableLogging: false, ...config }, search, embedder);
  return { service, search, embedder };
}

function makeChunk(overrides: Partial<IndexChunkInput> = {}): IndexChunkInput {
  return {
    id: 'react-getting-started-chunk-0000',
    content: 'React is a JavaScript library for building user interfaces.',
    library: 'react',
    sourceUrl: 'https://react.dev/learn',
    version: 'latest',
    projectId: 'my-project',
    chunkIndex: 0,
    tokenCount: 15,
    ...overrides,
  };
}

describe('DocIndexService', () => {
  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates an instance with injected dependencies', () => {
      const { service } = makeService();
      expect(service).to.be.instanceOf(DocIndexService);
    });

    it('accepts custom embeddingDimensions', () => {
      const { service } = makeService({}, { embeddingDimensions: 1536 });
      expect(service).to.be.instanceOf(DocIndexService);
    });

    it('accepts custom indexPrefix', () => {
      const { service } = makeService({}, { indexPrefix: 'myapp' });
      expect(service.buildIndexName('proj', 'react')).to.include('myapp');
    });

    it('accepts custom embeddingBatchSize', () => {
      const { service } = makeService({}, { embeddingBatchSize: 8 });
      expect(service).to.be.instanceOf(DocIndexService);
    });
  });

  describe('buildIndexName()', () => {
    const { service } = makeService();

    it('returns prefix-projectId-library format', () => {
      expect(service.buildIndexName('my-project', 'react')).to.equal('devmind-my-project-react');
    });

    it('lowercases all components', () => {
      expect(service.buildIndexName('MyProject', 'React')).to.equal('devmind-myproject-react');
    });

    it('replaces special characters with hyphens', () => {
      expect(service.buildIndexName('proj_1', 'next.js')).to.equal('devmind-proj-1-next-js');
    });

    it('collapses multiple hyphens', () => {
      expect(service.buildIndexName('my--project', 'react')).to.equal('devmind-my-project-react');
    });

    it('uses custom prefix when configured', () => {
      const { service: s } = makeService({}, { indexPrefix: 'acme' });
      expect(service.buildIndexName('proj', 'react')).to.match(/^devmind-/);
      expect(s.buildIndexName('proj', 'react')).to.match(/^acme-/);
    });
  });

  describe('parseIndexName()', () => {
    const { service } = makeService();

    it('parses a valid index name', () => {
      const parsed = service.parseIndexName('devmind-my-project-react');
      expect(parsed).to.deep.equal({ projectId: 'my-project', library: 'react' });
    });

    it('returns null for non-matching prefix', () => {
      expect(service.parseIndexName('other-index-name')).to.be.null;
    });

    it('returns null for too-short name', () => {
      expect(service.parseIndexName('devmind-react')).to.be.null;
    });

    it('round-trips through buildIndexName', () => {
      const name = service.buildIndexName('my-project', 'react');
      const parsed = service.parseIndexName(name);
      expect(parsed?.library).to.equal('react');
    });
  });

  describe('ensureIndex()', () => {
    it('returns the index name', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(true) });
      const name = await service.ensureIndex('proj', 'react');
      expect(name).to.equal('devmind-proj-react');
    });

    it('does not create index if it already exists', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.ensureIndex('proj', 'react');
      expect((search.createIndex as SinonStub).callCount).to.equal(0);
    });

    it('creates index when it does not exist', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(false) });
      await service.ensureIndex('proj', 'react');
      expect((search.createIndex as SinonStub).callCount).to.equal(1);
    });

    it('passes correct index name to createIndex', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(false) });
      await service.ensureIndex('my-project', 'react');
      expect((search.createIndex as SinonStub).firstCall.args[0]).to.equal(
        'devmind-my-project-react'
      );
    });

    it('throws DocIndexError when createIndex fails', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(false),
        createIndex: sinon.stub().resolves({ success: false, error: 'quota exceeded' }),
      });
      try {
        await service.ensureIndex('proj', 'react');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(DocIndexError);
        expect((e as DocIndexError).message).to.include('quota exceeded');
      }
    });
  });

  describe('deleteIndex()', () => {
    it('deletes an existing index', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.deleteIndex('proj', 'react');
      expect((search.deleteIndex as SinonStub).callCount).to.equal(1);
    });

    it('throws IndexNotFoundError when index does not exist', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(false) });
      try {
        await service.deleteIndex('proj', 'react');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(IndexNotFoundError);
      }
    });

    it('throws DocIndexError when deletion fails', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(true),
        deleteIndex: sinon.stub().resolves({ success: false, error: 'forbidden' }),
      });
      try {
        await service.deleteIndex('proj', 'react');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(DocIndexError);
      }
    });
  });

  describe('listProjectIndexes()', () => {
    it('returns empty array when no indexes exist', async () => {
      const { service } = makeService({ listIndexes: sinon.stub().resolves([]) });
      expect(await service.listProjectIndexes('proj')).to.deep.equal([]);
    });

    it('filters to only project indexes', async () => {
      const { service } = makeService({
        listIndexes: sinon
          .stub()
          .resolves([
            'devmind-proj-react',
            'devmind-proj-vue',
            'devmind-other-react',
            'unrelated-index',
          ]),
        getIndexStats: sinon.stub().resolves({ documentCount: 10, storageSize: 1024 }),
      });
      const indexes = await service.listProjectIndexes('proj');
      expect(indexes.map((i) => i.indexName)).to.have.members([
        'devmind-proj-react',
        'devmind-proj-vue',
      ]);
    });

    it('includes documentCount and storageBytes from stats', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react']),
        getIndexStats: sinon.stub().resolves({ documentCount: 42, storageSize: 8192 }),
      });
      const [info] = await service.listProjectIndexes('proj');
      expect(info.documentCount).to.equal(42);
      expect(info.storageBytes).to.equal(8192);
    });

    it('handles null stats gracefully', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react']),
        getIndexStats: sinon.stub().resolves(null),
      });
      const [info] = await service.listProjectIndexes('proj');
      expect(info.documentCount).to.equal(0);
      expect(info.storageBytes).to.equal(0);
    });
  });

  describe('indexChunks()', () => {
    it('returns an IndexResult with correct shape', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      const result = await service.indexChunks('proj', 'react', [makeChunk()]);
      expect(result).to.have.keys([
        'projectId',
        'library',
        'indexName',
        'chunksIndexed',
        'chunksSkipped',
        'errors',
        'durationMs',
      ]);
    });

    it('sets projectId and library on result', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      const result = await service.indexChunks('my-project', 'react', [makeChunk()]);
      expect(result.projectId).to.equal('my-project');
      expect(result.library).to.equal('react');
    });

    it('calls embedder with chunk content', async () => {
      const { service, embedder } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.indexChunks('proj', 'react', [makeChunk({ content: 'hello world' })]);
      expect((embedder.embed as SinonStub).firstCall.args[0]).to.include('hello world');
    });

    it('calls upsertDocuments with embedded docs', async () => {
      const { service, search } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      await service.indexChunks('proj', 'react', [makeChunk()]);
      expect((search.upsertDocuments as SinonStub).callCount).to.equal(1);
    });

    it('counts chunksIndexed correctly', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 3, failed: 0, errors: [] }),
      });
      const chunks = [makeChunk(), makeChunk({ id: 'c2' }), makeChunk({ id: 'c3' })];
      const result = await service.indexChunks('proj', 'react', chunks);
      expect(result.chunksIndexed).to.equal(3);
    });

    it('counts chunksSkipped on upsert failures', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({
          succeeded: 1,
          failed: 1,
          errors: [{ key: 'c2', message: 'size exceeded' }],
        }),
      });
      const result = await service.indexChunks('proj', 'react', [
        makeChunk(),
        makeChunk({ id: 'c2' }),
      ]);
      expect(result.chunksSkipped).to.equal(1);
      expect(result.errors).to.have.length(1);
    });

    it('skips entire batch when embedding fails', async () => {
      const embedder: EmbeddingAdapter = {
        embed: sinon.stub().rejects(new Error('embedding service unavailable')),
      };
      const search = makeSearch({ indexExists: sinon.stub().resolves(true) });
      const service = new DocIndexService({ enableLogging: false }, search, embedder);
      const result = await service.indexChunks('proj', 'react', [
        makeChunk(),
        makeChunk({ id: 'c2' }),
      ]);
      expect(result.chunksSkipped).to.equal(2);
      expect(result.errors).to.have.length(2);
      expect((search.upsertDocuments as SinonStub).callCount).to.equal(0);
    });

    it('processes chunks in batches', async () => {
      const { service, embedder } = makeService(
        { indexExists: sinon.stub().resolves(true) },
        { embeddingBatchSize: 2 }
      );
      const chunks = Array.from({ length: 5 }, (_, i) => makeChunk({ id: `c${i}` }));
      await service.indexChunks('proj', 'react', chunks);
      // 5 chunks with batch size 2 → 3 embed calls
      expect((embedder.embed as SinonStub).callCount).to.equal(3);
    });

    it('sets indexedAt as ISO string on each document', async () => {
      const { service, search } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      await service.indexChunks('proj', 'react', [makeChunk()]);
      const docs = (search.upsertDocuments as SinonStub).firstCall.args[1] as Array<
        Record<string, unknown>
      >;
      expect(docs[0]['indexedAt']).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('records durationMs', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(true) });
      const result = await service.indexChunks('proj', 'react', [makeChunk()]);
      expect(result.durationMs).to.be.a('number').and.greaterThanOrEqual(0);
    });

    it('handles empty chunk array', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(true) });
      const result = await service.indexChunks('proj', 'react', []);
      expect(result.chunksIndexed).to.equal(0);
      expect(result.errors).to.deep.equal([]);
    });
  });

  describe('updateIndex()', () => {
    it('upserts chunks when index exists', async () => {
      const { service, search } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      await service.updateIndex('proj', 'react', [makeChunk()]);
      expect((search.upsertDocuments as SinonStub).callCount).to.equal(1);
    });

    it('creates index and indexes when index does not exist', async () => {
      const { service, search } = makeService({
        indexExists: sinon.stub().resolves(false),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      await service.updateIndex('proj', 'react', [makeChunk()]);
      expect((search.createIndex as SinonStub).callCount).to.equal(1);
      expect((search.upsertDocuments as SinonStub).callCount).to.equal(1);
    });

    it('prunes stale chunks when pruneStaleChunks is true', async () => {
      const chunk = makeChunk({ sourceUrl: 'https://react.dev/old-page' });
      const { service, search } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      await service.updateIndex('proj', 'react', [chunk], {
        pruneStaleChunks: true,
        liveUrls: ['https://react.dev/new-page'],
      });
      expect((search.deleteDocuments as SinonStub).callCount).to.equal(1);
    });

    it('does not prune when pruneStaleChunks is false', async () => {
      const { service, search } = makeService({
        indexExists: sinon.stub().resolves(true),
        upsertDocuments: sinon.stub().resolves({ succeeded: 1, failed: 0, errors: [] }),
      });
      await service.updateIndex('proj', 'react', [makeChunk()], { pruneStaleChunks: false });
      expect((search.deleteDocuments as SinonStub).callCount).to.equal(0);
    });
  });

  describe('search()', () => {
    it('returns a DocSearchResponse with correct shape', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(true) });
      const response = await service.search('proj', 'how to use hooks', { library: 'react' });
      expect(response).to.have.keys([
        'projectId',
        'indexName',
        'query',
        'results',
        'totalResults',
        'durationMs',
      ]);
    });

    it('sets projectId and query on response', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(true) });
      const response = await service.search('proj', 'hooks', { library: 'react' });
      expect(response.projectId).to.equal('proj');
      expect(response.query).to.equal('hooks');
    });

    it('throws DocIndexError when library is not provided', async () => {
      const { service } = makeService();
      try {
        await service.search('proj', 'hooks');
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(DocIndexError);
      }
    });

    it('throws IndexNotFoundError when index does not exist', async () => {
      const { service } = makeService({ indexExists: sinon.stub().resolves(false) });
      try {
        await service.search('proj', 'hooks', { library: 'react' });
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(IndexNotFoundError);
      }
    });

    it('embeds the query before searching', async () => {
      const { service, embedder } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.search('proj', 'how to use hooks', { library: 'react' });
      expect((embedder.embed as SinonStub).firstCall.args[0]).to.deep.equal(['how to use hooks']);
    });

    it('passes version filter to hybridSearch when provided', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.search('proj', 'hooks', { library: 'react', version: '18.x' });
      const opts = (search.hybridSearch as SinonStub).firstCall.args[3];
      expect(opts.filter).to.include("version eq '18.x'");
    });

    it('does not set filter when version is omitted', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.search('proj', 'hooks', { library: 'react' });
      const opts = (search.hybridSearch as SinonStub).firstCall.args[3];
      expect(opts.filter).to.be.undefined;
    });

    it('passes topK to hybridSearch', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.search('proj', 'hooks', { library: 'react', topK: 5 });
      const opts = (search.hybridSearch as SinonStub).firstCall.args[3];
      expect(opts.top).to.equal(5);
    });

    it('maps search results to DocSearchResult shape', async () => {
      const { service } = makeService({
        indexExists: sinon.stub().resolves(true),
        hybridSearch: sinon.stub().resolves({
          results: [
            {
              document: {
                id: 'c1',
                content: 'React hooks intro',
                library: 'react',
                sourceUrl: 'https://react.dev',
                version: 'latest',
                chunkIndex: 0,
              },
              score: 0.95,
              rerankerScore: 0.98,
            },
          ],
          durationMs: 50,
        }),
      });
      const response = await service.search('proj', 'hooks', { library: 'react' });
      expect(response.results).to.have.length(1);
      expect(response.results[0].score).to.equal(0.95);
      expect(response.results[0].rerankerScore).to.equal(0.98);
      expect(response.results[0].content).to.equal('React hooks intro');
    });

    it('throws EmbeddingError when query embedding fails', async () => {
      const embedder: EmbeddingAdapter = {
        embed: sinon.stub().resolves({ embeddings: [], error: 'service down' }),
      };
      const search = makeSearch({ indexExists: sinon.stub().resolves(true) });
      const service = new DocIndexService({ enableLogging: false }, search, embedder);
      try {
        await service.search('proj', 'hooks', { library: 'react' });
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(EmbeddingError);
      }
    });

    it('appends additionalFilter to version filter', async () => {
      const { service, search } = makeService({ indexExists: sinon.stub().resolves(true) });
      await service.search('proj', 'hooks', {
        library: 'react',
        version: '18.x',
        additionalFilter: "projectId eq 'proj'",
      });
      const opts = (search.hybridSearch as SinonStub).firstCall.args[3];
      expect(opts.filter).to.include("version eq '18.x'");
      expect(opts.filter).to.include("projectId eq 'proj'");
    });
  });

  describe('getStorageUsage()', () => {
    it('returns StorageUsage with correct shape', async () => {
      const { service } = makeService({ listIndexes: sinon.stub().resolves([]) });
      const usage = await service.getStorageUsage('proj');
      expect(usage).to.have.keys(['projectId', 'totalDocuments', 'totalStorageBytes', 'indexes']);
    });

    it('sums documentCount across all project indexes', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react', 'devmind-proj-vue']),
        getIndexStats: sinon.stub().resolves({ documentCount: 100, storageSize: 4096 }),
      });
      const usage = await service.getStorageUsage('proj');
      expect(usage.totalDocuments).to.equal(200);
    });

    it('sums storageBytes across all project indexes', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react', 'devmind-proj-vue']),
        getIndexStats: sinon.stub().resolves({ documentCount: 10, storageSize: 1024 }),
      });
      const usage = await service.getStorageUsage('proj');
      expect(usage.totalStorageBytes).to.equal(2048);
    });

    it('returns zero totals when no indexes exist', async () => {
      const { service } = makeService({ listIndexes: sinon.stub().resolves([]) });
      const usage = await service.getStorageUsage('proj');
      expect(usage.totalDocuments).to.equal(0);
      expect(usage.totalStorageBytes).to.equal(0);
    });
  });

  describe('cleanupStaleIndexes()', () => {
    it('identifies stale indexes not in active list', async () => {
      const { service } = makeService({
        listIndexes: sinon
          .stub()
          .resolves(['devmind-proj-react', 'devmind-proj-vue', 'devmind-proj-express']),
        getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
      });
      const report = await service.cleanupStaleIndexes('proj', ['react'], true); // dry run
      expect(report.staleIndexes).to.include('devmind-proj-vue');
      expect(report.staleIndexes).to.include('devmind-proj-express');
      expect(report.staleIndexes).to.not.include('devmind-proj-react');
    });

    it('does not delete in dry run mode', async () => {
      const { service, search } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react', 'devmind-proj-vue']),
        getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
      });
      await service.cleanupStaleIndexes('proj', ['react'], true);
      expect((search.deleteIndex as SinonStub).callCount).to.equal(0);
    });

    it('deletes stale indexes when not dry run', async () => {
      const { service, search } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react', 'devmind-proj-vue']),
        getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
      });
      const report = await service.cleanupStaleIndexes('proj', ['react'], false);
      expect((search.deleteIndex as SinonStub).callCount).to.equal(1);
      expect(report.deletedCount).to.equal(1);
    });

    it('records errors for failed deletions', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react', 'devmind-proj-vue']),
        getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
        deleteIndex: sinon.stub().resolves({ success: false, error: 'access denied' }),
      });
      const report = await service.cleanupStaleIndexes('proj', ['react'], false);
      expect(report.errors).to.have.length(1);
      expect(report.errors[0]).to.include('access denied');
    });

    it('returns empty staleIndexes when all libraries are active', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react', 'devmind-proj-vue']),
        getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
      });
      const report = await service.cleanupStaleIndexes('proj', ['react', 'vue'], true);
      expect(report.staleIndexes).to.have.length(0);
    });

    it('is case-insensitive for active library matching', async () => {
      const { service } = makeService({
        listIndexes: sinon.stub().resolves(['devmind-proj-react']),
        getIndexStats: sinon.stub().resolves({ documentCount: 0, storageSize: 0 }),
      });
      const report = await service.cleanupStaleIndexes('proj', ['React'], true);
      expect(report.staleIndexes).to.have.length(0);
    });
  });

  describe('buildIndexSchema()', () => {
    const { service } = makeService();

    it('returns a schema with the given index name', () => {
      const schema = service.buildIndexSchema('devmind-proj-react');
      expect(schema.name).to.equal('devmind-proj-react');
    });

    it('includes all required fields', () => {
      const schema = service.buildIndexSchema('test-index');
      const fieldNames = schema.fields.map((f) => f.name);
      [
        'id',
        'content',
        'contentVector',
        'library',
        'sourceUrl',
        'version',
        'projectId',
        'chunkIndex',
        'tokenCount',
        'indexedAt',
      ].forEach((f) => expect(fieldNames).to.include(f));
    });

    it('id field is the key', () => {
      const schema = service.buildIndexSchema('test-index');
      const idField = schema.fields.find((f) => f.name === 'id');
      expect(idField?.key).to.be.true;
    });

    it('content field is searchable', () => {
      const schema = service.buildIndexSchema('test-index');
      const field = schema.fields.find((f) => f.name === 'content');
      expect(field?.searchable).to.be.true;
    });

    it('contentVector field has correct dimensions', () => {
      const schema = service.buildIndexSchema('test-index');
      const field = schema.fields.find((f) => f.name === 'contentVector');
      expect(field?.dimensions).to.equal(3072);
    });

    it('contentVector dimensions reflect custom embeddingDimensions config', () => {
      const { service: s } = makeService({}, { embeddingDimensions: 1536 });
      const schema = s.buildIndexSchema('test-index');
      const field = schema.fields.find((f) => f.name === 'contentVector');
      expect(field?.dimensions).to.equal(1536);
    });

    it('version field is filterable', () => {
      const schema = service.buildIndexSchema('test-index');
      const field = schema.fields.find((f) => f.name === 'version');
      expect(field?.filterable).to.be.true;
    });

    it('includes vectorSearch configuration', () => {
      const schema = service.buildIndexSchema('test-index');
      expect(schema.vectorSearch).to.be.an('object');
    });

    it('includes semanticSearch configuration', () => {
      const schema = service.buildIndexSchema('test-index');
      expect(schema.semanticSearch).to.be.an('object');
    });
  });

  describe('batchArray()', () => {
    const { service } = makeService();

    it('splits array into batches of given size', () => {
      const batches = service.batchArray([1, 2, 3, 4, 5], 2);
      expect(batches).to.deep.equal([[1, 2], [3, 4], [5]]);
    });

    it('returns single batch when array is smaller than size', () => {
      expect(service.batchArray([1, 2], 10)).to.deep.equal([[1, 2]]);
    });

    it('returns empty array for empty input', () => {
      expect(service.batchArray([], 5)).to.deep.equal([]);
    });

    it('returns exact batches when evenly divisible', () => {
      const batches = service.batchArray([1, 2, 3, 4], 2);
      expect(batches).to.have.length(2);
    });
  });

  describe('sanitizeId()', () => {
    const { service } = makeService();

    it('preserves alphanumeric characters', () => {
      expect(service.sanitizeId('chunk123')).to.equal('chunk123');
    });

    it('replaces slashes with underscores', () => {
      expect(service.sanitizeId('react/getting-started/chunk-0000')).to.include('_');
    });

    it('truncates to 1024 characters', () => {
      const long = 'a'.repeat(2000);
      expect(service.sanitizeId(long).length).to.be.at.most(1024);
    });

    it('preserves hyphens and underscores', () => {
      expect(service.sanitizeId('my-chunk_0001')).to.equal('my-chunk_0001');
    });
  });
});
