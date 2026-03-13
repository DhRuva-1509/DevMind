import {
  DocIndexConfig,
  DocSearchDocument,
  IndexChunkInput,
  IndexResult,
  IndexError,
  DocSearchOptions,
  DocSearchResult,
  DocSearchResponse,
  IndexInfo,
  StorageUsage,
  StaleIndexReport,
  IncrementalUpdateOptions,
  DocIndexError,
  EmbeddingError,
  IndexNotFoundError,
} from './doc.index.types';

export interface SearchIndex {
  name: string;
  fields: SearchField[];
  vectorSearch?: object;
  semanticSearch?: object;
}

export interface SearchField {
  name: string;
  type: string;
  key?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  retrievable?: boolean;
  dimensions?: number;
  vectorSearchProfile?: string;
}

export interface SearchServiceAdapter {
  createIndex(name: string, schema: SearchIndex): Promise<{ success: boolean; error?: string }>;
  indexExists(name: string): Promise<boolean>;
  deleteIndex(name: string): Promise<{ success: boolean; error?: string }>;
  listIndexes(): Promise<string[]>;
  upsertDocuments(
    indexName: string,
    docs: object[]
  ): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ key: string; message: string }>;
  }>;
  deleteDocuments(indexName: string, ids: string[]): Promise<{ success: boolean; error?: string }>;
  hybridSearch(
    indexName: string,
    query: string,
    vector: number[],
    options?: object
  ): Promise<{
    results: Array<{ document: Record<string, unknown>; score: number; rerankerScore?: number }>;
    durationMs: number;
  }>;
  getIndexStats(indexName: string): Promise<{ documentCount: number; storageSize: number } | null>;
}

export interface EmbeddingAdapter {
  embed(texts: string[]): Promise<{ embeddings: number[][]; error?: string }>;
}

const DEFAULT_CONFIG: Required<DocIndexConfig> = {
  embeddingDeployment: 'text-embedding-3-large',
  embeddingDimensions: 3072,
  embeddingBatchSize: 16,
  indexPrefix: 'devmind',
  enableLogging: true,
};

export class DocIndexService {
  private readonly config: Required<DocIndexConfig>;
  private readonly searchAdapter: SearchServiceAdapter;
  private readonly embedder: EmbeddingAdapter;

  constructor(
    config: DocIndexConfig = {},
    search: SearchServiceAdapter,
    embedder: EmbeddingAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.searchAdapter = search;
    this.embedder = embedder;
  }

  buildIndexName(projectId: string, library: string): string {
    const safe = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return `${this.config.indexPrefix}-${safe(projectId)}-${safe(library)}`;
  }

  /**
   * Parses projectId and library back from an index name.
   * Returns null if the name doesn't match the expected pattern.
   */
  parseIndexName(indexName: string): { projectId: string; library: string } | null {
    const prefix = this.config.indexPrefix + '-';
    if (!indexName.startsWith(prefix)) return null;

    const rest = indexName.slice(prefix.length);
    const parts = rest.split('-');
    if (parts.length < 2) return null;

    const library = parts[parts.length - 1];
    const projectId = parts.slice(0, parts.length - 1).join('-');
    return { projectId, library };
  }

  /**
   * Ensures an index exists for the given project+library, creating it if needed.
   */
  async ensureIndex(projectId: string, library: string): Promise<string> {
    const indexName = this.buildIndexName(projectId, library);

    if (await this.searchAdapter.indexExists(indexName)) {
      this.log(`Index already exists: ${indexName}`);
      return indexName;
    }

    this.log(`Creating index: ${indexName}`);
    const schema = this.buildIndexSchema(indexName);
    const result = await this.searchAdapter.createIndex(indexName, schema);

    if (!result.success) {
      throw new DocIndexError(
        `Failed to create index: ${result.error ?? 'unknown error'}`,
        indexName
      );
    }

    return indexName;
  }

  /**
   * Deletes the index for a project+library pair.
   */
  async deleteIndex(projectId: string, library: string): Promise<void> {
    const indexName = this.buildIndexName(projectId, library);

    if (!(await this.searchAdapter.indexExists(indexName))) {
      throw new IndexNotFoundError(indexName);
    }

    const result = await this.searchAdapter.deleteIndex(indexName);
    if (!result.success) {
      throw new DocIndexError(
        `Failed to delete index: ${result.error ?? 'unknown error'}`,
        indexName
      );
    }

    this.log(`Deleted index: ${indexName}`);
  }

  /**
   * Returns info for all indexes belonging to a project.
   */
  async listProjectIndexes(projectId: string): Promise<IndexInfo[]> {
    const all = await this.searchAdapter.listIndexes();
    const prefix = `${this.config.indexPrefix}-${projectId.toLowerCase()}`;

    const projectIndexes = all.filter((name) => name.startsWith(prefix));
    const infos: IndexInfo[] = [];

    for (const indexName of projectIndexes) {
      const parsed = this.parseIndexName(indexName);
      const stats = await this.searchAdapter.getIndexStats(indexName);
      infos.push({
        indexName,
        projectId: parsed?.projectId ?? projectId,
        library: parsed?.library ?? 'unknown',
        documentCount: stats?.documentCount ?? 0,
        storageBytes: stats?.storageSize ?? 0,
      });
    }

    return infos;
  }

  /**
   * Generates embeddings and indexes a batch of documentation chunks.
   */
  async indexChunks(
    projectId: string,
    library: string,
    chunks: IndexChunkInput[]
  ): Promise<IndexResult> {
    const indexName = await this.ensureIndex(projectId, library);
    const startMs = Date.now();
    const errors: IndexError[] = [];
    let chunksIndexed = 0;
    let chunksSkipped = 0;

    const batches = this.batchArray(chunks, this.config.embeddingBatchSize);

    for (const batch of batches) {
      const texts = batch.map((c) => c.content);

      let embeddings: number[][];
      try {
        const embResult = await this.embedder.embed(texts);
        if (embResult.error) {
          throw new Error(embResult.error);
        }
        embeddings = embResult.embeddings;
      } catch (err) {
        for (const chunk of batch) {
          errors.push({
            chunkId: chunk.id,
            reason: `Embedding failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          chunksSkipped++;
        }
        continue;
      }
      const docs: DocSearchDocument[] = batch.map((chunk, i) => ({
        id: this.sanitizeId(chunk.id),
        content: chunk.content,
        contentVector: embeddings[i] ?? [],
        library: chunk.library,
        sourceUrl: chunk.sourceUrl,
        version: chunk.version,
        projectId: chunk.projectId,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        indexedAt: new Date().toISOString(),
      }));

      const upsertResult = await this.searchAdapter.upsertDocuments(indexName, docs);
      chunksIndexed += upsertResult.succeeded;
      chunksSkipped += upsertResult.failed;

      for (const e of upsertResult.errors) {
        errors.push({ chunkId: e.key, reason: e.message });
      }
    }

    const result: IndexResult = {
      projectId,
      library,
      indexName,
      chunksIndexed,
      chunksSkipped,
      errors,
      durationMs: Date.now() - startMs,
    };

    this.log(`Indexed ${chunksIndexed} chunks for ${library} in project ${projectId}`);
    return result;
  }

  /**
   * Incrementally updates an existing index — upserts changed chunks,
   * optionally removes chunks whose source URL is no longer live.
   */
  async updateIndex(
    projectId: string,
    library: string,
    chunks: IndexChunkInput[],
    options: IncrementalUpdateOptions = {}
  ): Promise<IndexResult> {
    const indexName = this.buildIndexName(projectId, library);

    if (!(await this.searchAdapter.indexExists(indexName))) {
      return this.indexChunks(projectId, library, chunks);
    }

    const result = await this.indexChunks(projectId, library, chunks);

    if (options.pruneStaleChunks && options.liveUrls && options.liveUrls.length > 0) {
      const staleIds = chunks
        .filter((c) => !options.liveUrls!.includes(c.sourceUrl))
        .map((c) => this.sanitizeId(c.id));

      if (staleIds.length > 0) {
        await this.searchAdapter.deleteDocuments(indexName, staleIds);
        this.log(`Pruned ${staleIds.length} stale chunks from ${indexName}`);
      }
    }

    return result;
  }

  /**
   * Performs hybrid search (vector + keyword + optional semantic) over a project's indexes.
   */
  async search(
    projectId: string,
    query: string,
    options: DocSearchOptions = {}
  ): Promise<DocSearchResponse> {
    const startMs = Date.now();
    const { library, version, topK = 10, additionalFilter, semanticSearch = true } = options;

    if (!library) {
      throw new DocIndexError(
        'library is required in DocSearchOptions for targeted search',
        projectId
      );
    }

    const indexName = this.buildIndexName(projectId, library);

    if (!(await this.searchAdapter.indexExists(indexName))) {
      throw new IndexNotFoundError(indexName);
    }

    const embResult = await this.embedder.embed([query]);
    if (embResult.error || !embResult.embeddings[0]) {
      throw new EmbeddingError(query);
    }
    const queryVector = embResult.embeddings[0];

    const filters: string[] = [];
    if (version) filters.push(`version eq '${version}'`);
    if (additionalFilter) filters.push(additionalFilter);
    const filter = filters.length > 0 ? filters.join(' and ') : undefined;

    const searchResult = await this.searchAdapter.hybridSearch(indexName, query, queryVector, {
      top: topK,
      filter,
      semanticSearch,
    });

    const results: DocSearchResult[] = searchResult.results.map((r) => ({
      id: String(r.document['id'] ?? ''),
      content: String(r.document['content'] ?? ''),
      library: String(r.document['library'] ?? ''),
      sourceUrl: String(r.document['sourceUrl'] ?? ''),
      version: String(r.document['version'] ?? ''),
      chunkIndex: Number(r.document['chunkIndex'] ?? 0),
      score: r.score,
      rerankerScore: r.rerankerScore,
    }));

    return {
      projectId,
      indexName,
      query,
      results,
      totalResults: results.length,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Aggregates storage usage across all indexes for a project.
   */
  async getStorageUsage(projectId: string): Promise<StorageUsage> {
    const indexes = await this.listProjectIndexes(projectId);

    const totalDocuments = indexes.reduce((sum, i) => sum + i.documentCount, 0);
    const totalStorageBytes = indexes.reduce((sum, i) => sum + i.storageBytes, 0);

    return { projectId, totalDocuments, totalStorageBytes, indexes };
  }

  async cleanupStaleIndexes(
    projectId: string,
    activeLibraries: string[],
    dryRun = false
  ): Promise<StaleIndexReport> {
    const indexes = await this.listProjectIndexes(projectId);
    const activeSet = new Set(activeLibraries.map((l) => l.toLowerCase()));

    const staleIndexes = indexes
      .filter((i) => !activeSet.has(i.library.toLowerCase()))
      .map((i) => i.indexName);

    const errors: string[] = [];
    let deletedCount = 0;

    if (!dryRun) {
      for (const indexName of staleIndexes) {
        try {
          const result = await this.searchAdapter.deleteIndex(indexName);
          if (result.success) {
            deletedCount++;
            this.log(`Deleted stale index: ${indexName}`);
          } else {
            errors.push(`Failed to delete ${indexName}: ${result.error ?? 'unknown'}`);
          }
        } catch (err) {
          errors.push(
            `Error deleting ${indexName}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    return { projectId, staleIndexes, deletedCount, errors };
  }

  /**
   * Builds the Azure AI Search index schema for documentation chunks.
   */
  buildIndexSchema(indexName: string): SearchIndex {
    return {
      name: indexName,
      fields: [
        {
          name: 'id',
          type: 'Edm.String',
          key: true,
          searchable: false,
          filterable: true,
          retrievable: true,
        },
        {
          name: 'content',
          type: 'Edm.String',
          key: false,
          searchable: true,
          filterable: false,
          retrievable: true,
        },
        {
          name: 'contentVector',
          type: 'Collection(Edm.Single)',
          key: false,
          searchable: true,
          filterable: false,
          retrievable: false,
          dimensions: this.config.embeddingDimensions,
          vectorSearchProfile: 'devmind-vector-profile',
        },
        {
          name: 'library',
          type: 'Edm.String',
          key: false,
          searchable: true,
          filterable: true,
          retrievable: true,
        },
        {
          name: 'sourceUrl',
          type: 'Edm.String',
          key: false,
          searchable: false,
          filterable: true,
          retrievable: true,
        },
        {
          name: 'version',
          type: 'Edm.String',
          key: false,
          searchable: false,
          filterable: true,
          retrievable: true,
        },
        {
          name: 'projectId',
          type: 'Edm.String',
          key: false,
          searchable: false,
          filterable: true,
          retrievable: true,
        },
        {
          name: 'chunkIndex',
          type: 'Edm.Int32',
          key: false,
          searchable: false,
          filterable: false,
          retrievable: true,
        },
        {
          name: 'tokenCount',
          type: 'Edm.Int32',
          key: false,
          searchable: false,
          filterable: false,
          retrievable: true,
        },
        {
          name: 'indexedAt',
          type: 'Edm.DateTimeOffset',
          key: false,
          searchable: false,
          filterable: true,
          retrievable: true,
        },
      ],
      vectorSearch: {
        algorithms: [
          {
            name: 'devmind-hnsw',
            kind: 'hnsw',
            parameters: { m: 4, efConstruction: 400, efSearch: 500, metric: 'cosine' },
          },
        ],
        profiles: [{ name: 'devmind-vector-profile', algorithm: 'devmind-hnsw' }],
      },
      semanticSearch: {
        defaultConfiguration: 'devmind-semantic',
        configurations: [
          {
            name: 'devmind-semantic',
            prioritizedFields: {
              contentFields: [{ fieldName: 'content' }],
              keywordsFields: [{ fieldName: 'library' }],
            },
          },
        ],
      },
    };
  }

  /**
   * Splits an array into fixed-size batches.
   */
  batchArray<T>(arr: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      batches.push(arr.slice(i, i + size));
    }
    return batches;
  }

  /**
   * Sanitizes a chunk ID to be safe for Azure AI Search document keys.
   * Keys must be URL-safe base64 or alphanumeric + hyphen/underscore.
   */
  sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_\-=]/g, '_').slice(0, 1024);
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[DocIndexService] ${message}`);
    }
  }
}
