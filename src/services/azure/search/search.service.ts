// src/services/azure/search/search.service.ts

import {
  SearchClient,
  SearchIndexClient,
  SearchIndex,
  SearchField,
  VectorSearch,
  SemanticConfiguration,
  SemanticPrioritizedFields,
  SemanticSearch,
  IndexDocumentsResult,
} from '@azure/search-documents';
import { TokenCredential } from '@azure/core-auth';
import { azureAuthService } from '../auth/auth.service';
import {
  SearchConfig,
  IndexConfig,
  IndexField,
  SearchDocument,
  SearchOptions,
  HybridSearchOptions,
  SearchResults,
  SearchResultItem,
  IndexResult,
  UploadResult,
  SearchErrorCode,
  IndexStats,
  SearchServiceStatus,
  SearchCaption,
} from './search.types';

export class AzureSearchService {
  private indexClient: SearchIndexClient | null = null;
  private searchClients: Map<string, SearchClient<SearchDocument>> = new Map();
  private config: Required<SearchConfig>;
  private _isInitialized: boolean = false;

  private static readonly DEFAULT_CONFIG: Required<SearchConfig> = {
    endpoint: '',
    indexName: 'documentation',
    apiVersion: '2024-07-01',
    enableSemanticSearch: true,
    defaultTopK: 10,
    enableLogging: true,
  };

  constructor(config: SearchConfig = {}) {
    this.config = { ...AzureSearchService.DEFAULT_CONFIG, ...config };

    if (!this.config.endpoint) {
      this.config.endpoint = process.env.AZURE_SEARCH_ENDPOINT || '';
    }

    if (this.config.endpoint) {
      this.initializeClient();
    }
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Initialize the search clients
   */
  private initializeClient(): void {
    try {
      const credential: TokenCredential = azureAuthService.getCredential();
      this.indexClient = new SearchIndexClient(this.config.endpoint, credential);
      this._isInitialized = true;
    } catch {
      this._isInitialized = false;
    }
  }

  /**
   * Get or create a search client for an index
   */
  private getSearchClient(indexName?: string): SearchClient<SearchDocument> | null {
    const index = indexName || this.config.indexName;

    if (this.searchClients.has(index)) {
      return this.searchClients.get(index)!;
    }

    if (!this.indexClient) {
      return null;
    }

    try {
      const credential: TokenCredential = azureAuthService.getCredential();
      const client = new SearchClient<SearchDocument>(this.config.endpoint, index, credential);
      this.searchClients.set(index, client);
      return client;
    } catch {
      return null;
    }
  }

  // ============================================================
  // INDEX MANAGEMENT
  // ============================================================

  /**
   * Create a new search index
   */
  async createIndex(config: IndexConfig): Promise<IndexResult> {
    if (!this.indexClient) {
      return {
        success: false,
        indexName: config.name,
        error: 'Search client not initialized. Set AZURE_SEARCH_ENDPOINT.',
        errorCode: SearchErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const exists = await this.indexExists(config.name);
      if (exists) {
        return {
          success: false,
          indexName: config.name,
          error: `Index '${config.name}' already exists`,
          errorCode: SearchErrorCode.INDEX_ALREADY_EXISTS,
        };
      }

      const index = this.buildIndexSchema(config);
      await this.indexClient.createIndex(index);

      return {
        success: true,
        indexName: config.name,
      };
    } catch (error) {
      return {
        success: false,
        indexName: config.name,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Update an existing index
   */
  async updateIndex(config: IndexConfig): Promise<IndexResult> {
    if (!this.indexClient) {
      return {
        success: false,
        indexName: config.name,
        error: 'Search client not initialized.',
        errorCode: SearchErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const exists = await this.indexExists(config.name);
      if (!exists) {
        return {
          success: false,
          indexName: config.name,
          error: `Index '${config.name}' does not exist`,
          errorCode: SearchErrorCode.INDEX_NOT_FOUND,
        };
      }

      const index = this.buildIndexSchema(config);
      await this.indexClient.createOrUpdateIndex(index);

      return {
        success: true,
        indexName: config.name,
      };
    } catch (error) {
      return {
        success: false,
        indexName: config.name,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Delete an index
   */
  async deleteIndex(indexName: string): Promise<IndexResult> {
    if (!this.indexClient) {
      return {
        success: false,
        indexName,
        error: 'Search client not initialized',
        errorCode: SearchErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await this.indexClient.deleteIndex(indexName);
      this.searchClients.delete(indexName);

      return {
        success: true,
        indexName,
      };
    } catch (error) {
      return {
        success: false,
        indexName,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Check if an index exists
   */
  async indexExists(indexName: string): Promise<boolean> {
    if (!this.indexClient) {
      return false;
    }

    try {
      await this.indexClient.getIndex(indexName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List all indexes
   */
  async listIndexes(): Promise<string[]> {
    if (!this.indexClient) {
      return [];
    }

    try {
      const indexes: string[] = [];
      for await (const index of this.indexClient.listIndexes()) {
        indexes.push(index.name);
      }
      return indexes;
    } catch {
      return [];
    }
  }

  /**
   * Get index statistics
   */
  async getIndexStats(indexName: string): Promise<IndexStats | null> {
    if (!this.indexClient) {
      return null;
    }

    try {
      const stats = await this.indexClient.getIndexStatistics(indexName);
      return {
        documentCount: stats.documentCount || 0,
        storageSize: stats.storageSize || 0,
      };
    } catch {
      return null;
    }
  }

  /**
   * Build index schema from config
   */
  private buildIndexSchema(config: IndexConfig): SearchIndex {
    const fields: SearchField[] = config.fields.map((field) => this.mapFieldToSearchField(field));

    const index: SearchIndex = {
      name: config.name,
      fields,
    };

    if (config.vectorProfiles && config.vectorAlgorithms) {
      index.vectorSearch = {
        profiles: config.vectorProfiles.map((p) => ({
          name: p.name,
          algorithmConfigurationName: p.algorithmConfigurationName,
        })),
        algorithms: config.vectorAlgorithms.map((a) => ({
          name: a.name,
          kind: a.kind,
          ...(a.parameters &&
            a.kind === 'hnsw' && {
              hnswParameters: {
                metric: a.parameters.metric || 'cosine',
                m: a.parameters.m || 4,
                efConstruction: a.parameters.efConstruction || 400,
                efSearch: a.parameters.efSearch || 500,
              },
            }),
        })),
      } as VectorSearch;
    }

    if (config.semanticConfigName && this.config.enableSemanticSearch) {
      const semanticConfig: SemanticConfiguration = {
        name: config.semanticConfigName,
        prioritizedFields: {
          titleField: config.semanticTitleField ? { name: config.semanticTitleField } : undefined,
          contentFields: config.semanticContentFields?.map((name) => ({
            name,
          })),
          keywordsFields: config.semanticKeywordFields?.map((name) => ({
            name,
          })),
        } as SemanticPrioritizedFields,
      };

      index.semanticSearch = {
        configurations: [semanticConfig],
      } as SemanticSearch;
    }

    return index;
  }

  /**
   * Map IndexField to SearchField
   */
  private mapFieldToSearchField(field: IndexField): SearchField {
    const isVectorField = field.type === 'Collection(Edm.Single)';

    if (isVectorField) {
      return {
        name: field.name,
        type: 'Collection(Edm.Single)',
        searchable: true,
        dimensions: field.dimensions,
        vectorSearchProfileName: field.vectorSearchProfile,
      } as SearchField;
    }

    const baseField = {
      name: field.name,
      type: field.type,
      key: field.key || false,
      searchable: field.searchable ?? field.type === 'Edm.String',
      filterable: field.filterable || false,
      sortable: field.sortable || false,
      facetable: field.facetable || false,
      retrievable: field.retrievable ?? true,
    };

    if (field.analyzer) {
      return {
        ...baseField,
        analyzerName: field.analyzer,
      } as SearchField;
    }

    return baseField as SearchField;
  }

  // ============================================================
  // DOCUMENT OPERATIONS
  // ============================================================

  /**
   * Upload documents to an index
   */
  async uploadDocuments(documents: SearchDocument[], indexName?: string): Promise<UploadResult> {
    const client = this.getSearchClient(indexName);

    if (!client) {
      return {
        success: false,
        successCount: 0,
        failedCount: documents.length,
        errors: [
          {
            key: 'all',
            errorMessage: 'Search client not initialized',
            statusCode: 500,
          },
        ],
      };
    }

    try {
      const result: IndexDocumentsResult = await client.uploadDocuments(documents);

      const errors = result.results
        .filter((r) => !r.succeeded)
        .map((r) => ({
          key: r.key || 'unknown',
          errorMessage: r.errorMessage || 'Unknown error',
          statusCode: r.statusCode || 500,
        }));

      return {
        success: errors.length === 0,
        successCount: result.results.filter((r) => r.succeeded).length,
        failedCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        successCount: 0,
        failedCount: documents.length,
        errors: [
          {
            key: 'all',
            errorMessage: this.getErrorMessage(error),
            statusCode: 500,
          },
        ],
      };
    }
  }

  /**
   * Merge or upload documents (upsert)
   */
  async upsertDocuments(documents: SearchDocument[], indexName?: string): Promise<UploadResult> {
    const client = this.getSearchClient(indexName);

    if (!client) {
      return {
        success: false,
        successCount: 0,
        failedCount: documents.length,
      };
    }

    try {
      const result = await client.mergeOrUploadDocuments(documents);

      const errors = result.results
        .filter((r) => !r.succeeded)
        .map((r) => ({
          key: r.key || 'unknown',
          errorMessage: r.errorMessage || 'Unknown error',
          statusCode: r.statusCode || 500,
        }));

      return {
        success: errors.length === 0,
        successCount: result.results.filter((r) => r.succeeded).length,
        failedCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        successCount: 0,
        failedCount: documents.length,
        errors: [
          {
            key: 'all',
            errorMessage: this.getErrorMessage(error),
            statusCode: 500,
          },
        ],
      };
    }
  }

  /**
   * Delete documents by ID
   */
  async deleteDocuments(documentIds: string[], indexName?: string): Promise<UploadResult> {
    const client = this.getSearchClient(indexName);

    if (!client) {
      return {
        success: false,
        successCount: 0,
        failedCount: documentIds.length,
      };
    }

    try {
      const documents: SearchDocument[] = documentIds.map((id) => ({ id }));
      const result = await client.deleteDocuments(documents);

      return {
        success: true,
        successCount: result.results.filter((r) => r.succeeded).length,
        failedCount: result.results.filter((r) => !r.succeeded).length,
      };
    } catch (error) {
      return {
        success: false,
        successCount: 0,
        failedCount: documentIds.length,
        errors: [
          {
            key: 'all',
            errorMessage: this.getErrorMessage(error),
            statusCode: 500,
          },
        ],
      };
    }
  }

  /**
   * Get a document by ID
   */
  async getDocument<T = SearchDocument>(documentId: string, indexName?: string): Promise<T | null> {
    const client = this.getSearchClient(indexName);

    if (!client) {
      return null;
    }

    try {
      const document = await client.getDocument(documentId);
      return document as T;
    } catch {
      return null;
    }
  }

  /**
   * Get document count in an index
   */
  async getDocumentCount(indexName?: string): Promise<number> {
    const client = this.getSearchClient(indexName);

    if (!client) {
      return 0;
    }

    try {
      return await client.getDocumentsCount();
    } catch {
      return 0;
    }
  }

  // ============================================================
  // SEARCH OPERATIONS
  // ============================================================

  /**
   * Perform a text search
   */
  async search<T = SearchDocument>(
    options: SearchOptions,
    indexName?: string
  ): Promise<SearchResults<T>> {
    const startTime = Date.now();
    const client = this.getSearchClient(indexName);

    if (!client) {
      return {
        success: false,
        results: [],
        error: 'Search client not initialized',
        errorCode: SearchErrorCode.AUTHENTICATION_ERROR,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const searchOptions = this.buildSearchOptions(options);
      const searchText = options.searchText || '*';

      const response = await client.search(searchText, searchOptions);

      const results: SearchResultItem<T>[] = [];
      for await (const result of response.results) {
        results.push({
          document: result.document as T,
          score: result.score || 0,
          rerankerScore: result.rerankerScore,
          highlights: this.normalizeHighlights(result.highlights),
          captions: this.normalizeCaptions(result.captions),
        });
      }

      return {
        success: true,
        results,
        totalCount: response.count,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        results: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Perform a vector similarity search
   */
  async vectorSearch<T = SearchDocument>(
    vector: number[],
    options: Omit<SearchOptions, 'vector'> = {},
    indexName?: string
  ): Promise<SearchResults<T>> {
    const startTime = Date.now();

    // Validate vector first (before checking client)
    if (!vector || vector.length === 0) {
      return {
        success: false,
        results: [],
        error: 'Vector is required for vector search',
        errorCode: SearchErrorCode.INVALID_VECTOR,
        durationMs: Date.now() - startTime,
      };
    }

    const client = this.getSearchClient(indexName);

    if (!client) {
      return {
        success: false,
        results: [],
        error: 'Search client not initialized',
        errorCode: SearchErrorCode.AUTHENTICATION_ERROR,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const vectorField = options.vectorField || 'contentVector';
      const k = options.vectorK || options.top || this.config.defaultTopK;

      const searchOptions = {
        ...this.buildSearchOptions(options),
        vectorSearchOptions: {
          queries: [
            {
              kind: 'vector' as const,
              vector,
              fields: [vectorField],
              kNearestNeighborsCount: k,
            },
          ],
        },
      };

      const response = await client.search('*', searchOptions);

      const results: SearchResultItem<T>[] = [];
      for await (const result of response.results) {
        results.push({
          document: result.document as T,
          score: result.score || 0,
          rerankerScore: result.rerankerScore,
        });
      }

      return {
        success: true,
        results,
        totalCount: response.count,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        results: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Perform a hybrid search (vector + keyword)
   */
  async hybridSearch<T = SearchDocument>(
    options: HybridSearchOptions,
    indexName?: string
  ): Promise<SearchResults<T>> {
    const startTime = Date.now();

    // Validate vector first (before checking client)
    if (!options.vector || options.vector.length === 0) {
      return {
        success: false,
        results: [],
        error: 'Vector is required for hybrid search',
        errorCode: SearchErrorCode.INVALID_VECTOR,
        durationMs: Date.now() - startTime,
      };
    }

    const client = this.getSearchClient(indexName);

    if (!client) {
      return {
        success: false,
        results: [],
        error: 'Search client not initialized',
        errorCode: SearchErrorCode.AUTHENTICATION_ERROR,
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const vectorField = options.vectorField || 'contentVector';
      const k = options.vectorK || options.top || this.config.defaultTopK;

      const searchOptions = {
        ...this.buildSearchOptions(options),
        vectorSearchOptions: {
          queries: [
            {
              kind: 'vector' as const,
              vector: options.vector,
              fields: [vectorField],
              kNearestNeighborsCount: k,
            },
          ],
        },
      };

      const response = await client.search(options.searchText, searchOptions);

      const results: SearchResultItem<T>[] = [];
      for await (const result of response.results) {
        results.push({
          document: result.document as T,
          score: result.score || 0,
          rerankerScore: result.rerankerScore,
          highlights: this.normalizeHighlights(result.highlights),
          captions: this.normalizeCaptions(result.captions),
        });
      }

      return {
        success: true,
        results,
        totalCount: response.count,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        results: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Perform a semantic search with reranking
   */
  async semanticSearch<T = SearchDocument>(
    searchText: string,
    options: SearchOptions = {},
    indexName?: string
  ): Promise<SearchResults<T>> {
    if (!this.config.enableSemanticSearch) {
      return {
        success: false,
        results: [],
        error: 'Semantic search is not enabled',
        errorCode: SearchErrorCode.INVALID_QUERY,
      };
    }

    return this.search<T>(
      {
        ...options,
        searchText,
        queryType: 'semantic',
        enableSemanticSearch: true,
      },
      indexName
    );
  }

  /**
   * Build Azure search options from our options
   */
  private buildSearchOptions(options: SearchOptions): Record<string, unknown> {
    const searchOptions: Record<string, unknown> = {
      top: options.top || this.config.defaultTopK,
      skip: options.skip,
      filter: options.filter,
      orderBy: options.orderBy,
      select: options.select,
      includeTotalCount: options.includeTotalCount ?? true,
      facets: options.facets,
      highlightFields: options.highlightFields?.join(','),
      searchMode: options.searchMode,
    };

    // Only set queryType if not semantic (semantic requires semanticSearchOptions)
    if (options.queryType && options.queryType !== 'semantic') {
      searchOptions.queryType = options.queryType;
    }

    if (options.enableSemanticSearch && options.semanticConfigName) {
      searchOptions.queryType = 'semantic';
      searchOptions.semanticSearchOptions = {
        configurationName: options.semanticConfigName,
        captions: { captionType: 'extractive' },
        answers: { answerType: 'extractive' },
      };
    }

    return searchOptions;
  }

  /**
   * Normalize highlights from Azure response
   */
  private normalizeHighlights(
    highlights: Record<string, string[] | undefined> | undefined
  ): Record<string, string[]> | undefined {
    if (!highlights) {
      return undefined;
    }

    const normalized: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(highlights)) {
      if (value) {
        normalized[key] = value;
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  /**
   * Normalize captions from Azure response
   */
  private normalizeCaptions(
    captions: Array<{ text?: string; highlights?: string }> | undefined
  ): SearchCaption[] | undefined {
    if (!captions || captions.length === 0) {
      return undefined;
    }

    return captions.map((c) => ({
      text: c.text || '',
      highlights: c.highlights,
    }));
  }

  // ============================================================
  // ERROR HANDLING
  // ============================================================

  /**
   * Get error code from error
   */
  private getErrorCode(error: unknown): SearchErrorCode {
    const err = error as Error & { code?: string; statusCode?: number };
    const message = err?.message?.toLowerCase() || '';
    const statusCode = err?.statusCode;

    if (statusCode === 404 || message.includes('not found')) {
      return SearchErrorCode.INDEX_NOT_FOUND;
    }

    if (statusCode === 409 || message.includes('already exists')) {
      return SearchErrorCode.INDEX_ALREADY_EXISTS;
    }

    if (statusCode === 401 || statusCode === 403) {
      return SearchErrorCode.AUTHENTICATION_ERROR;
    }

    if (statusCode === 429 || message.includes('rate limit')) {
      return SearchErrorCode.RATE_LIMITED;
    }

    if (statusCode === 503 || message.includes('unavailable')) {
      return SearchErrorCode.SERVICE_UNAVAILABLE;
    }

    if (message.includes('quota')) {
      return SearchErrorCode.QUOTA_EXCEEDED;
    }

    if (message.includes('invalid')) {
      return SearchErrorCode.INVALID_QUERY;
    }

    return SearchErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: unknown): string {
    const err = error as Error;
    return err?.message || 'Unknown error occurred';
  }

  // ============================================================
  // SERVICE STATUS
  // ============================================================

  /**
   * Get service status
   */
  getStatus(): SearchServiceStatus {
    return {
      isInitialized: this._isInitialized,
      endpoint: this.config.endpoint,
      defaultIndex: this.config.indexName,
      enableSemanticSearch: this.config.enableSemanticSearch,
      enableLogging: this.config.enableLogging,
    };
  }
}

// Export singleton instance
export const azureSearchService = new AzureSearchService();
