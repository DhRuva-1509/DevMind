import {
  TempIndexManagerConfig,
  TempIndexRecord,
  TempIndexChunk,
  PinTarget,
  CreateIndexInput,
  CreateIndexResult,
  UpsertChunksInput,
  UpsertChunksResult,
  SearchTempIndexInput,
  SearchTempIndexResult,
  TempSearchHit,
  DeleteIndexResult,
  CleanupResult,
  StorageQuotaStatus,
  TempSearchIndexAdapter,
  TempEmbeddingAdapter,
  TempStateAdapter,
  TempIndexError,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_STORAGE_BYTES,
  DEFAULT_INDEX_PREFIX,
  MAX_ACTIVE_INDEXES,
} from './temp.index.manager.types';

const SESSION_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/;

function sanitiseSessionId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

function estimateBytes(chunks: TempIndexChunk[]): number {
  return chunks.reduce((sum, c) => sum + c.content.length + c.vector.length * 4, 0);
}

export class TempIndexManager {
  private readonly _prefix: string;
  private readonly _ttlMs: number;
  private readonly _maxStorageBytes: number;
  private readonly _maxActiveIndexes: number;
  private readonly _dimensions: number;
  private readonly _autoExpiry: boolean;

  constructor(
    config: TempIndexManagerConfig,
    private readonly _searchAdapter: TempSearchIndexAdapter,
    private readonly _embeddingAdapter: TempEmbeddingAdapter,
    private readonly _stateAdapter: TempStateAdapter
  ) {
    this._prefix = config.indexPrefix ?? DEFAULT_INDEX_PREFIX;
    this._ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
    this._maxStorageBytes = config.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES;
    this._maxActiveIndexes = config.maxActiveIndexes ?? MAX_ACTIVE_INDEXES;
    this._dimensions = config.embeddingDimensions ?? 1536;
    this._autoExpiry = config.enableAutoExpiry ?? true;
  }

  buildIndexName(sessionId: string): string {
    const safe = sanitiseSessionId(sessionId);
    return `${this._prefix}-${safe}`;
  }

  async createIndex(input: CreateIndexInput): Promise<CreateIndexResult> {
    const { sessionId, sourceLabel, pinTarget } = input;

    if (!sessionId || !SESSION_ID_RE.test(sanitiseSessionId(sessionId))) {
      throw new TempIndexError(
        `Invalid sessionId: "${sessionId}". Must be non-empty and URL-safe.`,
        'INVALID_SESSION_ID',
        sessionId
      );
    }

    if (this._autoExpiry) {
      await this._expireStale();
    }

    // Check if already exists (reuse)
    const existing = await this._stateAdapter.readRecord(sessionId);
    if (existing) {
      // Refresh expiry on reuse
      const refreshed: TempIndexRecord = {
        ...existing,
        expiresAt: new Date(Date.now() + this._ttlMs).toISOString(),
      };
      await this._stateAdapter.saveRecord(refreshed);
      return { record: refreshed, reused: true };
    }

    // Quota checks
    const allRecords = await this._stateAdapter.listRecords();
    if (allRecords.length >= this._maxActiveIndexes) {
      throw new TempIndexError(
        `Maximum active indexes reached (${this._maxActiveIndexes}). Delete one before creating a new session.`,
        'MAX_INDEXES_REACHED',
        sessionId
      );
    }

    const totalBytes = allRecords.reduce((s, r) => s + r.estimatedStorageBytes, 0);
    if (totalBytes >= this._maxStorageBytes) {
      throw new TempIndexError(
        `Storage quota exceeded (${this._maxStorageBytes} bytes). Clean up existing indexes.`,
        'QUOTA_EXCEEDED',
        sessionId
      );
    }

    // Create the Azure AI Search index
    const indexName = this.buildIndexName(sessionId);
    try {
      await this._searchAdapter.createIndex(indexName, this._dimensions);
    } catch (err) {
      throw new TempIndexError(
        `Failed to create Azure AI Search index "${indexName}".`,
        'INDEX_CREATE_FAILED',
        sessionId,
        err
      );
    }

    const now = new Date();
    const record: TempIndexRecord = {
      sessionId,
      indexName,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this._ttlMs).toISOString(),
      pinTarget: pinTarget ?? { type: 'none' },
      documentCount: 0,
      estimatedStorageBytes: 0,
      sourceLabel,
    };

    await this._stateAdapter.saveRecord(record);
    return { record, reused: false };
  }

  async upsertChunks(input: UpsertChunksInput): Promise<UpsertChunksResult> {
    const { sessionId, chunks } = input;

    const record = await this._stateAdapter.readRecord(sessionId);
    if (!record) {
      throw new TempIndexError(
        `Session not found: "${sessionId}". Call createIndex() first.`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }

    if (this._isExpired(record)) {
      throw new TempIndexError(
        `Session "${sessionId}" has expired. Create a new session.`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }

    const errors: string[] = [];
    const indexedChunks: TempIndexChunk[] = [];

    for (const chunk of chunks) {
      let vector: number[];
      try {
        vector = await this._embeddingAdapter.embed(chunk.content);
      } catch (err) {
        errors.push(`Embed failed for chunk ${chunk.chunkIndex}: ${String(err)}`);
        continue;
      }

      indexedChunks.push({
        id: `${sessionId}-${String(chunk.chunkIndex).padStart(4, '0')}`,
        sourceRef: chunk.sourceRef,
        sourceType: chunk.sourceType,
        sessionId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        tokenCount: chunk.tokenCount,
        vector,
        indexedAt: new Date().toISOString(),
      });
    }

    if (indexedChunks.length > 0) {
      try {
        await this._searchAdapter.upsertDocuments(record.indexName, indexedChunks);
      } catch (err) {
        throw new TempIndexError(
          `Failed to upsert documents into "${record.indexName}".`,
          'UPSERT_FAILED',
          sessionId,
          err
        );
      }
    }

    const addedBytes = estimateBytes(indexedChunks);
    const updatedRecord: TempIndexRecord = {
      ...record,
      documentCount: record.documentCount + indexedChunks.length,
      estimatedStorageBytes: record.estimatedStorageBytes + addedBytes,
      // Refresh TTL on activity
      expiresAt: new Date(Date.now() + this._ttlMs).toISOString(),
    };
    await this._stateAdapter.saveRecord(updatedRecord);

    return {
      sessionId,
      indexName: record.indexName,
      uploaded: indexedChunks.length,
      skipped: chunks.length - indexedChunks.length,
      errors,
    };
  }

  async search(input: SearchTempIndexInput): Promise<SearchTempIndexResult> {
    const { sessionId, query, vector, topK = 5 } = input;

    const record = await this._stateAdapter.readRecord(sessionId);
    if (!record) {
      throw new TempIndexError(
        `Session not found: "${sessionId}".`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }

    if (this._isExpired(record)) {
      throw new TempIndexError(
        `Session "${sessionId}" has expired.`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }

    const start = Date.now();
    let results: TempSearchHit[];
    try {
      results = await this._searchAdapter.search(record.indexName, query, vector, topK);
    } catch (err) {
      throw new TempIndexError(
        `Search failed on index "${record.indexName}".`,
        'SEARCH_FAILED',
        sessionId,
        err
      );
    }

    return {
      sessionId,
      indexName: record.indexName,
      results,
      durationMs: Date.now() - start,
    };
  }

  async deleteIndex(sessionId: string): Promise<DeleteIndexResult> {
    const record = await this._stateAdapter.readRecord(sessionId);
    const indexName = record ? record.indexName : this.buildIndexName(sessionId);

    let wasAlreadyGone = false;

    try {
      const exists = await this._searchAdapter.indexExists(indexName);
      if (!exists) {
        wasAlreadyGone = true;
      } else {
        await this._searchAdapter.deleteIndex(indexName);
      }
    } catch (err) {
      throw new TempIndexError(
        `Failed to delete index "${indexName}".`,
        'INDEX_DELETE_FAILED',
        sessionId,
        err
      );
    }

    await this._stateAdapter.deleteRecord(sessionId);

    return { sessionId, indexName, deleted: true, wasAlreadyGone };
  }

  async listActiveIndexes(): Promise<TempIndexRecord[]> {
    if (this._autoExpiry) {
      await this._expireStale();
    }
    const records = await this._stateAdapter.listRecords();
    return records.filter((r) => !this._isExpired(r));
  }

  async cleanupExpired(): Promise<CleanupResult> {
    const records = await this._stateAdapter.listRecords();
    const expired = records.filter((r) => this._isExpired(r));
    const errors: string[] = [];
    let deletedCount = 0;

    for (const record of expired) {
      try {
        await this._searchAdapter.deleteIndex(record.indexName);
        await this._stateAdapter.deleteRecord(record.sessionId);
        deletedCount++;
      } catch (err) {
        errors.push(`Failed to delete expired session "${record.sessionId}": ${String(err)}`);
      }
    }

    return {
      expiredSessionIds: expired.map((r) => r.sessionId),
      deletedCount,
      errors,
    };
  }

  async pinToProject(sessionId: string, projectId: string): Promise<TempIndexRecord> {
    const record = await this._stateAdapter.readRecord(sessionId);
    if (!record) {
      throw new TempIndexError(
        `Session not found: "${sessionId}".`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }
    const updated: TempIndexRecord = {
      ...record,
      pinTarget: { type: 'project', projectId },
    };
    await this._stateAdapter.saveRecord(updated);
    return updated;
  }

  async pinToBranch(
    sessionId: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<TempIndexRecord> {
    const record = await this._stateAdapter.readRecord(sessionId);
    if (!record) {
      throw new TempIndexError(
        `Session not found: "${sessionId}".`,
        'SESSION_NOT_FOUND',
        sessionId
      );
    }
    const updated: TempIndexRecord = {
      ...record,
      pinTarget: { type: 'branch', owner, repo, branch },
    };
    await this._stateAdapter.saveRecord(updated);
    return updated;
  }

  async getQuotaStatus(): Promise<StorageQuotaStatus> {
    const records = await this._stateAdapter.listRecords();
    const active = records.filter((r) => !this._isExpired(r));
    const totalBytes = active.reduce((s, r) => s + r.estimatedStorageBytes, 0);

    return {
      totalEstimatedBytes: totalBytes,
      maxStorageBytes: this._maxStorageBytes,
      usedPercent: Math.round((totalBytes / this._maxStorageBytes) * 100),
      activeIndexCount: active.length,
      maxActiveIndexes: this._maxActiveIndexes,
      withinQuota: totalBytes < this._maxStorageBytes && active.length < this._maxActiveIndexes,
    };
  }

  private _isExpired(record: TempIndexRecord): boolean {
    return Date.now() > new Date(record.expiresAt).getTime();
  }

  private async _expireStale(): Promise<void> {
    const records = await this._stateAdapter.listRecords();
    const expired = records.filter((r) => this._isExpired(r));
    for (const record of expired) {
      try {
        await this._searchAdapter.deleteIndex(record.indexName);
        await this._stateAdapter.deleteRecord(record.sessionId);
      } catch {
        // Non-fatal — best-effort cleanup
      }
    }
  }
}
