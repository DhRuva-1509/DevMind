export interface DynamicDocCrawlerConfig {
  targetChunkTokens?: number;
  minChunkTokens?: number;
  chunkOverlapTokens?: number;
  blobContainer?: string;
  fetchTimeoutMs?: number;
  enableLogging?: boolean;
}

export type CrawlSource = 'url' | 'pdf';

export interface UrlCrawlInput {
  type: 'url';
  url: string;
  label?: string;
}

export interface PdfCrawlInput {
  type: 'pdf';
  buffer: Buffer;
  filename: string;
}

export type CrawlInput = UrlCrawlInput | PdfCrawlInput;

export interface DynamicDocChunk {
  id: string;
  blobKey: string;
  content: string;
  sourceRef: string;
  sourceType: CrawlSource;
  chunkIndex: number;
  tokenCount: number;
  sessionId: string;
  storedAt: string;
}

export interface CrawlResult {
  sessionId: string;
  chunks: DynamicDocChunk[];
  sourceRef: string;
  sourceType: CrawlSource;
  chunkCount: number;
  totalTokens: number;
  durationMs: number;
  crawledAt: string;
  blobSkipped: boolean;
}

export interface HttpFetchAdapter {
  /**
   * Fetch the HTML/text content of a URL.
   * Returns the raw response body as a string.
   */
  fetch(url: string, timeoutMs: number): Promise<string>;
}

export interface PdfParseAdapter {
  /**
   * Extract plain text from raw PDF bytes.
   * Returns the full extracted text as a single string.
   */
  parse(buffer: Buffer): Promise<string>;
}

export interface BlobStorageAdapter {
  /**
   * Upload a JSON string to blob storage.
   * @param key   blob key (path within the container)
   * @param content  JSON string to store
   * @param container  blob container name
   */
  upload(key: string, content: string, container: string): Promise<void>;
}

export class DynamicDocCrawlerError extends Error {
  constructor(
    message: string,
    public readonly code: DynamicDocCrawlerErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'DynamicDocCrawlerError';
  }
}

export type DynamicDocCrawlerErrorCode =
  | 'INVALID_INPUT'
  | 'FETCH_FAILED'
  | 'PDF_PARSE_FAILED'
  | 'BLOB_UPLOAD_FAILED'
  | 'NO_CONTENT';

export const DEFAULT_CONFIG: Required<DynamicDocCrawlerConfig> = {
  targetChunkTokens: 500,
  minChunkTokens: 50,
  chunkOverlapTokens: 50,
  blobContainer: 'dynamic-docs',
  fetchTimeoutMs: 15000,
  enableLogging: true,
};
