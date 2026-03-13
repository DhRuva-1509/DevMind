// ─────────────────────────────────────────────────────────────
// Documentation Crawler Service – Unit Tests
// TICKET-08 | DevMind – Documentation Crawler Service
// Framework: Mocha + Chai v4 + Sinon  (matches Sprint pattern)
// ─────────────────────────────────────────────────────────────

import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { DocCrawlerService, HttpClient, HttpResponse, BlobWriter } from './doc.crawler';
import { CrawlerError, SUPPORTED_LIBRARIES } from './doc.crawler.types';

// ── Fake Factories ────────────────────────────────────────────

function makeHttp(overrides: Partial<Record<string, HttpResponse>> = {}): HttpClient {
  return {
    get: sinon.stub().callsFake(async (url: string) => {
      if (overrides[url]) return overrides[url]!;
      if (url.endsWith('/robots.txt')) {
        return { status: 200, data: '', headers: {} };
      }
      return {
        status: 200,
        data: '<html><head><title>Test Page</title></head><body><main><p>Hello world content here for testing.</p></main></body></html>',
        headers: {},
      };
    }),
  };
}

function makeBlob(): {
  writer: BlobWriter;
  writes: Array<{ container: string; key: string; content: string }>;
} {
  const writes: Array<{ container: string; key: string; content: string }> = [];
  const writer: BlobWriter = {
    write: sinon.stub().callsFake(async (container: string, key: string, content: string) => {
      writes.push({ container, key, content });
    }),
    exists: sinon.stub().resolves(false),
  };
  return { writer, writes };
}

function makeCrawler(
  httpOverrides: Partial<Record<string, HttpResponse>> = {},
  config: object = {}
): { crawler: DocCrawlerService; blob: ReturnType<typeof makeBlob> } {
  const blob = makeBlob();
  const crawler = new DocCrawlerService(
    { enableLogging: false, rateLimitMs: 0, ...config },
    makeHttp(httpOverrides),
    blob.writer
  );
  return { crawler, blob };
}

// ── Minimal HTML fixtures ─────────────────────────────────────

const DOCUSAURUS_HTML = `
<html>
  <head><title>React Docs</title><meta name="generator" content="Docusaurus"/></head>
  <body>
    <nav class="navbar__brand">nav</nav>
    <main>
      <article class="theme-doc-markdown">
        <h1>React Overview</h1>
        <p>React is a JavaScript library for building user interfaces.</p>
        <p>It lets you compose complex UIs from small, isolated pieces of code called components.</p>
      </article>
    </main>
  </body>
</html>`;

const SPHINX_HTML = `
<html>
  <head><title>Sphinx Docs</title></head>
  <body class="wy-body-for-nav">
    <div class="sphinxsidebar">sidebar</div>
    <div class="body" role="main">
      <h1>Module Reference</h1>
      <p>This is the main documentation content for the module.</p>
    </div>
  </body>
</html>`;

const MKDOCS_HTML = `
<html>
  <head><title>MkDocs Site</title><meta name="generator" content="mkdocs"/></head>
  <body>
    <div class="md-sidebar">sidebar</div>
    <div class="md-content">
      <article class="md-content__inner">
        <h1>Getting Started</h1>
        <p>Welcome to the documentation site. This covers installation and setup.</p>
      </article>
    </div>
  </body>
</html>`;

const VITEPRESS_HTML = `
<html>
  <head><title>VitePress Docs</title></head>
  <body>
    <div class="VPSidebar">sidebar</div>
    <div class="VPDoc">
      <h1>Guide</h1>
      <p>This is the VitePress documentation content.</p>
    </div>
  </body>
</html>`;

const WITH_LINKS_HTML = `
<html>
  <head><title>Index</title></head>
  <body>
    <main>
      <p>Content here.</p>
      <a href="/docs/getting-started">Getting Started</a>
      <a href="/docs/api-reference">API Reference</a>
      <a href="https://external.com/page">External</a>
      <a href="/docs/image.png">Image link</a>
      <a href="#anchor">Anchor</a>
    </main>
  </body>
</html>`;

// ── Tests ─────────────────────────────────────────────────────

describe('DocCrawlerService', () => {
  afterEach(() => sinon.restore());

  // ── Constructor ──────────────────────────────────────────────

  describe('constructor', () => {
    it('creates an instance with injected dependencies', () => {
      const { crawler } = makeCrawler();
      expect(crawler).to.be.instanceOf(DocCrawlerService);
    });

    it('accepts custom maxDepth config', () => {
      const { crawler } = makeCrawler({}, { maxDepth: 5 });
      expect(crawler).to.be.instanceOf(DocCrawlerService);
    });

    it('accepts custom maxPages config', () => {
      const { crawler } = makeCrawler({}, { maxPages: 50 });
      expect(crawler).to.be.instanceOf(DocCrawlerService);
    });

    it('accepts custom chunkTargetTokens', () => {
      const { crawler } = makeCrawler({}, { chunkTargetTokens: 500 });
      expect(crawler).to.be.instanceOf(DocCrawlerService);
    });

    it('accepts enableCache: false', () => {
      const { crawler } = makeCrawler({}, { enableCache: false });
      expect(crawler.getCacheSize()).to.equal(0);
    });
  });

  // ── getSupportedLibraries ────────────────────────────────────

  describe('getSupportedLibraries()', () => {
    it('returns the list of supported libraries', () => {
      const { crawler } = makeCrawler();
      const libs = crawler.getSupportedLibraries();
      expect(libs).to.be.an('array');
      expect(libs.length).to.be.greaterThan(0);
    });

    it('includes react', () => {
      const { crawler } = makeCrawler();
      const names = crawler.getSupportedLibraries().map((l) => l.name);
      expect(names).to.include('react');
    });

    it('includes all 9 built-in libraries', () => {
      const { crawler } = makeCrawler();
      expect(crawler.getSupportedLibraries()).to.have.length(SUPPORTED_LIBRARIES.length);
    });

    it('includes nextjs, vue, express, fastify, prisma, drizzle, zod, typescript', () => {
      const { crawler } = makeCrawler();
      const names = crawler.getSupportedLibraries().map((l) => l.name);
      ['nextjs', 'vue', 'express', 'fastify', 'prisma', 'drizzle', 'zod', 'typescript'].forEach(
        (lib) => {
          expect(names).to.include(lib);
        }
      );
    });

    it('each library has a docsUrl and framework', () => {
      const { crawler } = makeCrawler();
      crawler.getSupportedLibraries().forEach((lib) => {
        expect(lib.docsUrl).to.be.a('string').and.to.include('http');
        expect(lib.framework).to.be.a('string');
      });
    });

    it('returns a copy (mutations do not affect registry)', () => {
      const { crawler } = makeCrawler();
      const libs = crawler.getSupportedLibraries();
      libs.push({ name: 'fake', docsUrl: 'http://fake.com', framework: 'generic' });
      expect(crawler.getSupportedLibraries()).to.have.length(SUPPORTED_LIBRARIES.length);
    });
  });

  // ── crawlLibrary ─────────────────────────────────────────────

  describe('crawlLibrary()', () => {
    it('throws CrawlerError for unknown library', async () => {
      const { crawler } = makeCrawler();
      try {
        await crawler.crawlLibrary('unknown-lib-xyz');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).to.be.instanceOf(CrawlerError);
      }
    });

    it('returns a CrawlResult for a known library', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      const result = await crawler.crawlLibrary('react');
      expect(result.library).to.equal('react');
      expect(result.pagesVisited).to.equal(1);
    });

    it('is case-insensitive for library name', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      const result = await crawler.crawlLibrary('REACT');
      expect(result.library).to.equal('react');
    });
  });

  // ── crawlUrl ─────────────────────────────────────────────────

  describe('crawlUrl()', () => {
    it('returns a CrawlResult with correct shape', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      const result = await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(result).to.have.keys([
        'library',
        'seedUrl',
        'pagesVisited',
        'chunksStored',
        'errors',
        'durationMs',
        'startedAt',
        'completedAt',
      ]);
    });

    it('sets library and seedUrl on result', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      const result = await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(result.library).to.equal('mylib');
      expect(result.seedUrl).to.equal('https://docs.example.com');
    });

    it('records durationMs', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      const result = await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(result.durationMs).to.be.a('number').and.greaterThanOrEqual(0);
    });

    it('records startedAt and completedAt as ISO strings', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      const result = await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(result.startedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.completedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('records a fetch error when HTTP fails', async () => {
      const http: HttpClient = {
        get: sinon.stub().rejects(new Error('ECONNREFUSED')),
      };
      const { writer } = makeBlob();
      const crawler = new DocCrawlerService(
        { enableLogging: false, rateLimitMs: 0, maxDepth: 0, respectRobotsTxt: false },
        http,
        writer
      );
      const result = await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(result.errors).to.have.length(1);
      expect(result.errors[0].reason).to.include('Failed to fetch');
    });

    it('records error when HTTP returns non-2xx status', async () => {
      const http: HttpClient = {
        get: sinon.stub().resolves({ status: 404, data: '', headers: {} }),
      };
      const { writer } = makeBlob();
      const crawler = new DocCrawlerService(
        { enableLogging: false, rateLimitMs: 0, maxDepth: 0, respectRobotsTxt: false },
        http,
        writer
      );
      const result = await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(result.errors).to.have.length(1);
      expect(result.errors[0].reason).to.include('404');
    });

    it('stores chunks in blob storage', async () => {
      const longContent = '<p>' + 'This is detailed documentation content. '.repeat(50) + '</p>';
      const html = `<html><head><title>T</title></head><body><main>${longContent}</main></body></html>`;
      const { crawler, blob } = makeCrawler(
        { 'https://docs.example.com': { status: 200, data: html, headers: {} } },
        { maxDepth: 0, maxPages: 1, respectRobotsTxt: false }
      );
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(blob.writes.length).to.be.greaterThan(0);
    });

    it('uses configured storage container', async () => {
      const longContent = '<p>' + 'Content '.repeat(200) + '</p>';
      const html = `<html><head><title>T</title></head><body><main>${longContent}</main></body></html>`;
      const { crawler, blob } = makeCrawler(
        { 'https://docs.example.com': { status: 200, data: html, headers: {} } },
        { maxDepth: 0, maxPages: 1, storageContainer: 'my-docs', respectRobotsTxt: false }
      );
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(blob.writes.every((w) => w.container === 'my-docs')).to.be.true;
    });
  });

  // ── fetchPage ────────────────────────────────────────────────

  describe('fetchPage()', () => {
    it('returns a CrawlPage with correct shape', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com/page': { status: 200, data: DOCUSAURUS_HTML, headers: {} },
      });
      const page = await crawler.fetchPage('https://docs.example.com/page', 0);
      expect(page).to.have.keys([
        'url',
        'depth',
        'text',
        'title',
        'description',
        'framework',
        'crawledAt',
      ]);
    });

    it('sets url and depth', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com/page': { status: 200, data: DOCUSAURUS_HTML, headers: {} },
      });
      const page = await crawler.fetchPage('https://docs.example.com/page', 2);
      expect(page.url).to.equal('https://docs.example.com/page');
      expect(page.depth).to.equal(2);
    });

    it('extracts title from <title> tag', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com': { status: 200, data: DOCUSAURUS_HTML, headers: {} },
      });
      const page = await crawler.fetchPage('https://docs.example.com', 0);
      expect(page.title).to.equal('React Docs');
    });

    it('sets crawledAt as a recent timestamp', async () => {
      const before = Date.now();
      const { crawler } = makeCrawler({
        'https://docs.example.com': { status: 200, data: DOCUSAURUS_HTML, headers: {} },
      });
      const page = await crawler.fetchPage('https://docs.example.com', 0);
      expect(page.crawledAt).to.be.at.least(before);
    });

    it('throws CrawlerError on network failure', async () => {
      const http: HttpClient = { get: sinon.stub().rejects(new Error('network error')) };
      const { writer } = makeBlob();
      const crawler = new DocCrawlerService({ enableLogging: false }, http, writer);
      try {
        await crawler.fetchPage('https://docs.example.com', 0);
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(CrawlerError);
      }
    });

    it('throws CrawlerError on HTTP 404', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com': { status: 404, data: '', headers: {} },
      });
      try {
        await crawler.fetchPage('https://docs.example.com', 0);
        expect.fail();
      } catch (e) {
        expect(e).to.be.instanceOf(CrawlerError);
      }
    });
  });

  // ── detectFramework ──────────────────────────────────────────

  describe('detectFramework()', () => {
    const { crawler } = makeCrawler();
    const cheerio = require('cheerio');

    it('detects docusaurus from generator meta tag', () => {
      const $ = cheerio.load(DOCUSAURUS_HTML);
      expect(crawler.detectFramework($, 'https://react.dev')).to.equal('docusaurus');
    });

    it('detects sphinx from body class', () => {
      const $ = cheerio.load(SPHINX_HTML);
      expect(crawler.detectFramework($, 'https://docs.python.org')).to.equal('sphinx');
    });

    it('detects mkdocs from generator meta tag', () => {
      const $ = cheerio.load(MKDOCS_HTML);
      expect(crawler.detectFramework($, 'https://example.com/docs')).to.equal('mkdocs');
    });

    it('detects vitepress from VPDoc class', () => {
      const $ = cheerio.load(VITEPRESS_HTML);
      expect(crawler.detectFramework($, 'https://vuejs.org')).to.equal('vitepress');
    });

    it('falls back to generic for unknown HTML', () => {
      const $ = cheerio.load('<html><body><p>Plain page</p></body></html>');
      expect(crawler.detectFramework($, 'https://example.com')).to.equal('generic');
    });
  });

  // ── extractContent ───────────────────────────────────────────

  describe('extractContent()', () => {
    const { crawler } = makeCrawler();
    const cheerio = require('cheerio');

    it('extracts title from <title>', () => {
      const $ = cheerio.load(DOCUSAURUS_HTML);
      const { title } = crawler.extractContent($, 'docusaurus');
      expect(title).to.equal('React Docs');
    });

    it('extracts text from main content area', () => {
      const $ = cheerio.load(DOCUSAURUS_HTML);
      const { text } = crawler.extractContent($, 'docusaurus');
      expect(text).to.include('React');
    });

    it('removes nav elements from content', () => {
      const $ = cheerio.load(DOCUSAURUS_HTML);
      const { text } = crawler.extractContent($, 'docusaurus');
      expect(text.toLowerCase()).to.not.include('navbar__brand');
    });

    it('extracts description from meta tag', () => {
      const html =
        '<html><head><meta name="description" content="The best docs"/></head><body><main><p>Content</p></main></body></html>';
      const $ = cheerio.load(html);
      const { description } = crawler.extractContent($, 'generic');
      expect(description).to.equal('The best docs');
    });

    it('returns empty description when no meta tag', () => {
      const $ = cheerio.load(DOCUSAURUS_HTML);
      const { description } = crawler.extractContent($, 'docusaurus');
      expect(description).to.equal('');
    });

    it('extracts sphinx content from .body selector', () => {
      const $ = cheerio.load(SPHINX_HTML);
      const { text } = crawler.extractContent($, 'sphinx');
      expect(text).to.include('Module Reference');
    });

    it('extracts mkdocs content from .md-content', () => {
      const $ = cheerio.load(MKDOCS_HTML);
      const { text } = crawler.extractContent($, 'mkdocs');
      expect(text).to.include('Getting Started');
    });

    it('extracts vitepress content from .VPDoc', () => {
      const $ = cheerio.load(VITEPRESS_HTML);
      const { text } = crawler.extractContent($, 'vitepress');
      expect(text).to.include('Guide');
    });

    it('removes script and style tags', () => {
      const html =
        '<html><body><main><script>alert(1)</script><style>.a{}</style><p>Real content</p></main></body></html>';
      const $ = cheerio.load(html);
      const { text } = crawler.extractContent($, 'generic');
      expect(text).to.not.include('alert');
      expect(text).to.not.include('.a{}');
      expect(text).to.include('Real content');
    });
  });

  // ── extractLinks ─────────────────────────────────────────────

  describe('extractLinks()', () => {
    const { crawler } = makeCrawler();
    const seed = 'https://docs.example.com';
    const current = 'https://docs.example.com/page';

    it('extracts same-origin links', () => {
      const links = crawler.extractLinks(WITH_LINKS_HTML, current, seed);
      expect(links).to.include('https://docs.example.com/docs/getting-started');
      expect(links).to.include('https://docs.example.com/docs/api-reference');
    });

    it('excludes external links', () => {
      const links = crawler.extractLinks(WITH_LINKS_HTML, current, seed);
      expect(links).to.not.include('https://external.com/page');
    });

    it('excludes anchor-only links', () => {
      const links = crawler.extractLinks(WITH_LINKS_HTML, current, seed);
      expect(links.some((l) => l.includes('#anchor'))).to.be.false;
    });

    it('excludes image and asset links', () => {
      const links = crawler.extractLinks(WITH_LINKS_HTML, current, seed);
      expect(links.some((l) => l.endsWith('.png'))).to.be.false;
    });

    it('strips fragment from extracted links', () => {
      const html = '<a href="/docs/page#section">Link</a>';
      const links = crawler.extractLinks(html, current, seed);
      expect(links[0]).to.equal('https://docs.example.com/docs/page');
    });

    it('deduplicates links', () => {
      const html = '<a href="/docs/page">A</a><a href="/docs/page">B</a>';
      const links = crawler.extractLinks(html, current, seed);
      expect(links.filter((l) => l === 'https://docs.example.com/docs/page')).to.have.length(1);
    });

    it('returns empty array for empty HTML', () => {
      expect(crawler.extractLinks('', current, seed)).to.deep.equal([]);
    });
  });

  // ── chunkText ────────────────────────────────────────────────

  describe('chunkText()', () => {
    const { crawler } = makeCrawler();
    const opts = { targetTokens: 100, minTokens: 20, maxTokens: 150 };

    it('returns empty array for empty text', () => {
      expect(crawler.chunkText('', opts)).to.deep.equal([]);
    });

    it('returns empty array for whitespace-only text', () => {
      expect(crawler.chunkText('   \n\n   ', opts)).to.deep.equal([]);
    });

    it('returns a single chunk for short text', () => {
      const text = 'Short documentation paragraph.';
      const chunks = crawler.chunkText(text, { targetTokens: 100, minTokens: 1, maxTokens: 200 });
      expect(chunks).to.have.length(1);
      expect(chunks[0]).to.equal(text);
    });

    it('splits long text into multiple chunks', () => {
      const para = 'This is a paragraph with enough words to fill up the token budget. ';
      const text = Array(20).fill(para).join('\n\n');
      const chunks = crawler.chunkText(text, opts);
      expect(chunks.length).to.be.greaterThan(1);
    });

    it('discards chunks below minTokens', () => {
      const text =
        'Hi.\n\n' +
        'This is a much longer paragraph that should survive the minimum token filter because it has enough content.';
      const chunks = crawler.chunkText(text, { targetTokens: 100, minTokens: 10, maxTokens: 200 });
      chunks.forEach((c) => {
        expect(c.length).to.be.greaterThan(10 * 4); // minTokens * CHARS_PER_TOKEN
      });
    });

    it('no chunk exceeds maxTokens * 4 chars', () => {
      const para = 'word '.repeat(100);
      const text = Array(10).fill(para).join('\n\n');
      const chunks = crawler.chunkText(text, opts);
      chunks.forEach((c) => {
        expect(c.length).to.be.at.most(opts.maxTokens * 4 + 50); // small tolerance for paragraph boundary
      });
    });

    it('preserves paragraph content across chunks', () => {
      const paras = [
        'First paragraph content here.',
        'Second paragraph content here.',
        'Third paragraph content here.',
      ];
      const text = paras.join('\n\n');
      const chunks = crawler.chunkText(text, { targetTokens: 10, minTokens: 1, maxTokens: 50 });
      const combined = chunks.join(' ');
      paras.forEach((p) => expect(combined).to.include(p.split(' ')[0]));
    });
  });

  // ── chunkPage ────────────────────────────────────────────────

  describe('chunkPage()', () => {
    const { crawler } = makeCrawler();

    it('returns ContentChunk array', () => {
      const page = {
        url: 'https://docs.example.com/guide',
        depth: 0,
        text: 'This is sufficient content for a chunk. '.repeat(30),
        title: 'Guide',
        framework: 'generic' as const,
        crawledAt: Date.now(),
      };
      const chunks = crawler.chunkPage(page, 'mylib');
      expect(chunks).to.be.an('array');
      expect(chunks.length).to.be.greaterThan(0);
    });

    it('each chunk has required fields', () => {
      const page = {
        url: 'https://docs.example.com/guide',
        depth: 0,
        text: 'Content paragraph. '.repeat(50),
        title: 'Guide',
        framework: 'generic' as const,
        crawledAt: Date.now(),
      };
      const chunks = crawler.chunkPage(page, 'mylib');
      chunks.forEach((c) => {
        expect(c).to.have.keys(['index', 'sourceUrl', 'library', 'text', 'tokenCount', 'blobKey']);
      });
    });

    it('sets sourceUrl from page.url', () => {
      const page = {
        url: 'https://docs.example.com/guide',
        depth: 0,
        text: 'Content paragraph. '.repeat(50),
        title: 'Guide',
        framework: 'generic' as const,
        crawledAt: Date.now(),
      };
      const chunks = crawler.chunkPage(page, 'mylib');
      chunks.forEach((c) => expect(c.sourceUrl).to.equal(page.url));
    });

    it('blobKey includes library name and zero-padded index', () => {
      const page = {
        url: 'https://docs.example.com/guide',
        depth: 0,
        text: 'Content. '.repeat(100),
        title: 'Guide',
        framework: 'generic' as const,
        crawledAt: Date.now(),
      };
      const chunks = crawler.chunkPage(page, 'mylib');
      expect(chunks[0].blobKey).to.include('mylib');
      expect(chunks[0].blobKey).to.include('0000');
    });

    it('indexes are sequential starting from 0', () => {
      const page = {
        url: 'https://docs.example.com/guide',
        depth: 0,
        text: 'Content paragraph with enough words. '.repeat(100),
        title: 'Guide',
        framework: 'generic' as const,
        crawledAt: Date.now(),
      };
      const chunks = crawler.chunkPage(page, 'mylib');
      chunks.forEach((c, i) => expect(c.index).to.equal(i));
    });

    it('tokenCount is a positive integer', () => {
      const page = {
        url: 'https://docs.example.com/guide',
        depth: 0,
        text: 'Content paragraph. '.repeat(50),
        title: 'Guide',
        framework: 'generic' as const,
        crawledAt: Date.now(),
      };
      const chunks = crawler.chunkPage(page, 'mylib');
      chunks.forEach((c) => expect(c.tokenCount).to.be.greaterThan(0));
    });
  });

  // ── robots.txt ───────────────────────────────────────────────

  describe('parseRobotsTxt()', () => {
    const { crawler } = makeCrawler();

    it('returns empty array for empty content', () => {
      expect(crawler.parseRobotsTxt('')).to.deep.equal([]);
    });

    it('parses disallow rules for * user-agent', () => {
      const txt = 'User-agent: *\nDisallow: /private\nDisallow: /admin';
      expect(crawler.parseRobotsTxt(txt)).to.include('/private');
      expect(crawler.parseRobotsTxt(txt)).to.include('/admin');
    });

    it('ignores allow rules for other user-agents', () => {
      const txt =
        'User-agent: Googlebot\nDisallow: /secret\n\nUser-agent: *\nDisallow: /public-deny';
      const rules = crawler.parseRobotsTxt(txt);
      expect(rules).to.include('/public-deny');
      expect(rules).to.not.include('/secret');
    });

    it('skips comment lines', () => {
      const txt = '# robots.txt\nUser-agent: *\n# Allow all\nDisallow: /blocked';
      expect(crawler.parseRobotsTxt(txt)).to.deep.equal(['/blocked']);
    });

    it('handles Disallow: / (block everything)', () => {
      const txt = 'User-agent: *\nDisallow: /';
      expect(crawler.parseRobotsTxt(txt)).to.include('/');
    });

    it('returns empty array when no disallow rules', () => {
      const txt = 'User-agent: *\nAllow: /';
      expect(crawler.parseRobotsTxt(txt)).to.deep.equal([]);
    });
  });

  describe('isBlockedByRobots()', () => {
    it('returns false when robots.txt allows all', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com/robots.txt': {
          status: 200,
          data: 'User-agent: *\nAllow: /',
          headers: {},
        },
      });
      const blocked = await crawler.isBlockedByRobots('https://docs.example.com/guide');
      expect(blocked).to.be.false;
    });

    it('returns true when path matches disallow rule', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com/robots.txt': {
          status: 200,
          data: 'User-agent: *\nDisallow: /private',
          headers: {},
        },
      });
      const blocked = await crawler.isBlockedByRobots('https://docs.example.com/private/page');
      expect(blocked).to.be.true;
    });

    it('returns false when path does not match disallow rule', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com/robots.txt': {
          status: 200,
          data: 'User-agent: *\nDisallow: /private',
          headers: {},
        },
      });
      const blocked = await crawler.isBlockedByRobots('https://docs.example.com/guide');
      expect(blocked).to.be.false;
    });

    it('returns false when robots.txt returns 404', async () => {
      const { crawler } = makeCrawler({
        'https://docs.example.com/robots.txt': { status: 404, data: '', headers: {} },
      });
      const blocked = await crawler.isBlockedByRobots('https://docs.example.com/anything');
      expect(blocked).to.be.false;
    });
  });

  // ── URL Utilities ────────────────────────────────────────────

  describe('getOrigin()', () => {
    const { crawler } = makeCrawler();

    it('returns protocol + host', () => {
      expect(crawler.getOrigin('https://docs.example.com/guide')).to.equal(
        'https://docs.example.com'
      );
    });

    it('returns empty string for invalid URL', () => {
      expect(crawler.getOrigin('not-a-url')).to.equal('');
    });
  });

  describe('getPath()', () => {
    const { crawler } = makeCrawler();

    it('returns pathname', () => {
      expect(crawler.getPath('https://docs.example.com/guide/intro')).to.equal('/guide/intro');
    });

    it('returns empty string for invalid URL', () => {
      expect(crawler.getPath('not-a-url')).to.equal('');
    });
  });

  describe('resolveUrl()', () => {
    const { crawler } = makeCrawler();

    it('resolves relative href against base', () => {
      expect(crawler.resolveUrl('/docs/page', 'https://example.com/guide')).to.equal(
        'https://example.com/docs/page'
      );
    });

    it('returns absolute href unchanged', () => {
      expect(crawler.resolveUrl('https://other.com/page', 'https://example.com')).to.equal(
        'https://other.com/page'
      );
    });

    it('returns null for invalid href', () => {
      expect(crawler.resolveUrl('http://[invalid-ipv6', 'https://example.com')).to.be.null;
    });
  });

  describe('urlToSlug()', () => {
    const { crawler } = makeCrawler();

    it('converts URL path to slug', () => {
      expect(crawler.urlToSlug('https://docs.example.com/guide/getting-started')).to.equal(
        'guide-getting-started'
      );
    });

    it('returns "index" for root URL', () => {
      expect(crawler.urlToSlug('https://docs.example.com/')).to.equal('index');
    });

    it('truncates to 120 characters', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(200);
      expect(crawler.urlToSlug(longUrl).length).to.be.at.most(120);
    });

    it('lowercases the result', () => {
      expect(crawler.urlToSlug('https://example.com/MyPage')).to.equal(
        crawler.urlToSlug('https://example.com/MyPage').toLowerCase()
      );
    });
  });

  describe('estimateTokens()', () => {
    const { crawler } = makeCrawler();

    it('estimates ~1 token per 4 chars', () => {
      expect(crawler.estimateTokens('abcd')).to.equal(1);
      expect(crawler.estimateTokens('a'.repeat(400))).to.equal(100);
    });

    it('returns 0 for empty string', () => {
      expect(crawler.estimateTokens('')).to.equal(0);
    });
  });

  // ── Caching ──────────────────────────────────────────────────

  describe('caching', () => {
    it('caches crawl result after first crawl', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(crawler.getCacheSize()).to.equal(1);
    });

    it('returns cached result on second crawl without re-fetching', async () => {
      const http = makeHttp();
      const { writer } = makeBlob();
      const crawler = new DocCrawlerService(
        { enableLogging: false, rateLimitMs: 0, maxDepth: 0, maxPages: 1 },
        http,
        writer
      );
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      const firstCallCount = (http.get as SinonStub).callCount;
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect((http.get as SinonStub).callCount).to.equal(firstCallCount);
    });

    it('does not cache when enableCache is false', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1, enableCache: false });
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(crawler.getCacheSize()).to.equal(0);
    });

    it('clearCache() removes all entries', async () => {
      const { crawler } = makeCrawler({}, { maxDepth: 0, maxPages: 1 });
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(crawler.getCacheSize()).to.equal(1);
      crawler.clearCache();
      expect(crawler.getCacheSize()).to.equal(0);
    });

    it('clearCache(library) removes only that library', async () => {
      const http = makeHttp();
      const { writer } = makeBlob();
      const crawler = new DocCrawlerService(
        { enableLogging: false, rateLimitMs: 0, maxDepth: 0, maxPages: 1 },
        http,
        writer
      );
      await crawler.crawlUrl('https://docs.example.com', 'lib1');
      await crawler.crawlUrl('https://docs.other.com', 'lib2');
      expect(crawler.getCacheSize()).to.equal(2);
      crawler.clearCache('lib1');
      expect(crawler.getCacheSize()).to.equal(1);
    });

    it('cache expires after TTL', async () => {
      let callCount = 0;
      const http: HttpClient = {
        get: sinon.stub().callsFake(async (url: string) => {
          callCount++;
          if (url.endsWith('/robots.txt')) return { status: 404, data: '', headers: {} };
          return {
            status: 200,
            data: '<html><head><title>T</title></head><body><main><p>content</p></main></body></html>',
            headers: {},
          };
        }),
      };
      const { writer } = makeBlob();
      const crawler = new DocCrawlerService(
        { enableLogging: false, rateLimitMs: 0, maxDepth: 0, maxPages: 1, cacheTtlMs: -1 },
        http,
        writer
      );
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      const firstCount = callCount;
      await crawler.crawlUrl('https://docs.example.com', 'mylib');
      expect(callCount).to.be.greaterThan(firstCount);
    });
  });
});
