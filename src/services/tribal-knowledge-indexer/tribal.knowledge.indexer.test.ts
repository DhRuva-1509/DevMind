import { expect } from 'chai';
import * as sinon from 'sinon';
import { TribalKnowledgeIndexerService } from './tribal.knowledge.indexer.service';
import {
  TribalKnowledgeError,
  DEFAULT_INDEXER_CONFIG,
  ALL_CATEGORIES,
  EmbeddingAdapter,
  SearchIndexAdapter,
  CategorizationAdapter,
  ExportedPRComment,
} from './tribal.knowledge.indexer.types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeComment(overrides: Partial<ExportedPRComment> = {}): ExportedPRComment {
  return {
    id: 'owner/repo/comments/1001',
    partitionKey: 'owner/repo',
    commentId: 1001,
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: add auth',
    body: 'Consider extracting the auth logic into a dedicated service.',
    author: 'alice',
    source: 'pr_review_comment',
    filePath: 'src/auth.ts',
    diffLine: 42,
    createdAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
    updatedAt: new Date().toISOString(),
    exportedAt: new Date().toISOString(),
    ...overrides,
  };
}

const MOCK_VECTOR = Array.from({ length: 1536 }, (_, i) => i / 1536);

function makeEmbedding(overrides: Partial<EmbeddingAdapter> = {}): EmbeddingAdapter {
  return {
    embed: sinon.stub().resolves([MOCK_VECTOR]),
    ...overrides,
  };
}

function makeSearch(overrides: Partial<SearchIndexAdapter> = {}): SearchIndexAdapter {
  return {
    indexExists: sinon.stub().resolves(true),
    createIndex: sinon.stub().resolves(),
    upsertDocuments: sinon.stub().resolves(),
    documentExists: sinon.stub().resolves(false),
    hybridSearch: sinon.stub().resolves([]),
    ...overrides,
  };
}

function makeCategorization(overrides: Partial<CategorizationAdapter> = {}): CategorizationAdapter {
  return {
    classify: sinon.stub().resolves({ category: 'architecture', codePatterns: ['async_await'] }),
    ...overrides,
  };
}

function makeService(
  embeddingOverrides: Partial<EmbeddingAdapter> = {},
  searchOverrides: Partial<SearchIndexAdapter> = {},
  configOverrides = {},
  categorization?: CategorizationAdapter
) {
  return new TribalKnowledgeIndexerService(
    configOverrides,
    makeEmbedding(embeddingOverrides),
    makeSearch(searchOverrides),
    categorization
  );
}

// ─── constructor ──────────────────────────────────────────────────────────────

describe('TribalKnowledgeIndexerService', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      expect(makeService()).to.be.instanceOf(TribalKnowledgeIndexerService);
    });

    it('accepts custom indexPrefix', () => {
      expect(() => makeService({}, {}, { indexPrefix: 'tk' })).to.not.throw();
    });

    it('accepts custom embeddingDimensions', () => {
      expect(() => makeService({}, {}, { embeddingDimensions: 768 })).to.not.throw();
    });

    it('accepts custom embeddingBatchSize', () => {
      expect(() => makeService({}, {}, { embeddingBatchSize: 8 })).to.not.throw();
    });

    it('accepts incrementalOnly: false', () => {
      expect(() => makeService({}, {}, { incrementalOnly: false })).to.not.throw();
    });

    it('accepts custom recencyWeight', () => {
      expect(() => makeService({}, {}, { recencyWeight: 0.8 })).to.not.throw();
    });

    it('accepts enableCategorization: false', () => {
      expect(() => makeService({}, {}, { enableCategorization: false })).to.not.throw();
    });
  });

  // ─── buildIndexName() ────────────────────────────────────────────────────────

  describe('buildIndexName()', () => {
    it('returns prefix-owner-repo format', () => {
      expect(makeService().buildIndexName('owner', 'repo')).to.equal('tribal-owner-repo');
    });

    it('lowercases all components', () => {
      expect(makeService().buildIndexName('Owner', 'Repo')).to.equal('tribal-owner-repo');
    });

    it('replaces special characters with hyphens', () => {
      expect(makeService().buildIndexName('owner', 'my.repo')).to.equal('tribal-owner-my-repo');
    });

    it('collapses multiple hyphens', () => {
      expect(makeService().buildIndexName('owner', 'my--repo')).to.equal('tribal-owner-my-repo');
    });

    it('uses custom prefix', () => {
      const svc = makeService({}, {}, { indexPrefix: 'tk' });
      expect(svc.buildIndexName('owner', 'repo')).to.equal('tk-owner-repo');
    });

    it('produces deterministic output', () => {
      const svc = makeService();
      expect(svc.buildIndexName('o', 'r')).to.equal(svc.buildIndexName('o', 'r'));
    });

    it('produces different names for different repos', () => {
      const svc = makeService();
      expect(svc.buildIndexName('o', 'r1')).to.not.equal(svc.buildIndexName('o', 'r2'));
    });
  });

  // ─── buildDocumentId() ───────────────────────────────────────────────────────

  describe('buildDocumentId()', () => {
    it('returns comment-{id} format', () => {
      expect(makeService().buildDocumentId(1001)).to.equal('comment-1001');
    });

    it('is deterministic', () => {
      expect(makeService().buildDocumentId(42)).to.equal(makeService().buildDocumentId(42));
    });

    it('differs for different comment IDs', () => {
      expect(makeService().buildDocumentId(1)).to.not.equal(makeService().buildDocumentId(2));
    });
  });

  // ─── computeRelevanceScore() ──────────────────────────────────────────────

  describe('computeRelevanceScore()', () => {
    it('returns a score between 0 and 1', () => {
      const score = makeService().computeRelevanceScore(makeComment());
      expect(score).to.be.greaterThanOrEqual(0);
      expect(score).to.be.lessThanOrEqual(1);
    });

    it('returns higher score for recent comments', () => {
      const recent = makeComment({ createdAt: new Date().toISOString() });
      const old = makeComment({ createdAt: new Date(Date.now() - 300 * 86400000).toISOString() });
      const svc = makeService();
      expect(svc.computeRelevanceScore(recent)).to.be.greaterThan(svc.computeRelevanceScore(old));
    });

    it('bottoms out at 0 for comments older than maxAgeDays', () => {
      const veryOld = makeComment({
        createdAt: new Date(Date.now() - 400 * 86400000).toISOString(),
      });
      const svc = makeService({}, {}, { maxAgeDays: 365, recencyWeight: 1, reactionWeight: 0 });
      expect(svc.computeRelevanceScore(veryOld)).to.equal(0);
    });

    it('returns close to recencyWeight for a brand-new comment', () => {
      const fresh = makeComment({ createdAt: new Date().toISOString() });
      const svc = makeService({}, {}, { recencyWeight: 0.6, reactionWeight: 0.4 });
      // recency=1, reaction=0 → score = 0.6 * 1 + 0.4 * 0 = 0.6
      expect(svc.computeRelevanceScore(fresh)).to.be.closeTo(0.6, 0.05);
    });

    it('respects custom recencyWeight', () => {
      const fresh = makeComment({ createdAt: new Date().toISOString() });
      const svc = makeService({}, {}, { recencyWeight: 1, reactionWeight: 0 });
      expect(svc.computeRelevanceScore(fresh)).to.be.closeTo(1, 0.05);
    });
  });

  // ─── buildIndexSchema() ───────────────────────────────────────────────────

  describe('buildIndexSchema()', () => {
    it('returns schema with given index name', () => {
      const schema = makeService().buildIndexSchema('tribal-owner-repo');
      expect(schema.name).to.equal('tribal-owner-repo');
    });

    it('includes id field as key', () => {
      const schema = makeService().buildIndexSchema('x');
      const id = schema.fields.find((f) => f.name === 'id');
      expect(id?.key).to.be.true;
    });

    it('includes content field as searchable', () => {
      const schema = makeService().buildIndexSchema('x');
      const content = schema.fields.find((f) => f.name === 'content');
      expect(content?.searchable).to.be.true;
    });

    it('includes contentVector with correct dimensions', () => {
      const schema = makeService().buildIndexSchema('x');
      const vec = schema.fields.find((f) => f.name === 'contentVector');
      expect(vec?.vectorSearchDimensions).to.equal(DEFAULT_INDEXER_CONFIG.embeddingDimensions);
    });

    it('contentVector dimensions reflect custom config', () => {
      const svc = makeService({}, {}, { embeddingDimensions: 768 });
      const schema = svc.buildIndexSchema('x');
      const vec = schema.fields.find((f) => f.name === 'contentVector');
      expect(vec?.vectorSearchDimensions).to.equal(768);
    });

    it('includes category field as filterable', () => {
      const schema = makeService().buildIndexSchema('x');
      const cat = schema.fields.find((f) => f.name === 'category');
      expect(cat?.filterable).to.be.true;
    });

    it('includes relevanceScore field as sortable', () => {
      const schema = makeService().buildIndexSchema('x');
      const rs = schema.fields.find((f) => f.name === 'relevanceScore');
      expect(rs?.sortable).to.be.true;
    });

    it('includes vectorSearch configuration', () => {
      const schema = makeService().buildIndexSchema('x');
      expect(schema.vectorSearch.profiles).to.have.length.greaterThan(0);
      expect(schema.vectorSearch.algorithms).to.have.length.greaterThan(0);
    });

    it('includes semanticSearch configuration', () => {
      const schema = makeService().buildIndexSchema('x');
      expect(schema.semanticSearch?.configurations).to.have.length.greaterThan(0);
    });

    it('includes codePatterns as filterable and searchable', () => {
      const schema = makeService().buildIndexSchema('x');
      const cp = schema.fields.find((f) => f.name === 'codePatterns');
      expect(cp?.filterable).to.be.true;
      expect(cp?.searchable).to.be.true;
    });
  });

  // ─── indexComments() — input validation ──────────────────────────────────

  describe('indexComments() — input validation', () => {
    it('throws INVALID_INPUT for empty owner', async () => {
      try {
        await makeService().indexComments('', 'repo', []);
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT for empty repo', async () => {
      try {
        await makeService().indexComments('owner', '', []);
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('INVALID_INPUT');
      }
    });
  });

  // ─── indexComments() — result shape ──────────────────────────────────────

  describe('indexComments() — result shape', () => {
    it('returns IndexingResult with correct keys', async () => {
      const result = await makeService().indexComments('owner', 'repo', [makeComment()]);
      expect(result).to.include.keys([
        'owner',
        'repo',
        'indexName',
        'totalComments',
        'indexed',
        'skipped',
        'failed',
        'durationMs',
        'indexedAt',
      ]);
    });

    it('sets owner and repo on result', async () => {
      const result = await makeService().indexComments('owner', 'repo', [makeComment()]);
      expect(result.owner).to.equal('owner');
      expect(result.repo).to.equal('repo');
    });

    it('sets indexName from buildIndexName', async () => {
      const result = await makeService().indexComments('owner', 'repo', [makeComment()]);
      expect(result.indexName).to.equal('tribal-owner-repo');
    });

    it('sets totalComments to input length', async () => {
      const result = await makeService().indexComments('owner', 'repo', [
        makeComment(),
        makeComment({ commentId: 1002 }),
      ]);
      expect(result.totalComments).to.equal(2);
    });

    it('sets indexed to 1 for one successful comment', async () => {
      const result = await makeService().indexComments('owner', 'repo', [makeComment()]);
      expect(result.indexed).to.equal(1);
    });

    it('sets durationMs >= 0', async () => {
      const result = await makeService().indexComments('owner', 'repo', [makeComment()]);
      expect(result.durationMs).to.be.greaterThanOrEqual(0);
    });

    it('sets indexedAt as ISO string', async () => {
      const result = await makeService().indexComments('owner', 'repo', [makeComment()]);
      expect(result.indexedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns indexed: 0 and skipped: 0 for empty input', async () => {
      const result = await makeService().indexComments('owner', 'repo', []);
      expect(result.indexed).to.equal(0);
      expect(result.skipped).to.equal(0);
    });
  });

  // ─── indexComments() — AC-1: Embeddings ──────────────────────────────────

  describe('indexComments() — embeddings (AC-1)', () => {
    it('calls embeddingAdapter.embed with comment bodies', async () => {
      const embed = sinon.stub().resolves([MOCK_VECTOR]);
      const svc = new TribalKnowledgeIndexerService({}, makeEmbedding({ embed }), makeSearch());
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(embed.calledOnce).to.be.true;
      expect(embed.firstCall.args[0]).to.deep.equal([
        'Consider extracting the auth logic into a dedicated service.',
      ]);
    });

    it('processes comments in batches of embeddingBatchSize', async () => {
      const comments = Array.from({ length: 5 }, (_, i) => makeComment({ commentId: i + 1 }));
      const embed = sinon.stub().resolves(Array(2).fill(MOCK_VECTOR));
      const svc = new TribalKnowledgeIndexerService(
        { embeddingBatchSize: 2 },
        makeEmbedding({ embed }),
        makeSearch()
      );
      await svc.indexComments('owner', 'repo', comments);
      // 5 comments / 2 batch = 3 calls (2+2+1)
      expect(embed.callCount).to.equal(3);
    });

    it('skips batch when embedding fails (non-fatal)', async () => {
      const embed = sinon.stub().rejects(new Error('embedding failed'));
      const svc = new TribalKnowledgeIndexerService({}, makeEmbedding({ embed }), makeSearch());
      const result = await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(result.failed).to.equal(1);
      expect(result.indexed).to.equal(0);
    });

    it('upserts document with contentVector from embedding', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.contentVector).to.deep.equal(MOCK_VECTOR);
    });
  });

  // ─── indexComments() — AC-2: Index per repo ───────────────────────────────

  describe('indexComments() — per-repo index (AC-2)', () => {
    it('calls indexExists with the repo-specific index name', async () => {
      const indexExists = sinon.stub().resolves(true);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ indexExists })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(indexExists.calledWith('tribal-owner-repo')).to.be.true;
    });

    it('creates index when it does not exist', async () => {
      const createIndex = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ indexExists: sinon.stub().resolves(false), createIndex })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(createIndex.calledOnce).to.be.true;
    });

    it('does not create index when it already exists', async () => {
      const createIndex = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ indexExists: sinon.stub().resolves(true), createIndex })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(createIndex.called).to.be.false;
    });

    it('throws INDEX_CREATE_FAILED when createIndex throws', async () => {
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({
          indexExists: sinon.stub().resolves(false),
          createIndex: sinon.stub().rejects(new Error('forbidden')),
        })
      );
      try {
        await svc.indexComments('owner', 'repo', [makeComment()]);
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('INDEX_CREATE_FAILED');
      }
    });

    it('uses separate index names for different repos', async () => {
      const svc = makeService();
      expect(svc.buildIndexName('owner', 'repo-a')).to.not.equal(
        svc.buildIndexName('owner', 'repo-b')
      );
    });
  });

  // ─── indexComments() — AC-3: Categorization ──────────────────────────────

  describe('indexComments() — categorization (AC-3)', () => {
    it('calls categorizationAdapter.classify with comment body', async () => {
      const classify = sinon.stub().resolves({ category: 'bug', codePatterns: [] });
      const cat = makeCategorization({ classify });
      const svc = new TribalKnowledgeIndexerService({}, makeEmbedding(), makeSearch(), cat);
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(classify.firstCall.args[0]).to.equal(
        'Consider extracting the auth logic into a dedicated service.'
      );
    });

    it('upserts document with LLM-assigned category', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const cat = makeCategorization({
        classify: sinon.stub().resolves({ category: 'security', codePatterns: [] }),
      });
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments }),
        cat
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.category).to.equal('security');
    });

    it('falls back to "other" when categorization throws', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const cat = makeCategorization({ classify: sinon.stub().rejects(new Error('LLM down')) });
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments }),
        cat
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.category).to.equal('other');
    });

    it('does not call categorization when enableCategorization is false', async () => {
      const classify = sinon.stub().resolves({ category: 'bug', codePatterns: [] });
      const cat = makeCategorization({ classify });
      const svc = new TribalKnowledgeIndexerService(
        { enableCategorization: false },
        makeEmbedding(),
        makeSearch(),
        cat
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(classify.called).to.be.false;
    });

    it('does not call categorization when no adapter provided', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.category).to.equal('other');
    });
  });

  // ─── indexComments() — AC-4: Code patterns ───────────────────────────────

  describe('indexComments() — code patterns (AC-4)', () => {
    it('upserts document with codePatterns from LLM', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const cat = makeCategorization({
        classify: sinon
          .stub()
          .resolves({ category: 'architecture', codePatterns: ['async_await', 'error_handling'] }),
      });
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments }),
        cat
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.codePatterns).to.deep.equal(['async_await', 'error_handling']);
    });

    it('upserts empty codePatterns when enablePatternExtraction is false', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const cat = makeCategorization({
        classify: sinon
          .stub()
          .resolves({ category: 'architecture', codePatterns: ['async_await'] }),
      });
      const svc = new TribalKnowledgeIndexerService(
        { enablePatternExtraction: false },
        makeEmbedding(),
        makeSearch({ upsertDocuments }),
        cat
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.codePatterns).to.deep.equal([]);
    });
  });

  // ─── indexComments() — AC-5: Incremental ─────────────────────────────────

  describe('indexComments() — incremental indexing (AC-5)', () => {
    it('checks documentExists when incrementalOnly is true', async () => {
      const documentExists = sinon.stub().resolves(false);
      const svc = new TribalKnowledgeIndexerService(
        { incrementalOnly: true },
        makeEmbedding(),
        makeSearch({ documentExists })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(documentExists.calledOnce).to.be.true;
    });

    it('skips comment when document already exists', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        { incrementalOnly: true },
        makeEmbedding(),
        makeSearch({ documentExists: sinon.stub().resolves(true), upsertDocuments })
      );
      const result = await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(result.skipped).to.equal(1);
      expect(result.indexed).to.equal(0);
      expect(upsertDocuments.called).to.be.false;
    });

    it('indexes comment when document does not exist', async () => {
      const svc = new TribalKnowledgeIndexerService(
        { incrementalOnly: true },
        makeEmbedding(),
        makeSearch({ documentExists: sinon.stub().resolves(false) })
      );
      const result = await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(result.indexed).to.equal(1);
      expect(result.skipped).to.equal(0);
    });

    it('does not check documentExists when incrementalOnly is false', async () => {
      const documentExists = sinon.stub().resolves(false);
      const svc = new TribalKnowledgeIndexerService(
        { incrementalOnly: false },
        makeEmbedding(),
        makeSearch({ documentExists })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(documentExists.called).to.be.false;
    });

    it('proceeds to index if documentExists throws (non-fatal)', async () => {
      const svc = new TribalKnowledgeIndexerService(
        { incrementalOnly: true },
        makeEmbedding(),
        makeSearch({ documentExists: sinon.stub().rejects(new Error('search down')) })
      );
      const result = await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(result.indexed).to.equal(1);
    });
  });

  // ─── indexComments() — AC-6: Relevance scoring ───────────────────────────

  describe('indexComments() — relevance scoring (AC-6)', () => {
    it('upserts document with a relevanceScore between 0 and 1', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.relevanceScore).to.be.greaterThanOrEqual(0);
      expect(doc.relevanceScore).to.be.lessThanOrEqual(1);
    });

    it('recent comments get higher relevanceScore than old ones', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      const recentComment = makeComment({ commentId: 1, createdAt: new Date().toISOString() });
      const oldComment = makeComment({
        commentId: 2,
        createdAt: new Date(Date.now() - 300 * 86400000).toISOString(),
      });
      await svc.indexComments('owner', 'repo', [recentComment]);
      const recentScore = upsertDocuments.firstCall.args[1][0].relevanceScore;
      upsertDocuments.reset();
      await svc.indexComments('owner', 'repo', [oldComment]);
      const oldScore = upsertDocuments.firstCall.args[1][0].relevanceScore;
      expect(recentScore).to.be.greaterThan(oldScore);
    });
  });

  // ─── indexComments() — document shape ────────────────────────────────────

  describe('indexComments() — document shape', () => {
    it('upserted document has correct id', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(upsertDocuments.firstCall.args[1][0].id).to.equal('comment-1001');
    });

    it('upserted document has correct owner and repo', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      const doc = upsertDocuments.firstCall.args[1][0];
      expect(doc.owner).to.equal('owner');
      expect(doc.repo).to.equal('repo');
    });

    it('upserted document has prNumber', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(upsertDocuments.firstCall.args[1][0].prNumber).to.equal(42);
    });

    it('upserted document has filePath', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(upsertDocuments.firstCall.args[1][0].filePath).to.equal('src/auth.ts');
    });

    it('upserted document has null filePath for top-level comment', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment({ filePath: null })]);
      expect(upsertDocuments.firstCall.args[1][0].filePath).to.be.null;
    });

    it('upserted document has indexedAt ISO string', async () => {
      const upsertDocuments = sinon.stub().resolves();
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments })
      );
      await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(upsertDocuments.firstCall.args[1][0].indexedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('counts failed when upsertDocuments throws', async () => {
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ upsertDocuments: sinon.stub().rejects(new Error('write failed')) })
      );
      const result = await svc.indexComments('owner', 'repo', [makeComment()]);
      expect(result.failed).to.equal(1);
      expect(result.indexed).to.equal(0);
    });
  });

  // ─── search() ─────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('throws INVALID_INPUT for empty owner', async () => {
      try {
        await makeService().search('', 'repo', 'query');
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT for empty query', async () => {
      try {
        await makeService().search('owner', 'repo', '');
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('INVALID_INPUT');
      }
    });

    it('returns TribalKnowledgeSearchResponse with correct keys', async () => {
      const result = await makeService().search('owner', 'repo', 'auth logic');
      expect(result).to.include.keys(['owner', 'repo', 'query', 'results', 'count']);
    });

    it('sets owner and repo on response', async () => {
      const result = await makeService().search('owner', 'repo', 'auth');
      expect(result.owner).to.equal('owner');
      expect(result.repo).to.equal('repo');
    });

    it('sets query on response', async () => {
      const result = await makeService().search('owner', 'repo', 'auth logic');
      expect(result.query).to.equal('auth logic');
    });

    it('embeds query before searching', async () => {
      const embed = sinon.stub().resolves([MOCK_VECTOR]);
      const svc = new TribalKnowledgeIndexerService({}, makeEmbedding({ embed }), makeSearch());
      await svc.search('owner', 'repo', 'auth logic');
      expect(embed.calledWith(['auth logic'])).to.be.true;
    });

    it('throws EMBEDDING_FAILED when embed throws', async () => {
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding({ embed: sinon.stub().rejects(new Error('embed failed')) }),
        makeSearch()
      );
      try {
        await svc.search('owner', 'repo', 'query');
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('EMBEDDING_FAILED');
      }
    });

    it('throws SEARCH_FAILED when hybridSearch throws', async () => {
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch: sinon.stub().rejects(new Error('search down')) })
      );
      try {
        await svc.search('owner', 'repo', 'query');
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeError).code).to.equal('SEARCH_FAILED');
      }
    });

    it('calls hybridSearch with correct indexName', async () => {
      const hybridSearch = sinon.stub().resolves([]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      await svc.search('owner', 'repo', 'auth');
      expect(hybridSearch.firstCall.args[0]).to.equal('tribal-owner-repo');
    });

    it('passes topK to hybridSearch', async () => {
      const hybridSearch = sinon.stub().resolves([]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      await svc.search('owner', 'repo', 'auth', { topK: 10 });
      expect(hybridSearch.firstCall.args[3].topK).to.equal(10);
    });

    it('passes category filter to hybridSearch', async () => {
      const hybridSearch = sinon.stub().resolves([]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      await svc.search('owner', 'repo', 'auth', { category: 'bug' });
      expect(hybridSearch.firstCall.args[3].filter).to.include("category eq 'bug'");
    });

    it('passes filePath filter to hybridSearch', async () => {
      const hybridSearch = sinon.stub().resolves([]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      await svc.search('owner', 'repo', 'auth', { filePath: 'src/auth.ts' });
      expect(hybridSearch.firstCall.args[3].filter).to.include('src/auth.ts');
    });

    it('passes prNumber filter to hybridSearch', async () => {
      const hybridSearch = sinon.stub().resolves([]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      await svc.search('owner', 'repo', 'auth', { prNumber: 42 });
      expect(hybridSearch.firstCall.args[3].filter).to.include('prNumber eq 42');
    });

    it('passes no filter when no options set', async () => {
      const hybridSearch = sinon.stub().resolves([]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      await svc.search('owner', 'repo', 'auth');
      expect(hybridSearch.firstCall.args[3].filter).to.be.undefined;
    });

    it('strips contentVector from search results', async () => {
      const docWithVector = {
        id: 'comment-1',
        content: 'test',
        contentVector: MOCK_VECTOR,
        owner: 'o',
        repo: 'r',
        prNumber: 1,
        prTitle: 't',
        author: 'a',
        source: 'pr_review_comment',
        filePath: null,
        category: 'bug',
        codePatterns: [],
        relevanceScore: 0.9,
        createdAt: new Date().toISOString(),
        indexedAt: new Date().toISOString(),
      };
      const hybridSearch = sinon.stub().resolves([{ document: docWithVector, score: 0.95 }]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      const response = await svc.search('owner', 'repo', 'auth');
      expect(response.results[0].document).to.not.have.property('contentVector');
    });

    it('sets count to number of results', async () => {
      const hybridSearch = sinon.stub().resolves([
        {
          document: {
            id: '1',
            content: 'a',
            owner: 'o',
            repo: 'r',
            prNumber: 1,
            prTitle: 't',
            author: 'x',
            source: 'pr_review_comment',
            filePath: null,
            category: 'bug',
            codePatterns: [],
            relevanceScore: 0.5,
            createdAt: new Date().toISOString(),
            indexedAt: new Date().toISOString(),
          },
          score: 0.9,
        },
      ]);
      const svc = new TribalKnowledgeIndexerService(
        {},
        makeEmbedding(),
        makeSearch({ hybridSearch })
      );
      const response = await svc.search('owner', 'repo', 'auth');
      expect(response.count).to.equal(1);
    });
  });

  // ─── Constants ────────────────────────────────────────────────────────────

  describe('DEFAULT_INDEXER_CONFIG', () => {
    it('indexPrefix is tribal', () => {
      expect(DEFAULT_INDEXER_CONFIG.indexPrefix).to.equal('tribal');
    });

    it('embeddingDimensions is 1536', () => {
      expect(DEFAULT_INDEXER_CONFIG.embeddingDimensions).to.equal(1536);
    });

    it('incrementalOnly is true', () => {
      expect(DEFAULT_INDEXER_CONFIG.incrementalOnly).to.be.true;
    });

    it('recencyWeight + reactionWeight equals 1', () => {
      expect(DEFAULT_INDEXER_CONFIG.recencyWeight + DEFAULT_INDEXER_CONFIG.reactionWeight).to.equal(
        1
      );
    });

    it('enableCategorization is true', () => {
      expect(DEFAULT_INDEXER_CONFIG.enableCategorization).to.be.true;
    });
  });

  describe('ALL_CATEGORIES', () => {
    it('contains bug', () => {
      expect(ALL_CATEGORIES).to.include('bug');
    });
    it('contains security', () => {
      expect(ALL_CATEGORIES).to.include('security');
    });
    it('contains architecture', () => {
      expect(ALL_CATEGORIES).to.include('architecture');
    });
    it('contains nitpick', () => {
      expect(ALL_CATEGORIES).to.include('nitpick');
    });
    it('is frozen', () => {
      expect(() => (ALL_CATEGORIES as string[]).push('x')).to.throw();
    });
  });
});
