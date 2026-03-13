export type DocFramework = 'docusaurus' | 'sphinx' | 'mkdocs' | 'vitepress' | 'generic';

export interface DocCrawlerConfig {
  maxDepth?: number;
  maxPages?: number;
  rateLimitMs?: number;
  requestTimeoutMs?: number;
  chunkTargetTokens?: number;
  chunkMinTokens?: number;
  chunkMaxTokens?: number;
  respectRobotsTxt?: boolean;
  cacheTtlMs?: number;
  enableCache?: boolean;
  storageContainer?: string;
  enableLogging?: boolean;
}

export interface LibraryEntry {
  name: string;
  docsUrl: string;
  framework: DocFramework;
  version?: string;
}

/** Built-in supported libraries */
export const SUPPORTED_LIBRARIES: LibraryEntry[] = [
  { name: 'react', docsUrl: 'https://react.dev/reference', framework: 'docusaurus' },
  { name: 'nextjs', docsUrl: 'https://nextjs.org/docs', framework: 'docusaurus' },
  { name: 'vue', docsUrl: 'https://vuejs.org/guide', framework: 'vitepress' },
  { name: 'express', docsUrl: 'https://expressjs.com/en/api.html', framework: 'generic' },
  { name: 'fastify', docsUrl: 'https://fastify.dev/docs/latest', framework: 'docusaurus' },
  { name: 'prisma', docsUrl: 'https://www.prisma.io/docs', framework: 'docusaurus' },
  { name: 'drizzle', docsUrl: 'https://orm.drizzle.team/docs/overview', framework: 'docusaurus' },
  { name: 'zod', docsUrl: 'https://zod.dev', framework: 'docusaurus' },
  { name: 'typescript', docsUrl: 'https://www.typescriptlang.org/docs', framework: 'generic' },
];

/**
 * Crawl Models
 */
export interface CrawlPage {
  url: string;
  depth: number;
  text: string;
  title: string;
  description?: string;
  framework: DocFramework;
  crawledAt: number;
}

export interface ContentChunk {
  index: number;
  sourceUrl: string;
  library: string;
  text: string;
  tokenCount: number;
  blobKey: string;
}

export interface CrawlResult {
  library: string;
  seedUrl: string;
  pagesVisited: number;
  chunksStored: number;
  errors: CrawlError[];
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

export interface CrawlError {
  url: string;
  reason: string;
  statusCode?: number;
}

/**
 * Chunking
 */
export interface ChunkOptions {
  targetTokens: number;
  minTokens: number;
  maxTokens: number;
}

/**
 * Cache
 */
export interface CrawlCacheEntry {
  result: CrawlResult;
  expiresAt: number;
}

/**
 * Errors
 */

export class CrawlerError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'CrawlerError';
  }
}

export class RobotsTxtBlockedError extends CrawlerError {
  constructor(url: string) {
    super(`Blocked by robots.txt: ${url}`, url);
    this.name = 'RobotsTxtBlockedError';
  }
}

export class CrawlDepthExceededError extends CrawlerError {
  constructor(url: string, depth: number) {
    super(`Max crawl depth exceeded at depth ${depth}: ${url}`, url);
    this.name = 'CrawlDepthExceededError';
  }
}
