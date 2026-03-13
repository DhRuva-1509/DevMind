export interface DocIndexConfig {
  embeddingDeployment?: string;
  embeddingDimensions?: number;
  embeddingBatchSize?: number;
  indexPrefix?: string;
  enableLogging?: boolean;
}

export interface DocSearchDocument {
  id: string;
  content: string;
  contentVector: number[];
  library: string;
  sourceUrl: string;
  version: string;
  projectId: string;
  chunkIndex: number;
  tokenCount: number;
  indexedAt: string;
}
export interface IndexChunkInput {
  id: string;
  content: string;
  library: string;
  sourceUrl: string;
  version: string;
  projectId: string;
  chunkIndex: number;
  tokenCount: number;
}

export interface IndexResult {
  projectId: string;
  library: string;
  indexName: string;
  chunksIndexed: number;
  chunksSkipped: number;
  errors: IndexError[];
  durationMs: number;
}

export interface IndexError {
  chunkId: string;
  reason: string;
}

export interface DocSearchOptions {
  library?: string;
  version?: string;
  topK?: number;
  additionalFilter?: string;
  semanticSearch?: boolean;
}

export interface DocSearchResult {
  id: string;
  content: string;
  library: string;
  sourceUrl: string;
  version: string;
  chunkIndex: number;
  score: number;
  rerankerScore?: number;
}

export interface DocSearchResponse {
  projectId: string;
  indexName: string;
  query: string;
  results: DocSearchResult[];
  totalResults: number;
  durationMs: number;
}

export interface IndexInfo {
  indexName: string;
  projectId: string;
  library: string;
  documentCount: number;
  storageBytes: number;
  createdAt?: string;
}

export interface StorageUsage {
  projectId: string;
  totalDocuments: number;
  totalStorageBytes: number;
  indexes: IndexInfo[];
}

export interface StaleIndexReport {
  projectId: string;
  staleIndexes: string[];
  deletedCount: number;
  errors: string[];
}

export interface IncrementalUpdateOptions {
  pruneStaleChunks?: boolean;
  liveUrls?: string[];
}

export class DocIndexError extends Error {
  constructor(
    message: string,
    public readonly indexName: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DocIndexError';
  }
}

export class EmbeddingError extends DocIndexError {
  constructor(chunkId: string, cause?: unknown) {
    super(`Failed to generate embedding for chunk: ${chunkId}`, chunkId, cause);
    this.name = 'EmbeddingError';
  }
}

export class IndexNotFoundError extends DocIndexError {
  constructor(indexName: string) {
    super(`Index not found: ${indexName}`, indexName);
    this.name = 'IndexNotFoundError';
  }
}
