import { expect } from 'chai';
import * as sinon from 'sinon';
import { LiveSourceAgent } from './live.source.agent.service';
import {
  LiveSourceAgentConfig,
  PinnedSource,
  LiveSourceCrawlerAdapter,
  LiveSourceIndexAdapter,
  LiveSourceEmbeddingAdapter,
  LiveSourceStateAdapter,
  LiveSourceStatusBarAdapter,
  LiveSourceProgressAdapter,
  LiveSourceError,
  LiveSourceChunk,
  PINNED_SOURCE_SYSTEM_PREFIX,
  MAX_PINNED_SOURCES,
  STATUS_BAR_PREFIX,
} from './live.source.agent.types';

const URL_INPUT = 'https://docs.nextjs.org/v15';
const PDF_BUFFER = Buffer.from('fake pdf content');
const PDF_FILENAME = 'nextjs-docs.pdf';
const SESSION_ID = 'live-abc123';
const INDEX_NAME = 'tmp-live-abc123';
const FAKE_VECTOR = Array(1536).fill(0.1);

function makeChunks(count = 3, sourceType: 'url' | 'pdf' = 'url'): LiveSourceChunk[] {
  return Array.from({ length: count }, (_, i) => ({
    content: `Chunk ${i} content about Next.js routing and deployment strategies.`,
    sourceRef: URL_INPUT,
    sourceType,
    chunkIndex: i,
    tokenCount: 20,
  }));
}

function makePinnedSource(overrides: Partial<PinnedSource> = {}): PinnedSource {
  return {
    id: 'src-001',
    label: 'docs.nextjs.org/v15',
    sourceRef: URL_INPUT,
    sourceType: 'url',
    sessionId: SESSION_ID,
    indexName: INDEX_NAME,
    chunkCount: 3,
    totalTokens: 60,
    pinnedAt: new Date().toISOString(),
    priorityWeight: 1.5,
    active: true,
    ...overrides,
  };
}

function makeAdapters(
  overrides: {
    crawler?: Partial<LiveSourceCrawlerAdapter>;
    index?: Partial<LiveSourceIndexAdapter>;
    embed?: Partial<LiveSourceEmbeddingAdapter>;
    state?: Partial<LiveSourceStateAdapter>;
    statusBar?: Partial<LiveSourceStatusBarAdapter>;
  } = {}
) {
  const crawler: LiveSourceCrawlerAdapter = {
    crawlUrl: sinon.stub().resolves(makeChunks(3, 'url')),
    parsePdf: sinon.stub().resolves(makeChunks(2, 'pdf')),
    ...overrides.crawler,
  };
  const index: LiveSourceIndexAdapter = {
    createSession: sinon.stub().resolves({ sessionId: SESSION_ID, indexName: INDEX_NAME }),
    upsertChunks: sinon.stub().resolves({ uploaded: 3 }),
    search: sinon
      .stub()
      .resolves([{ content: 'Relevant chunk text about Next.js routing.', score: 0.92 }]),
    deleteSession: sinon.stub().resolves(),
    ...overrides.index,
  };
  const embed: LiveSourceEmbeddingAdapter = {
    embed: sinon.stub().resolves(FAKE_VECTOR),
    ...overrides.embed,
  };
  const state: LiveSourceStateAdapter = {
    save: sinon.stub().resolves(),
    load: sinon.stub().resolves([]),
    ...overrides.state,
  };
  const statusBar: LiveSourceStatusBarAdapter = {
    update: sinon.stub(),
    clear: sinon.stub(),
    ...overrides.statusBar,
  };
  return { crawler, index, embed, state, statusBar };
}

function makeAgent(config: LiveSourceAgentConfig = {}, adapters = makeAdapters()): LiveSourceAgent {
  return new LiveSourceAgent(
    config,
    adapters.crawler,
    adapters.index,
    adapters.embed,
    adapters.state,
    adapters.statusBar
  );
}

describe('LiveSourceAgent', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      const agent = makeAgent();
      expect(agent).to.be.instanceOf(LiveSourceAgent);
    });

    it('accepts custom maxPinnedSources', () => {
      const agent = makeAgent({ maxPinnedSources: 3 });
      expect(agent).to.be.instanceOf(LiveSourceAgent);
    });

    it('accepts custom priorityWeight', () => {
      const agent = makeAgent({ priorityWeight: 2.0 });
      expect(agent).to.be.instanceOf(LiveSourceAgent);
    });

    it('accepts enableLogging: false', () => {
      const agent = makeAgent({ enableLogging: false });
      expect(agent).to.be.instanceOf(LiveSourceAgent);
    });

    it('accepts custom topKPerSource and maxInjectedTokens', () => {
      const agent = makeAgent({ topKPerSource: 5, maxInjectedTokens: 3000 });
      expect(agent).to.be.instanceOf(LiveSourceAgent);
    });

    it('works without a statusBar adapter', () => {
      const adapters = makeAdapters();
      const agent = new LiveSourceAgent(
        {},
        adapters.crawler,
        adapters.index,
        adapters.embed,
        adapters.state
      );
      expect(agent).to.be.instanceOf(LiveSourceAgent);
    });
  });

  describe('pinSource() — URL input validation', () => {
    it('throws INVALID_INPUT for empty URL', async () => {
      const agent = makeAgent();
      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: '' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INVALID_INPUT');
      }
      expect(threw).to.be.true;
    });

    it('throws INVALID_INPUT for non-http URL', async () => {
      const agent = makeAgent();
      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: 'ftp://example.com' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INVALID_INPUT');
      }
      expect(threw).to.be.true;
    });

    it('throws INVALID_INPUT for malformed URL', async () => {
      const agent = makeAgent();
      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: 'not a url' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INVALID_INPUT');
      }
      expect(threw).to.be.true;
    });

    it('accepts https:// URL', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.source.sourceType).to.equal('url');
    });

    it('accepts http:// URL', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: 'http://docs.example.com' });
      expect(result.source.sourceType).to.equal('url');
    });
  });

  describe('pinSource() — PDF input validation', () => {
    it('throws INVALID_INPUT for empty buffer', async () => {
      const agent = makeAgent();
      let threw = false;
      try {
        await agent.pinSource({ type: 'pdf', buffer: Buffer.alloc(0), filename: 'doc.pdf' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INVALID_INPUT');
      }
      expect(threw).to.be.true;
    });

    it('throws INVALID_INPUT for empty filename', async () => {
      const agent = makeAgent();
      let threw = false;
      try {
        await agent.pinSource({ type: 'pdf', buffer: PDF_BUFFER, filename: '' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INVALID_INPUT');
      }
      expect(threw).to.be.true;
    });

    it('accepts valid PDF input', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({
        type: 'pdf',
        buffer: PDF_BUFFER,
        filename: PDF_FILENAME,
      });
      expect(result.source.sourceType).to.equal('pdf');
    });
  });

  describe('pinSource() — URL crawl flow (AC-2)', () => {
    it('calls crawlerAdapter.crawlUrl with correct args', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({ crawlDepth: 3, maxPages: 10 }, adapters);

      await agent.pinSource({ type: 'url', url: URL_INPUT });

      expect((adapters.crawler.crawlUrl as sinon.SinonStub).calledOnce).to.be.true;
      const [url, opts] = (adapters.crawler.crawlUrl as sinon.SinonStub).firstCall.args;
      expect(url).to.equal(URL_INPUT);
      expect(opts.depth).to.equal(3);
      expect(opts.maxPages).to.equal(10);
    });

    it('calls indexAdapter.createSession', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.pinSource({ type: 'url', url: URL_INPUT });

      expect((adapters.index.createSession as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('calls indexAdapter.upsertChunks with crawled chunks', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.pinSource({ type: 'url', url: URL_INPUT });

      expect((adapters.index.upsertChunks as sinon.SinonStub).calledOnce).to.be.true;
      const [sid, chunks] = (adapters.index.upsertChunks as sinon.SinonStub).firstCall.args;
      expect(sid)
        .to.be.a('string')
        .and.match(/^live-/);
      expect(chunks).to.have.length(3);
    });

    it('returns PinResult with correct shape', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });

      expect(result).to.have.all.keys([
        'source',
        'refreshed',
        'chunksIndexed',
        'pagesCrawled',
        'durationMs',
      ]);
    });

    it('returns refreshed: false for new pin', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.refreshed).to.be.false;
    });

    it('returns chunksIndexed from upsert result', async () => {
      const adapters = makeAdapters({
        index: { upsertChunks: sinon.stub().resolves({ uploaded: 7 }) },
      });
      const agent = makeAgent({}, adapters);
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.chunksIndexed).to.equal(7);
    });

    it('returns pagesCrawled as distinct sourceRef count', async () => {
      const chunksMultiPage: LiveSourceChunk[] = [
        {
          content: 'a',
          sourceRef: 'https://docs.nextjs.org/v15/page1',
          sourceType: 'url',
          chunkIndex: 0,
          tokenCount: 5,
        },
        {
          content: 'b',
          sourceRef: 'https://docs.nextjs.org/v15/page1',
          sourceType: 'url',
          chunkIndex: 1,
          tokenCount: 5,
        },
        {
          content: 'c',
          sourceRef: 'https://docs.nextjs.org/v15/page2',
          sourceType: 'url',
          chunkIndex: 2,
          tokenCount: 5,
        },
      ];
      const adapters = makeAdapters({
        crawler: { crawlUrl: sinon.stub().resolves(chunksMultiPage) },
      });
      const agent = makeAgent({}, adapters);
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.pagesCrawled).to.equal(2);
    });

    it('returns durationMs >= 0', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.durationMs).to.be.gte(0);
    });

    it('saves sources to stateAdapter', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.pinSource({ type: 'url', url: URL_INPUT });

      expect((adapters.state.save as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('updates status bar after pin', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.pinSource({ type: 'url', url: URL_INPUT });

      expect((adapters.statusBar.update as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('derives label from URL hostname when no label provided', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.source.label).to.include('docs.nextjs.org');
    });

    it('uses provided label over derived label', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({
        type: 'url',
        url: URL_INPUT,
        label: 'My Custom Label',
      });
      expect(result.source.label).to.equal('My Custom Label');
    });

    it('sets priorityWeight from config', async () => {
      const agent = makeAgent({ priorityWeight: 2.0 });
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.source.priorityWeight).to.equal(2.0);
    });

    it('sets pinnedAt as ISO string', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(() => new Date(result.source.pinnedAt)).to.not.throw();
    });

    it('sets source.active to true', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.source.active).to.be.true;
    });
  });

  describe('pinSource() — PDF parse flow (AC-2)', () => {
    it('calls crawlerAdapter.parsePdf with correct args', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.pinSource({ type: 'pdf', buffer: PDF_BUFFER, filename: PDF_FILENAME });

      expect((adapters.crawler.parsePdf as sinon.SinonStub).calledOnce).to.be.true;
      const [buf, name] = (adapters.crawler.parsePdf as sinon.SinonStub).firstCall.args;
      expect(buf).to.equal(PDF_BUFFER);
      expect(name).to.equal(PDF_FILENAME);
    });

    it('returns pagesCrawled: 0 for PDF', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({
        type: 'pdf',
        buffer: PDF_BUFFER,
        filename: PDF_FILENAME,
      });
      expect(result.pagesCrawled).to.equal(0);
    });

    it('derives label from filename', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({
        type: 'pdf',
        buffer: PDF_BUFFER,
        filename: 'nextjs-docs.pdf',
      });
      expect(result.source.label).to.equal('nextjs-docs');
    });
  });

  describe('pinSource() — refresh existing pin', () => {
    it('returns refreshed: true when same sourceRef is re-pinned', async () => {
      const existing = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([existing]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.refreshed).to.be.true;
    });

    it('preserves original pinnedAt on refresh', async () => {
      const originalDate = '2026-01-01T00:00:00.000Z';
      const existing = makePinnedSource({ pinnedAt: originalDate });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([existing]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.source.pinnedAt).to.equal(originalDate);
    });

    it('preserves original id on refresh', async () => {
      const existing = makePinnedSource({ id: 'original-id' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([existing]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.source.id).to.equal('original-id');
    });

    it('does not count refresh against quota', async () => {
      // Fill to max - 1, existing has same sourceRef
      const sources = Array.from({ length: MAX_PINNED_SOURCES - 1 }, (_, i) =>
        makePinnedSource({ id: `s-${i}`, sourceRef: `https://other-${i}.com` })
      );
      const existing = makePinnedSource({ id: 'existing', sourceRef: URL_INPUT });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([...sources, existing]) },
      });
      const agent = makeAgent({ maxPinnedSources: MAX_PINNED_SOURCES }, adapters);

      // Should not throw even though we're at max
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.refreshed).to.be.true;
    });
  });

  describe('pinSource() — quota enforcement (AC-1 / AC-5 implied)', () => {
    it('throws MAX_SOURCES_REACHED when at capacity', async () => {
      const sources = Array.from({ length: MAX_PINNED_SOURCES }, (_, i) =>
        makePinnedSource({ id: `s-${i}`, sourceRef: `https://source-${i}.com` })
      );
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves(sources) },
      });
      const agent = makeAgent({}, adapters);

      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: 'https://new.example.com' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('MAX_SOURCES_REACHED');
      }
      expect(threw).to.be.true;
    });

    it('respects custom maxPinnedSources', async () => {
      const sources = [makePinnedSource({ sourceRef: 'https://other.com' })];
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves(sources) },
      });
      const agent = makeAgent({ maxPinnedSources: 1 }, adapters);

      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: 'https://new.example.com' });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('MAX_SOURCES_REACHED');
      }
      expect(threw).to.be.true;
    });
  });

  describe('pinSource() — error handling', () => {
    it('throws CRAWL_FAILED when crawlUrl rejects', async () => {
      const adapters = makeAdapters({
        crawler: { crawlUrl: sinon.stub().rejects(new Error('network error')) },
      });
      const agent = makeAgent({}, adapters);

      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: URL_INPUT });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('CRAWL_FAILED');
      }
      expect(threw).to.be.true;
    });

    it('throws CRAWL_FAILED when crawl returns zero chunks', async () => {
      const adapters = makeAdapters({
        crawler: { crawlUrl: sinon.stub().resolves([]) },
      });
      const agent = makeAgent({}, adapters);

      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: URL_INPUT });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('CRAWL_FAILED');
      }
      expect(threw).to.be.true;
    });

    it('throws INDEX_FAILED when createSession rejects', async () => {
      const adapters = makeAdapters({
        index: { createSession: sinon.stub().rejects(new Error('azure fail')) },
      });
      const agent = makeAgent({}, adapters);

      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: URL_INPUT });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INDEX_FAILED');
      }
      expect(threw).to.be.true;
    });

    it('throws INDEX_FAILED when upsertChunks rejects', async () => {
      const adapters = makeAdapters({
        index: { upsertChunks: sinon.stub().rejects(new Error('upsert fail')) },
      });
      const agent = makeAgent({}, adapters);

      let threw = false;
      try {
        await agent.pinSource({ type: 'url', url: URL_INPUT });
      } catch (err) {
        threw = true;
        expect((err as LiveSourceError).code).to.equal('INDEX_FAILED');
      }
      expect(threw).to.be.true;
    });

    it('LiveSourceError carries sourceRef', async () => {
      const adapters = makeAdapters({
        crawler: { crawlUrl: sinon.stub().rejects(new Error('fail')) },
      });
      const agent = makeAgent({}, adapters);

      let err: LiveSourceError | null = null;
      try {
        await agent.pinSource({ type: 'url', url: URL_INPUT });
      } catch (e) {
        err = e as LiveSourceError;
      }
      expect(err?.sourceRef).to.equal(URL_INPUT);
    });
  });

  describe('pinSource() — progress reporting', () => {
    it('calls progressAdapter.report during crawl', async () => {
      const agent = makeAgent();
      const progress: LiveSourceProgressAdapter = { report: sinon.stub() };

      await agent.pinSource({ type: 'url', url: URL_INPUT }, progress);

      expect((progress.report as sinon.SinonStub).called).to.be.true;
    });

    it('reports at least 3 progress messages', async () => {
      const agent = makeAgent();
      const progress: LiveSourceProgressAdapter = { report: sinon.stub() };

      await agent.pinSource({ type: 'url', url: URL_INPUT }, progress);

      expect((progress.report as sinon.SinonStub).callCount).to.be.gte(3);
    });

    it('works without progress adapter', async () => {
      const agent = makeAgent();
      const result = await agent.pinSource({ type: 'url', url: URL_INPUT });
      expect(result.chunksIndexed).to.be.gte(0);
    });
  });

  describe('unpinSource() (AC-6)', () => {
    it('marks source as inactive', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      await agent.unpinSource('src-001');

      const list = await agent.listPinnedSources();
      expect(list).to.have.length(0);
    });

    it('calls indexAdapter.deleteSession', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      await agent.unpinSource('src-001');

      expect((adapters.index.deleteSession as sinon.SinonStub).calledOnce).to.be.true;
      expect((adapters.index.deleteSession as sinon.SinonStub).firstCall.args[0]).to.equal(
        SESSION_ID
      );
    });

    it('saves updated sources to stateAdapter', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      await agent.unpinSource('src-001');

      expect((adapters.state.save as sinon.SinonStub).called).to.be.true;
    });

    it('clears status bar when last source is unpinned', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      await agent.unpinSource('src-001');

      expect((adapters.statusBar.clear as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('returns wasAlreadyGone: true for unknown id', async () => {
      const agent = makeAgent();
      const result = await agent.unpinSource('nonexistent');
      expect(result.wasAlreadyGone).to.be.true;
      expect(result.deleted).to.be.true;
    });

    it('returns deleted: true on success', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.unpinSource('src-001');
      expect(result.deleted).to.be.true;
      expect(result.label).to.equal(source.label);
    });

    it('sets wasAlreadyGone: true when deleteSession throws (still marks inactive)', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
        index: { deleteSession: sinon.stub().rejects(new Error('azure fail')) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.unpinSource('src-001');
      expect(result.wasAlreadyGone).to.be.true;
    });
  });

  describe('unpinByRef()', () => {
    it('unpins by sourceRef', async () => {
      const source = makePinnedSource({ id: 'src-001', sourceRef: URL_INPUT });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.unpinByRef(URL_INPUT);
      expect(result.deleted).to.be.true;
    });

    it('returns wasAlreadyGone: true for unknown sourceRef', async () => {
      const agent = makeAgent();
      const result = await agent.unpinByRef('https://unknown.com');
      expect(result.wasAlreadyGone).to.be.true;
    });
  });

  describe('injectContext() — system prompt injection (AC-3 / AC-4)', () => {
    const BASE_PROMPT = 'You are DevMind, an AI coding assistant.';
    const QUERY = 'how does Next.js routing work';

    it('returns original prompt unchanged when no sources pinned', async () => {
      const agent = makeAgent();
      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.systemPrompt).to.equal(BASE_PROMPT);
      expect(result.hasInjection).to.be.false;
    });

    it('prepends authoritative source header when sources pinned', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.systemPrompt).to.include(PINNED_SOURCE_SYSTEM_PREFIX.trim());
    });

    it('includes base prompt after injected context', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.systemPrompt).to.include(BASE_PROMPT);
    });

    it('includes source label in injected section', async () => {
      const source = makePinnedSource({ label: 'Next.js v15 docs' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.systemPrompt).to.include('Next.js v15 docs');
    });

    it('sets hasInjection: true when sources contribute chunks', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.hasInjection).to.be.true;
    });

    it('sets sourcesUsed >= 1 when chunks returned', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.sourcesUsed).to.be.gte(1);
    });

    it('sets chunksInjected >= 1', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.chunksInjected).to.be.gte(1);
    });

    it('sets addedTokens > 0 when chunks injected', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.addedTokens).to.be.greaterThan(0);
    });

    it('calls indexAdapter.search with query', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect((adapters.index.search as sinon.SinonStub).calledOnce).to.be.true;
      const args = (adapters.index.search as sinon.SinonStub).firstCall.args;
      expect(args[1]).to.equal(QUERY);
    });

    it('passes topKPerSource to search', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({ topKPerSource: 7 }, adapters);

      await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      const args = (adapters.index.search as sinon.SinonStub).firstCall.args;
      expect(args[3]).to.equal(7);
    });

    it('passes optional queryVector to search', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      await agent.injectContext({
        baseSystemPrompt: BASE_PROMPT,
        query: QUERY,
        queryVector: FAKE_VECTOR,
      });

      const args = (adapters.index.search as sinon.SinonStub).firstCall.args;
      expect(args[2]).to.deep.equal(FAKE_VECTOR);
    });

    it('skips source non-fatally when search throws', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
        index: { search: sinon.stub().rejects(new Error('search fail')) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.hasInjection).to.be.false;
      expect(result.systemPrompt).to.equal(BASE_PROMPT);
    });

    it('skips source when search returns no hits', async () => {
      const source = makePinnedSource();
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
        index: { search: sinon.stub().resolves([]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.hasInjection).to.be.false;
    });

    it('respects maxInjectedTokens cap', async () => {
      const source = makePinnedSource();
      const longHits = Array.from({ length: 10 }, (_, i) => ({
        content: 'x'.repeat(2000),
        score: 0.9 - i * 0.01,
      }));
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
        index: { search: sinon.stub().resolves(longHits) },
      });
      const agent = makeAgent({ maxInjectedTokens: 100 }, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.addedTokens).to.be.lessThan(2000);
    });

    it('does not inject inactive sources', async () => {
      const inactive = makePinnedSource({ active: false });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([inactive]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.hasInjection).to.be.false;
      expect((adapters.index.search as sinon.SinonStub).called).to.be.false;
    });

    it('includes priority weight annotation in injected header (AC-4)', async () => {
      const source = makePinnedSource({ label: 'Next.js docs', priorityWeight: 2.0 });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.injectContext({ baseSystemPrompt: BASE_PROMPT, query: QUERY });

      expect(result.systemPrompt).to.include('2');
    });
  });

  describe('listPinnedSources()', () => {
    it('returns empty array when nothing pinned', async () => {
      const agent = makeAgent();
      const list = await agent.listPinnedSources();
      expect(list).to.have.length(0);
    });

    it('returns only active sources', async () => {
      const active = makePinnedSource({ id: 'a', active: true });
      const inactive = makePinnedSource({ id: 'b', active: false });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([active, inactive]) },
      });
      const agent = makeAgent({}, adapters);

      const list = await agent.listPinnedSources();
      expect(list).to.have.length(1);
      expect(list[0].id).to.equal('a');
    });

    it('loads from stateAdapter on first call', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.listPinnedSources();

      expect((adapters.state.load as sinon.SinonStub).calledOnce).to.be.true;
    });

    it('does not call stateAdapter.load twice (cached)', async () => {
      const adapters = makeAdapters();
      const agent = makeAgent({}, adapters);

      await agent.listPinnedSources();
      await agent.listPinnedSources();

      expect((adapters.state.load as sinon.SinonStub).calledOnce).to.be.true;
    });
  });

  describe('getSource()', () => {
    it('returns source by id', async () => {
      const source = makePinnedSource({ id: 'src-001' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const result = await agent.getSource('src-001');
      expect(result?.id).to.equal('src-001');
    });

    it('returns null for unknown id', async () => {
      const agent = makeAgent();
      const result = await agent.getSource('nope');
      expect(result).to.be.null;
    });
  });

  describe('getStatusBarState() (AC-5)', () => {
    it('returns pinnedCount: 0 when nothing pinned', async () => {
      const agent = makeAgent();
      const state = await agent.getStatusBarState();
      expect(state.pinnedCount).to.equal(0);
      expect(state.labels).to.have.length(0);
    });

    it('returns correct pinnedCount', async () => {
      const sources = [
        makePinnedSource({ id: 'a', label: 'docs.nextjs.org' }),
        makePinnedSource({ id: 'b', label: 'react.dev', sourceRef: 'https://react.dev' }),
      ];
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves(sources) },
      });
      const agent = makeAgent({}, adapters);

      const state = await agent.getStatusBarState();
      expect(state.pinnedCount).to.equal(2);
    });

    it('includes labels of all active sources', async () => {
      const source = makePinnedSource({ label: 'Next.js v15 docs' });
      const adapters = makeAdapters({
        state: { load: sinon.stub().resolves([source]) },
      });
      const agent = makeAgent({}, adapters);

      const state = await agent.getStatusBarState();
      expect(state.labels).to.include('Next.js v15 docs');
    });
  });

  describe('buildStatusBarText() (AC-5)', () => {
    it('returns empty string when no sources', () => {
      const agent = makeAgent();
      const text = agent.buildStatusBarText({ pinnedCount: 0, labels: [] });
      expect(text).to.equal('');
    });

    it('includes STATUS_BAR_PREFIX pin icon', () => {
      const agent = makeAgent();
      const text = agent.buildStatusBarText({ pinnedCount: 1, labels: ['Next.js docs'] });
      expect(text).to.include(STATUS_BAR_PREFIX);
    });

    it('shows label for single source', () => {
      const agent = makeAgent();
      const text = agent.buildStatusBarText({ pinnedCount: 1, labels: ['Next.js docs'] });
      expect(text).to.include('Next.js docs');
      expect(text).to.include('pinned');
    });

    it('shows count for multiple sources', () => {
      const agent = makeAgent();
      const text = agent.buildStatusBarText({ pinnedCount: 3, labels: ['a', 'b', 'c'] });
      expect(text).to.include('3');
      expect(text).to.include('docs pinned');
    });
  });

  describe('LiveSourceError', () => {
    it('is an instance of Error', () => {
      const err = new LiveSourceError('msg', 'INVALID_INPUT');
      expect(err).to.be.instanceOf(Error);
    });

    it('carries code', () => {
      const err = new LiveSourceError('msg', 'CRAWL_FAILED', 'https://x.com');
      expect(err.code).to.equal('CRAWL_FAILED');
    });

    it('carries sourceRef', () => {
      const err = new LiveSourceError('msg', 'CRAWL_FAILED', 'https://x.com');
      expect(err.sourceRef).to.equal('https://x.com');
    });

    it('carries cause', () => {
      const cause = new Error('root');
      const err = new LiveSourceError('msg', 'INDEX_FAILED', undefined, cause);
      expect(err.cause).to.equal(cause);
    });

    it('sets name to LiveSourceError', () => {
      const err = new LiveSourceError('msg', 'INVALID_INPUT');
      expect(err.name).to.equal('LiveSourceError');
    });
  });
});
