/**
 * Azure AI Search Service Configuration
 */
export interface SearchConfig {
  endpoint?: string;
  indexName?: string;
  apiVersion?: string;
  enableSemanticSearch?: boolean;
  defaultTopK?: number;
  enableLogging?: boolean;
}

/**
 * Vector field configuration
 */
export interface VectorFieldConfig {
  name: string;
  dimensions: number;
  vectorSearchProfile: string;
}

/**
 * Index field definition
 */
export interface IndexField {
  name: string;
  type: string;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  facetable?: boolean;
  key?: boolean;
  retrievable?: boolean;
  analyzer?: string;
  dimensions?: number;
  vectorSearchProfile?: string;
}

/**
 * Supported index field types
 */
export type IndexFieldType =
  | 'Edm.String'
  | 'Edm.Int32'
  | 'Edm.Int64'
  | 'Edm.Double'
  | 'Edm.Boolean'
  | 'Edm.DateTimeOffset'
  | 'Collection(Edm.String)'
  | 'Collection(Edm.Single)';

/**
 * Index configuration for creation
 */
export interface IndexConfig {
  name: string;
  fields: IndexField[];
  semanticConfigName?: string;
  semanticTitleField?: string;
  semanticContentFields?: string[];
  semanticKeywordFields?: string[];
  vectorProfiles?: VectorProfile[];
  vectorAlgorithms?: VectorAlgorithm[];
}

/**
 * Vector search profile
 */
export interface VectorProfile {
  name: string;
  algorithmConfigurationName: string;
}

/**
 * Vector search algorithm configuration
 */
export interface VectorAlgorithm {
  name: string;
  kind: 'hnsw' | 'exhaustiveKnn';
  parameters?: {
    metric?: 'cosine' | 'euclidean' | 'dotProduct';
    m?: number;
    efConstruction?: number;
    efSearch?: number;
  };
}

/**
 * Document to upload/index
 */
export interface SearchDocument {
  id: string;
  content?: string;
  contentVector?: number[];
  [key: string]: unknown;
}

/**
 * Search query options
 */
export interface SearchOptions {
  searchText?: string;
  vector?: number[];
  vectorField?: string;
  top?: number;
  skip?: number;
  filter?: string;
  orderBy?: string[];
  select?: string[];
  enableSemanticSearch?: boolean;
  semanticConfigName?: string;
  searchMode?: 'any' | 'all';
  queryType?: 'simple' | 'full' | 'semantic';
  minimumCoverage?: number;
  includeTotalCount?: boolean;
  facets?: string[];
  highlightFields?: string[];
  vectorK?: number;
}

/**
 * Hybrid search options (vector + keyword)
 */
export interface HybridSearchOptions extends SearchOptions {
  searchText: string;
  vector: number[];
  vectorWeight?: number;
}

/**
 * Search result item
 */
export interface SearchResultItem<T = SearchDocument> {
  document: T;
  score: number;
  rerankerScore?: number;
  highlights?: Record<string, string[]>;
  captions?: SearchCaption[];
}

/**
 * Semantic search caption
 */
export interface SearchCaption {
  text: string;
  highlights?: string;
}

/**
 * Search Results
 */
export interface SearchResults<T = SearchDocument> {
  success: boolean;
  results: SearchResultItem<T>[];
  totalCount?: number;
  facets?: Record<string, FacetResult[]>;
  error?: string;
  errorCode?: SearchErrorCode;
  durationMs?: number;
}

/**
 * Facet result
 */
export interface FacetResult {
  value: string;
  count: number;
}

/**
 * Index operation result
 */
export interface IndexResult {
  success: boolean;
  indexName?: string;
  error?: string;
  errorCode?: SearchErrorCode;
}

/**
 * Document upload result
 */
export interface UploadResult {
  success: boolean;
  successCount: number;
  failedCount: number;
  errors?: UploadError[];
}

/**
 * Upload error details
 */
export interface UploadError {
  key: string;
  errorMessage: string;
  statusCode?: number;
}

/**
 * Error Codes
 */
export enum SearchErrorCode {
  INDEX_NOT_FOUND = 'INDEX_NOT_FOUND',
  INDEX_ALREADY_EXISTS = 'INDEX_ALREADY_EXISTS',
  DOCUMENT_NOT_FOUND = 'DOCUMENT_NOT_FOUND',
  INVALID_QUERY = 'INVALID_QUERY',
  INVALID_VECTOR = 'INVALID_VECTOR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  RATE_LIMITED = 'RATE_LIMITED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Index statistics
 */
export interface IndexStats {
  documentCount: number;
  storageSize: number;
}

/**
 * Service Status
 */
export interface SearchServiceStatus {
  isInitialized: boolean;
  endpoint: string;
  defaultIndex: string;
  enableSemanticSearch: boolean;
  enableLogging: boolean;
}

/**
 * Predefined index schemas
 */
export const IndexSchemas = {
  DOCUMENTATION: {
    name: 'documentation',
    fields: [
      { name: 'id', type: 'Edm.String' as const, key: true, filterable: true },
      {
        name: 'content',
        type: 'Edm.String' as const,
        searchable: true,
        analyzer: 'en.microsoft',
      },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)' as const,
        dimensions: 3072,
        vectorSearchProfile: 'vector-profile',
      },
      {
        name: 'title',
        type: 'Edm.String' as const,
        searchable: true,
        filterable: true,
        sortable: true,
      },
      {
        name: 'library',
        type: 'Edm.String' as const,
        filterable: true,
        facetable: true,
      },
      {
        name: 'version',
        type: 'Edm.String' as const,
        filterable: true,
        facetable: true,
      },
      {
        name: 'section',
        type: 'Edm.String' as const,
        filterable: true,
        facetable: true,
      },
      { name: 'url', type: 'Edm.String' as const, retrievable: true },
      {
        name: 'lastUpdated',
        type: 'Edm.DateTimeOffset' as const,
        filterable: true,
        sortable: true,
      },
    ],
  },

  TRIBAL_KNOWLEDGE: {
    name: 'tribal-knowledge',
    fields: [
      { name: 'id', type: 'Edm.String' as const, key: true, filterable: true },
      {
        name: 'content',
        type: 'Edm.String' as const,
        searchable: true,
        analyzer: 'en.microsoft',
      },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)' as const,
        dimensions: 3072,
        vectorSearchProfile: 'vector-profile',
      },
      {
        name: 'source',
        type: 'Edm.String' as const,
        filterable: true,
        facetable: true,
      },
      { name: 'author', type: 'Edm.String' as const, filterable: true },
      { name: 'prNumber', type: 'Edm.Int32' as const, filterable: true },
      {
        name: 'repository',
        type: 'Edm.String' as const,
        filterable: true,
        facetable: true,
      },
      {
        name: 'createdAt',
        type: 'Edm.DateTimeOffset' as const,
        filterable: true,
        sortable: true,
      },
    ],
  },
} as const;
