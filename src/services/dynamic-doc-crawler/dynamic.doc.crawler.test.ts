import { expect } from 'chai';
import * as sinon from 'sinon';
import { DynamicDocCrawlerService } from './dynamic.doc.crawler.service';
import {
  DynamicDocCrawlerError,
  DEFAULT_CONFIG,
  HttpFetchAdapter,
  PdfParseAdapter,
  BlobStorageAdapter,
  CrawlInput,
} from './dynamic.doc.crawler.types';

const SIMPLE_HTML = `
<html>
<head><title>Test Page</title><style>body{color:red;margin:0}</style></head>
<body>
  <script>console.log("hi");</script>
  <h1>Hello World</h1>
  <p>${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}</p>
  <p>${Array.from({ length: 40 }, (_, i) => `content${i}`).join(' ')}</p>
  <p>${Array.from({ length: 40 }, (_, i) => `text${i}`).join(' ')}</p>
  <p>This is a paragraph with some useful content about TypeScript and testing frameworks.</p>
  <p>Another paragraph with more words to ensure sufficient token count for chunking.</p>
</body>
</html>
`;

const SIMPLE_TEXT =
  'Hello World This is a paragraph with some useful content about TypeScript and testing. Another paragraph with more words to fill out the content.';

const LONG_TEXT = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');

const makePdfBuffer = () => Buffer.from('fake-pdf-bytes');

function makeAdapters(
  overrides: {
    fetchResult?: string | Error;
    pdfResult?: string | Error;
    blobUpload?: Error | null;
  } = {}
) {
  const httpAdapter: HttpFetchAdapter = {
    fetch: sinon.stub().callsFake(async () => {
      if (overrides.fetchResult instanceof Error) throw overrides.fetchResult;
      return overrides.fetchResult ?? SIMPLE_HTML;
    }),
  };
  const pdfAdapter: PdfParseAdapter = {
    parse: sinon.stub().callsFake(async () => {
      if (overrides.pdfResult instanceof Error) throw overrides.pdfResult;
      return (
        overrides.pdfResult ?? 'Extracted PDF text with enough content to form at least one chunk.'
      );
    }),
  };
  const blobAdapter: BlobStorageAdapter = {
    upload: sinon.stub().callsFake(async () => {
      if (overrides.blobUpload instanceof Error) throw overrides.blobUpload;
    }),
  };
  return { httpAdapter, pdfAdapter, blobAdapter };
}

describe('DynamicDocCrawlerService — constructor', () => {
  it('creates an instance', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({}, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('accepts custom targetChunkTokens', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ targetChunkTokens: 200 }, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('accepts custom minChunkTokens', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ minChunkTokens: 10 }, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('accepts custom chunkOverlapTokens', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ chunkOverlapTokens: 20 }, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('accepts custom blobContainer', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ blobContainer: 'my-docs' }, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('accepts custom fetchTimeoutMs', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ fetchTimeoutMs: 5000 }, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('accepts enableLogging: false', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });

  it('works without blobAdapter (blobAdapter is optional)', () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({}, httpAdapter, pdfAdapter);
    expect(svc).to.be.instanceOf(DynamicDocCrawlerService);
  });
});

describe('DynamicDocCrawlerService — crawl() input validation', () => {
  let svc: DynamicDocCrawlerService;
  beforeEach(() => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
  });

  it('throws INVALID_INPUT for null input', async () => {
    try {
      await svc.crawl(null as unknown as CrawlInput);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for unknown type', async () => {
    try {
      await svc.crawl({ type: 'unknown' } as unknown as CrawlInput);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for url type with empty url', async () => {
    try {
      await svc.crawl({ type: 'url', url: '' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for url without http/https scheme', async () => {
    try {
      await svc.crawl({ type: 'url', url: 'ftp://example.com' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('accepts http:// url', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const s = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await s.crawl({ type: 'url', url: 'http://example.com' });
    expect(result.sourceType).to.equal('url');
  });

  it('accepts https:// url', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const s = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await s.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.sourceType).to.equal('url');
  });

  it('throws INVALID_INPUT for pdf type with empty buffer', async () => {
    try {
      await svc.crawl({ type: 'pdf', buffer: Buffer.alloc(0), filename: 'doc.pdf' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for pdf type with empty filename', async () => {
    try {
      await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: '' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for pdf type with non-buffer', async () => {
    try {
      await svc.crawl({
        type: 'pdf',
        buffer: 'not-a-buffer' as unknown as Buffer,
        filename: 'f.pdf',
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('INVALID_INPUT');
    }
  });
});

describe('DynamicDocCrawlerService — crawl() URL path (AC-1, AC-2)', () => {
  it('calls httpAdapter.fetch with the provided URL (AC-1)', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    await svc.crawl({ type: 'url', url: 'https://example.com/docs' });
    expect((httpAdapter.fetch as sinon.SinonStub).calledOnce).to.be.true;
    expect((httpAdapter.fetch as sinon.SinonStub).firstCall.args[0]).to.equal(
      'https://example.com/docs'
    );
  });

  it('passes fetchTimeoutMs to httpAdapter.fetch', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, fetchTimeoutMs: 7000 },
      httpAdapter,
      pdfAdapter
    );
    await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect((httpAdapter.fetch as sinon.SinonStub).firstCall.args[1]).to.equal(7000);
  });

  it('sets sourceType to url on result', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.sourceType).to.equal('url');
  });

  it('sets sourceRef to the URL', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com/page' });
    expect(result.sourceRef).to.equal('https://example.com/page');
  });

  it('strips HTML tags from fetched content (AC-2)', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    for (const chunk of result.chunks) {
      expect(chunk.content).to.not.include('<html>');
      expect(chunk.content).to.not.include('<script>');
      expect(chunk.content).to.not.include('<style>');
    }
  });

  it('strips script tag contents from fetched HTML', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    const allContent = result.chunks.map((c) => c.content).join(' ');
    expect(allContent).to.not.include('console.log');
  });

  it('throws FETCH_FAILED when httpAdapter.fetch throws', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: new Error('network error') });
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    try {
      await svc.crawl({ type: 'url', url: 'https://example.com' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('FETCH_FAILED');
    }
  });

  it('throws NO_CONTENT when fetched HTML contains no text', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: '<html><body></body></html>' });
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    try {
      await svc.crawl({ type: 'url', url: 'https://example.com' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('NO_CONTENT');
    }
  });

  it('does not call pdfAdapter when crawling a URL', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect((pdfAdapter.parse as sinon.SinonStub).called).to.be.false;
  });
});

describe('DynamicDocCrawlerService — crawl() PDF path (AC-3, AC-4)', () => {
  it('calls pdfAdapter.parse with the provided buffer (AC-3, AC-4)', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const buf = makePdfBuffer();
    await svc.crawl({ type: 'pdf', buffer: buf, filename: 'report.pdf' });
    expect((pdfAdapter.parse as sinon.SinonStub).calledOnce).to.be.true;
    expect((pdfAdapter.parse as sinon.SinonStub).firstCall.args[0]).to.equal(buf);
  });

  it('sets sourceType to pdf on result', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: 'doc.pdf' });
    expect(result.sourceType).to.equal('pdf');
  });

  it('sets sourceRef to the filename', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({
      type: 'pdf',
      buffer: makePdfBuffer(),
      filename: 'my-doc.pdf',
    });
    expect(result.sourceRef).to.equal('my-doc.pdf');
  });

  it('throws PDF_PARSE_FAILED when pdfAdapter throws', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ pdfResult: new Error('corrupt pdf') });
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    try {
      await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: 'bad.pdf' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('PDF_PARSE_FAILED');
    }
  });

  it('throws NO_CONTENT when PDF parse returns empty string', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ pdfResult: '' });
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    try {
      await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: 'empty.pdf' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('NO_CONTENT');
    }
  });

  it('throws NO_CONTENT when PDF parse returns whitespace only', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ pdfResult: '   \n   ' });
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    try {
      await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: 'blank.pdf' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as DynamicDocCrawlerError).code).to.equal('NO_CONTENT');
    }
  });

  it('does not call httpAdapter when parsing a PDF', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: 'doc.pdf' });
    expect((httpAdapter.fetch as sinon.SinonStub).called).to.be.false;
  });
});

describe('DynamicDocCrawlerService — crawl() chunking (AC-5)', () => {
  it('returns at least one chunk for non-empty content', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.chunks.length).to.be.greaterThan(0);
  });

  it('splits long content into multiple chunks', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.chunks.length).to.be.greaterThan(1);
  });

  it('each chunk has non-empty content', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    for (const chunk of result.chunks) {
      expect(chunk.content.length).to.be.greaterThan(0);
    }
  });

  it('respects custom targetChunkTokens', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 25, chunkOverlapTokens: 0, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    const svcLarge = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 200, chunkOverlapTokens: 0, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    const resultLarge = await svcLarge.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.chunks.length).to.be.greaterThan(resultLarge.chunks.length);
  });

  it('chunks have tokenCount > 0', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    for (const chunk of result.chunks) {
      expect(chunk.tokenCount).to.be.greaterThan(0);
    }
  });

  it('chunks have tokenCount at or above minChunkTokens', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const minChunkTokens = 10;
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens },
      httpAdapter,
      pdfAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    for (const chunk of result.chunks) {
      expect(chunk.tokenCount).to.be.greaterThanOrEqual(minChunkTokens);
    }
  });

  it('all words from source text appear in some chunk', async () => {
    const shortText = 'alpha beta gamma delta epsilon zeta eta theta';
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: shortText });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 10, chunkOverlapTokens: 2, minChunkTokens: 1 },
      httpAdapter,
      pdfAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    const allContent = result.chunks.map((c) => c.content).join(' ');
    for (const word of shortText.split(' ')) {
      expect(allContent).to.include(word);
    }
  });
});

describe('DynamicDocCrawlerService — crawl() result shape (AC-7)', () => {
  async function getResult() {
    const { httpAdapter, pdfAdapter, blobAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter,
      blobAdapter
    );
    return svc.crawl({ type: 'url', url: 'https://example.com' });
  }

  it('result has all required keys', async () => {
    const result = await getResult();
    expect(result).to.have.keys([
      'sessionId',
      'chunks',
      'sourceRef',
      'sourceType',
      'chunkCount',
      'totalTokens',
      'durationMs',
      'crawledAt',
      'blobSkipped',
    ]);
  });

  it('sessionId is a non-empty UUID-like string', async () => {
    const result = await getResult();
    expect(result.sessionId).to.be.a('string');
    expect(result.sessionId.length).to.be.greaterThan(0);
    expect(result.sessionId).to.match(/^[0-9a-f-]{36}$/);
  });

  it('chunkCount matches chunks.length', async () => {
    const result = await getResult();
    expect(result.chunkCount).to.equal(result.chunks.length);
  });

  it('totalTokens equals sum of chunk tokenCounts', async () => {
    const result = await getResult();
    const sum = result.chunks.reduce((acc, c) => acc + c.tokenCount, 0);
    expect(result.totalTokens).to.equal(sum);
  });

  it('durationMs >= 0', async () => {
    const result = await getResult();
    expect(result.durationMs).to.be.greaterThanOrEqual(0);
  });

  it('crawledAt is an ISO string', async () => {
    const result = await getResult();
    expect(result.crawledAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('blobSkipped is false when blobAdapter is present and succeeds', async () => {
    const result = await getResult();
    expect(result.blobSkipped).to.be.false;
  });

  it('blobSkipped is true when no blobAdapter provided', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.blobSkipped).to.be.true;
  });
});

describe('DynamicDocCrawlerService — DynamicDocChunk shape', () => {
  async function getChunk() {
    const { httpAdapter, pdfAdapter, blobAdapter } = makeAdapters();
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false },
      httpAdapter,
      pdfAdapter,
      blobAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    return { result, chunk: result.chunks[0] };
  }

  it('chunk has all required keys', async () => {
    const { chunk } = await getChunk();
    expect(chunk).to.have.keys([
      'id',
      'blobKey',
      'content',
      'sourceRef',
      'sourceType',
      'chunkIndex',
      'tokenCount',
      'sessionId',
      'storedAt',
    ]);
  });

  it('chunk id is sessionId-chunkIndex format', async () => {
    const { result, chunk } = await getChunk();
    expect(chunk.id).to.equal(`${result.sessionId}-0`);
  });

  it('chunk sessionId matches result sessionId', async () => {
    const { result, chunk } = await getChunk();
    expect(chunk.sessionId).to.equal(result.sessionId);
  });

  it('chunk chunkIndex is 0 for first chunk', async () => {
    const { chunk } = await getChunk();
    expect(chunk.chunkIndex).to.equal(0);
  });

  it('chunkIndex increments for subsequent chunks', async () => {
    const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    result.chunks.forEach((chunk, i) => {
      expect(chunk.chunkIndex).to.equal(i);
    });
  });

  it('chunk sourceRef matches URL', async () => {
    const { chunk } = await getChunk();
    expect(chunk.sourceRef).to.equal('https://example.com');
  });

  it('chunk sourceType is url for URL input', async () => {
    const { chunk } = await getChunk();
    expect(chunk.sourceType).to.equal('url');
  });

  it('chunk sourceType is pdf for PDF input', async () => {
    const { httpAdapter, pdfAdapter, blobAdapter } = makeAdapters({
      pdfResult: LONG_TEXT,
    });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter,
      blobAdapter
    );
    const result = await svc.crawl({ type: 'pdf', buffer: makePdfBuffer(), filename: 'doc.pdf' });
    expect(result.chunks[0].sourceType).to.equal('pdf');
  });

  it('chunk storedAt is an ISO string', async () => {
    const { chunk } = await getChunk();
    expect(chunk.storedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('chunk tokenCount matches estimated tokens for content', async () => {
    const { chunk } = await getChunk();
    const expected = Math.ceil(chunk.content.length / 4);
    expect(chunk.tokenCount).to.equal(expected);
  });
});

describe('DynamicDocCrawlerService — blob key format', () => {
  const { httpAdapter, pdfAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
  const svc = new DynamicDocCrawlerService(
    { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
    httpAdapter,
    pdfAdapter
  );

  it('blobKey follows dynamic/{sessionId}/{index:04}.json pattern', async () => {
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    const chunk = result.chunks[0];
    expect(chunk.blobKey).to.match(/^dynamic\/[0-9a-f-]{36}\/\d{4}\.json$/);
  });

  it('blobKey starts with dynamic/', async () => {
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.chunks[0].blobKey.startsWith('dynamic/')).to.be.true;
  });

  it('blobKey index is zero-padded to 4 digits', () => {
    const key = svc.buildBlobKey('test-session-id', 3);
    const parts = key.split('/');
    expect(parts[2]).to.equal('0003.json');
  });

  it('blobKey index 1000 is not zero-padded (5 digits)', () => {
    const key = svc.buildBlobKey('test-session-id', 1000);
    const parts = key.split('/');
    expect(parts[2]).to.equal('1000.json');
  });

  it('buildBlobKey is deterministic', () => {
    const k1 = svc.buildBlobKey('abc', 7);
    const k2 = svc.buildBlobKey('abc', 7);
    expect(k1).to.equal(k2);
  });

  it('different sessions produce different blobKeys', () => {
    const k1 = svc.buildBlobKey('session-1', 0);
    const k2 = svc.buildBlobKey('session-2', 0);
    expect(k1).to.not.equal(k2);
  });

  it('all chunks have unique blobKeys within a session', async () => {
    const { httpAdapter: h, pdfAdapter: p } = makeAdapters({ fetchResult: LONG_TEXT });
    const s = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      h,
      p
    );
    const result = await s.crawl({ type: 'url', url: 'https://example.com' });
    const keys = result.chunks.map((c) => c.blobKey);
    const unique = new Set(keys);
    expect(unique.size).to.equal(keys.length);
  });
});

describe('DynamicDocCrawlerService — blob storage (AC-6)', () => {
  function makeBlobSvc(overrides: Parameters<typeof makeAdapters>[0] = {}, cfg = {}) {
    const { httpAdapter, pdfAdapter, blobAdapter } = makeAdapters({
      fetchResult: LONG_TEXT,
      ...overrides,
    });
    const svc = new DynamicDocCrawlerService(
      {
        enableLogging: false,
        targetChunkTokens: 50,
        chunkOverlapTokens: 5,
        minChunkTokens: 5,
        ...cfg,
      },
      httpAdapter,
      pdfAdapter,
      blobAdapter
    );
    return { svc, blobAdapter };
  }

  it('calls blobAdapter.upload once per chunk', async () => {
    const { svc, blobAdapter } = makeBlobSvc();
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect((blobAdapter.upload as sinon.SinonStub).callCount).to.equal(result.chunkCount);
  });

  it('uploads to the configured blobContainer', async () => {
    const { httpAdapter, pdfAdapter, blobAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      {
        enableLogging: false,
        blobContainer: 'my-container',
        targetChunkTokens: 50,
        chunkOverlapTokens: 5,
        minChunkTokens: 5,
      },
      httpAdapter,
      pdfAdapter,
      blobAdapter
    );
    await svc.crawl({ type: 'url', url: 'https://example.com' });
    const call = (blobAdapter.upload as sinon.SinonStub).firstCall;
    expect(call.args[2]).to.equal('my-container');
  });

  it('uploads chunk JSON string to blobKey', async () => {
    const { svc, blobAdapter } = makeBlobSvc();
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    const firstCall = (blobAdapter.upload as sinon.SinonStub).firstCall;
    expect(firstCall.args[0]).to.equal(result.chunks[0].blobKey);
    const parsed = JSON.parse(firstCall.args[1]);
    expect(parsed.id).to.equal(result.chunks[0].id);
  });

  it('sets blobSkipped: false when all uploads succeed', async () => {
    const { svc } = makeBlobSvc();
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.blobSkipped).to.be.false;
  });

  it('does not throw when blobAdapter.upload fails (non-fatal)', async () => {
    const { svc } = makeBlobSvc({ blobUpload: new Error('storage unavailable') });
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.blobSkipped).to.be.true;
  });

  it('still returns chunks even when blob upload fails', async () => {
    const { svc } = makeBlobSvc({ blobUpload: new Error('storage unavailable') });
    const result = await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect(result.chunks.length).to.be.greaterThan(0);
  });

  it('uses default container name dynamic-docs when not configured', async () => {
    const { svc, blobAdapter } = makeBlobSvc({}, {});
    await svc.crawl({ type: 'url', url: 'https://example.com' });
    const call = (blobAdapter.upload as sinon.SinonStub).firstCall;
    expect(call.args[2]).to.equal('dynamic-docs');
  });

  it('does not call blobAdapter when not provided', async () => {
    const { httpAdapter, pdfAdapter, blobAdapter } = makeAdapters({ fetchResult: LONG_TEXT });
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 50, chunkOverlapTokens: 5, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    await svc.crawl({ type: 'url', url: 'https://example.com' });
    expect((blobAdapter.upload as sinon.SinonStub).called).to.be.false;
  });
});

describe('DynamicDocCrawlerService — _stripHtml()', () => {
  const { httpAdapter, pdfAdapter } = makeAdapters();
  const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);

  it('removes <script> tag and its contents', () => {
    const result = svc._stripHtml('<script>var x=1;</script>hello');
    expect(result).to.not.include('var x=1');
    expect(result).to.include('hello');
  });

  it('removes <style> tag and its contents', () => {
    const result = svc._stripHtml('<style>body{color:red}</style>world');
    expect(result).to.not.include('color:red');
    expect(result).to.include('world');
  });

  it('removes all HTML tags', () => {
    const result = svc._stripHtml('<h1>Title</h1><p>Text</p>');
    expect(result).to.not.include('<h1>');
    expect(result).to.not.include('<p>');
    expect(result).to.include('Title');
    expect(result).to.include('Text');
  });

  it('normalises multiple whitespace into single spaces', () => {
    const result = svc._stripHtml('hello   world\n\nfoo');
    expect(result).to.equal('hello world foo');
  });

  it('returns empty string for empty input', () => {
    expect(svc._stripHtml('')).to.equal('');
  });

  it('strips multiline script tags', () => {
    const html = '<script type="text/javascript">\nvar a = 1;\nvar b = 2;\n</script>content';
    const result = svc._stripHtml(html);
    expect(result).to.not.include('var a');
    expect(result).to.include('content');
  });
});

describe('DynamicDocCrawlerService — _estimateTokens()', () => {
  const { httpAdapter, pdfAdapter } = makeAdapters();
  const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);

  it('estimates ~1 token per 4 chars', () => {
    expect(svc._estimateTokens('abcd')).to.equal(1);
  });

  it('rounds up for non-multiples of 4', () => {
    expect(svc._estimateTokens('abcde')).to.equal(2);
  });

  it('returns 0 for empty string', () => {
    expect(svc._estimateTokens('')).to.equal(0);
  });

  it('returns higher estimate for longer strings', () => {
    const short = svc._estimateTokens('hello');
    const long = svc._estimateTokens('hello world this is a longer string');
    expect(long).to.be.greaterThan(short);
  });
});

describe('DynamicDocCrawlerService — _chunkText()', () => {
  const { httpAdapter, pdfAdapter } = makeAdapters();

  it('returns empty array for empty text', () => {
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    expect(svc._chunkText('')).to.deep.equal([]);
  });

  it('returns empty array for whitespace-only text', () => {
    const svc = new DynamicDocCrawlerService({ enableLogging: false }, httpAdapter, pdfAdapter);
    expect(svc._chunkText('   \n   ')).to.deep.equal([]);
  });

  it('returns single chunk for short text', () => {
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 500, minChunkTokens: 1 },
      httpAdapter,
      pdfAdapter
    );
    const result = svc._chunkText('short text here');
    expect(result).to.have.length(1);
  });

  it('returns multiple chunks for long text', () => {
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 20, chunkOverlapTokens: 2, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    const result = svc._chunkText(LONG_TEXT);
    expect(result.length).to.be.greaterThan(1);
  });

  it('each chunk is a non-empty string', () => {
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 20, chunkOverlapTokens: 2, minChunkTokens: 5 },
      httpAdapter,
      pdfAdapter
    );
    for (const chunk of svc._chunkText(LONG_TEXT)) {
      expect(chunk.length).to.be.greaterThan(0);
    }
  });

  it('discards chunks below minChunkTokens', () => {
    const svc = new DynamicDocCrawlerService(
      { enableLogging: false, targetChunkTokens: 100, chunkOverlapTokens: 0, minChunkTokens: 100 },
      httpAdapter,
      pdfAdapter
    );
    const result = svc._chunkText('hi');
    expect(result).to.have.length(0);
  });

  it('overlap causes consecutive chunks to share words', () => {
    const svc = new DynamicDocCrawlerService(
      {
        enableLogging: false,
        targetChunkTokens: 10,
        chunkOverlapTokens: 8,
        minChunkTokens: 1,
      },
      httpAdapter,
      pdfAdapter
    );
    const words = Array.from({ length: 200 }, (_, i) => `w${i}`);
    const text = words.join(' ');
    const chunks = svc._chunkText(text);
    if (chunks.length >= 2) {
      const lastWordChunk0 = chunks[0].split(' ').pop()!;
      expect(chunks[1]).to.include(lastWordChunk0);
    }
  });
});

describe('DEFAULT_CONFIG constants', () => {
  it('targetChunkTokens is 500', () => {
    expect(DEFAULT_CONFIG.targetChunkTokens).to.equal(500);
  });

  it('minChunkTokens is 50', () => {
    expect(DEFAULT_CONFIG.minChunkTokens).to.equal(50);
  });

  it('chunkOverlapTokens is 50', () => {
    expect(DEFAULT_CONFIG.chunkOverlapTokens).to.equal(50);
  });

  it('blobContainer is dynamic-docs', () => {
    expect(DEFAULT_CONFIG.blobContainer).to.equal('dynamic-docs');
  });

  it('fetchTimeoutMs is 15000', () => {
    expect(DEFAULT_CONFIG.fetchTimeoutMs).to.equal(15000);
  });

  it('enableLogging is true', () => {
    expect(DEFAULT_CONFIG.enableLogging).to.be.true;
  });
});
