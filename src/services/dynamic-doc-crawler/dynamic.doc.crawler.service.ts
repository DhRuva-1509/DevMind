import { v4 as uuidv4 } from 'uuid';
import {
  DynamicDocCrawlerConfig,
  DynamicDocCrawlerError,
  DynamicDocChunk,
  CrawlInput,
  CrawlResult,
  HttpFetchAdapter,
  PdfParseAdapter,
  BlobStorageAdapter,
  DEFAULT_CONFIG,
} from './dynamic.doc.crawler.types';

export class DynamicDocCrawlerService {
  private readonly cfg: Required<DynamicDocCrawlerConfig>;

  constructor(
    config: DynamicDocCrawlerConfig = {},
    private readonly httpAdapter: HttpFetchAdapter,
    private readonly pdfAdapter: PdfParseAdapter,
    private readonly blobAdapter?: BlobStorageAdapter
  ) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Crawl a URL or parse a PDF buffer, chunk the extracted text, optionally
   * store chunks in Azure Blob Storage, and return structured DynamicDocChunks.
   *
   * accepts UrlCrawlInput or PdfCrawlInput
   * crawls/parses content
   * chunks appropriately
   * stores in Azure Blob Storage (non-fatal if unavailable)
   * returns structured DynamicDocChunk[]
   */
  async crawl(input: CrawlInput): Promise<CrawlResult> {
    this._validateInput(input);

    const sessionId = uuidv4();
    const startTime = Date.now();

    // Step 1 — extract raw text
    let rawText: string;
    let sourceRef: string;

    if (input.type === 'url') {
      sourceRef = input.url;
      rawText = await this._fetchUrl(input.url);
    } else {
      sourceRef = input.filename;
      rawText = await this._parsePdf(input.buffer, input.filename);
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new DynamicDocCrawlerError(`No content extracted from ${sourceRef}`, 'NO_CONTENT');
    }

    if (this.cfg.enableLogging) {
      console.log(
        `[DynamicDocCrawler] Extracted ${rawText.length} chars from ${input.type}: ${sourceRef}`
      );
    }

    // Step 2 — chunk
    const textChunks = this._chunkText(rawText);

    if (this.cfg.enableLogging) {
      console.log(
        `[DynamicDocCrawler] Produced ${textChunks.length} chunks for session ${sessionId}`
      );
    }

    // Step 3 — build DynamicDocChunk objects + optionally upload
    const crawledAt = new Date().toISOString();
    let blobSkipped = false;

    const chunks: DynamicDocChunk[] = await Promise.all(
      textChunks.map(async (content, index) => {
        const chunkIndex = index;
        const paddedIndex = String(chunkIndex).padStart(4, '0');
        const blobKey = `dynamic/${sessionId}/${paddedIndex}.json`;
        const tokenCount = this._estimateTokens(content);

        const chunk: DynamicDocChunk = {
          id: `${sessionId}-${chunkIndex}`,
          blobKey,
          content,
          sourceRef,
          sourceType: input.type,
          chunkIndex,
          tokenCount,
          sessionId,
          storedAt: crawledAt,
        };

        return chunk;
      })
    );

    // Step 4 — upload to blob ; non-fatal
    if (this.blobAdapter) {
      for (const chunk of chunks) {
        try {
          await this.blobAdapter.upload(
            chunk.blobKey,
            JSON.stringify(chunk),
            this.cfg.blobContainer
          );
        } catch (err) {
          if (this.cfg.enableLogging) {
            console.warn(
              `[DynamicDocCrawler] Blob upload failed for ${chunk.blobKey}: ${(err as Error).message}`
            );
          }
          blobSkipped = true;
        }
      }
    } else {
      blobSkipped = true;
    }

    const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

    return {
      sessionId,
      chunks,
      sourceRef,
      sourceType: input.type,
      chunkCount: chunks.length,
      totalTokens,
      durationMs: Date.now() - startTime,
      crawledAt,
      blobSkipped,
    };
  }

  private async _fetchUrl(url: string): Promise<string> {
    let html: string;
    try {
      html = await this.httpAdapter.fetch(url, this.cfg.fetchTimeoutMs);
    } catch (err) {
      throw new DynamicDocCrawlerError(
        `Failed to fetch URL ${url}: ${(err as Error).message}`,
        'FETCH_FAILED',
        err as Error
      );
    }

    return this._stripHtml(html);
  }

  private async _parsePdf(buffer: Buffer, filename: string): Promise<string> {
    try {
      return await this.pdfAdapter.parse(buffer);
    } catch (err) {
      throw new DynamicDocCrawlerError(
        `Failed to parse PDF ${filename}: ${(err as Error).message}`,
        'PDF_PARSE_FAILED',
        err as Error
      );
    }
  }

  /**
   * Strip <script>, <style> tags and all HTML tags from a page,
   * then normalise whitespace. Consistent with Sprint 3 DocCrawlerService.
   */
  _stripHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Split text into chunks targeting `targetChunkTokens` with `chunkOverlapTokens`
   * overlap between consecutive chunks. Chunks below `minChunkTokens` are discarded.
   *
   * Strategy: split on whitespace into words, then group words until the target
   * token budget is reached. Overlap is achieved by re-including the tail words
   * from the previous chunk at the start of the next chunk.
   */
  _chunkText(text: string): string[] {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) return [];

    const targetWords = this.cfg.targetChunkTokens * 4; // ~4 chars per token → ~1 word per token
    const overlapWords = this.cfg.chunkOverlapTokens * 4;
    const minWords = this.cfg.minChunkTokens * 4;

    const chunks: string[] = [];
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + targetWords, words.length);
      const chunkText = words.slice(start, end).join(' ');

      if (this._estimateTokens(chunkText) >= this.cfg.minChunkTokens) {
        chunks.push(chunkText);
      }

      if (end >= words.length) break;

      const advance = Math.max(1, targetWords - overlapWords);
      start += advance;
    }

    return chunks;
  }

  /** Estimate token count: ~1 token per 4 characters, rounded up. */
  _estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /** Build the zero-padded blob key for a given session and chunk index. */
  buildBlobKey(sessionId: string, chunkIndex: number): string {
    const paddedIndex = String(chunkIndex).padStart(4, '0');
    return `dynamic/${sessionId}/${paddedIndex}.json`;
  }

  private _validateInput(input: CrawlInput): void {
    if (!input || typeof input !== 'object') {
      throw new DynamicDocCrawlerError('input must be a CrawlInput object', 'INVALID_INPUT');
    }
    if (input.type === 'url') {
      if (!input.url || typeof input.url !== 'string' || input.url.trim() === '') {
        throw new DynamicDocCrawlerError('input.url must be a non-empty string', 'INVALID_INPUT');
      }
      if (!input.url.startsWith('http://') && !input.url.startsWith('https://')) {
        throw new DynamicDocCrawlerError(
          'input.url must start with http:// or https://',
          'INVALID_INPUT'
        );
      }
    } else if (input.type === 'pdf') {
      if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
        throw new DynamicDocCrawlerError(
          'input.buffer must be a non-empty Buffer',
          'INVALID_INPUT'
        );
      }
      if (!input.filename || typeof input.filename !== 'string' || input.filename.trim() === '') {
        throw new DynamicDocCrawlerError(
          'input.filename must be a non-empty string',
          'INVALID_INPUT'
        );
      }
    } else {
      throw new DynamicDocCrawlerError('input.type must be "url" or "pdf"', 'INVALID_INPUT');
    }
  }
}
