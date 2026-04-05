export const DEFAULT_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_STORAGE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_INDEX_PREFIX = 'tmp';
export const MAX_ACTIVE_INDEXES = 20;
export const INDEX_NAME_MAX_LENGTH = 128;

export interface TempIndexManagerConfig {
  indexPrefix?: string;
  ttlMs?: number;
  maxStorageBytes?: number;
  maxActiveIndexes?: number;
  embeddingDimensions?: number;
  enableAutoExpiry?: boolean;
}

export type PinTarget =
  | { type: 'project'; projectId: string }
  | { type: 'branch'; owner: string; repo: string; branch: string }
  | { type: 'none' };

export interface TempIndexRecord {
  sessionId: string;
  indexName: string;
  createdAt: string;
  expiresAt: string;
  pinTarget: PinTarget;
  documentCount: number;
  estimatedStorageBytes: number;
  sourceLabel: string;
}

export interface TempIndexChunk {
  id: string;
  sourceRef: string;
  sourceType: 'url' | 'pdf';
  sessionId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  vector: number[];
  indexedAt: string;
}

export interface CreateIndexInput {
  sessionId: string;
  sourceLabel: string;
  pinTarget?: PinTarget;
}

export interface CreateIndexResult {
  record: TempIndexRecord;
  reused: boolean;
}

export interface UpsertChunksInput {
  sessionId: string;
  chunks: Array<{
    content: string;
    sourceRef: string;
    sourceType: 'url' | 'pdf';
    chunkIndex: number;
    tokenCount: number;
  }>;
}

export interface UpsertChunksResult {
  sessionId: string;
  indexName: string;
  uploaded: number;
  skipped: number;
  errors: string[];
}

export interface SearchTempIndexInput {
  sessionId: string;
  query: string;
  vector?: number[];
  topK?: number;
}

export interface SearchTempIndexResult {
  sessionId: string;
  indexName: string;
  results: TempSearchHit[];
  durationMs: number;
}

export interface TempSearchHit {
  id: string;
  content: string;
  sourceRef: string;
  chunkIndex: number;
  score: number;
}

export interface DeleteIndexResult {
  sessionId: string;
  indexName: string;
  deleted: boolean;
  wasAlreadyGone: boolean;
}

export interface CleanupResult {
  expiredSessionIds: string[];
  deletedCount: number;
  errors: string[];
}

export interface StorageQuotaStatus {
  totalEstimatedBytes: number;
  maxStorageBytes: number;
  usedPercent: number;
  activeIndexCount: number;
  maxActiveIndexes: number;
  withinQuota: boolean;
}

export interface TempSearchIndexAdapter {
  indexExists(indexName: string): Promise<boolean>;
  createIndex(indexName: string, dimensions: number): Promise<void>;
  deleteIndex(indexName: string): Promise<void>;
  listIndexesByPrefix(prefix: string): Promise<string[]>;
  upsertDocuments(indexName: string, docs: TempIndexChunk[]): Promise<void>;
  search(
    indexName: string,
    query: string,
    vector: number[] | undefined,
    topK: number
  ): Promise<TempSearchHit[]>;
}

export interface TempEmbeddingAdapter {
  embed(text: string): Promise<number[]>;
}

export interface TempStateAdapter {
  saveRecord(record: TempIndexRecord): Promise<void>;
  readRecord(sessionId: string): Promise<TempIndexRecord | null>;
  deleteRecord(sessionId: string): Promise<void>;
  listRecords(): Promise<TempIndexRecord[]>;
}

export class TempIndexError extends Error {
  constructor(
    message: string,
    public readonly code: TempIndexErrorCode,
    public readonly sessionId?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'TempIndexError';
  }
}

export type TempIndexErrorCode =
  | 'INVALID_SESSION_ID'
  | 'SESSION_NOT_FOUND'
  | 'QUOTA_EXCEEDED'
  | 'MAX_INDEXES_REACHED'
  | 'INDEX_CREATE_FAILED'
  | 'INDEX_DELETE_FAILED'
  | 'EMBED_FAILED'
  | 'UPSERT_FAILED'
  | 'SEARCH_FAILED';
