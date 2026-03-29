import { ExportedPRComment } from '../pr-comment-exporter/pr.comment.exporter.types';

export interface TribalKnowledgeIndexerConfig {
  indexPrefix?: string;
  embeddingDimensions?: number;
  embeddingBatchSize?: number;
  incrementalOnly?: boolean;
  recencyWeight?: number;
  reactionWeight?: number;
  maxAgeDays?: number;
  enableCategorization?: boolean;
  enablePatternExtraction?: boolean;
}

export type CommentCategory =
  | 'bug' // identifies a bug or regression
  | 'performance' // performance concern or optimization
  | 'security' // security issue or recommendation
  | 'architecture' // structural or design feedback
  | 'style' // code style, naming, formatting
  | 'test' // test coverage or quality
  | 'documentation' // docs, comments, clarity
  | 'nitpick' // minor style issue (auto-fixable)
  | 'question' // question or clarification request
  | 'praise' // positive feedback
  | 'other'; // uncategorized

export interface TribalKnowledgeDocument {
  id: string;
  content: string;
  contentVector: number[];
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  author: string;
  source: string;
  filePath: string | null;
  category: CommentCategory;
  codePatterns: string[];
  relevanceScore: number;
  createdAt: string;
  indexedAt: string;
}

export interface IndexingResult {
  owner: string;
  repo: string;
  indexName: string;
  totalComments: number;
  indexed: number;
  skipped: number;
  failed: number;
  durationMs: number;
  indexedAt: string;
}

export interface TribalKnowledgeSearchOptions {
  category?: CommentCategory;
  filePath?: string;
  prNumber?: number;
  topK?: number;
  minRelevanceScore?: number;
}

export interface TribalKnowledgeSearchResult {
  document: Omit<TribalKnowledgeDocument, 'contentVector'>;
  searchScore: number;
}

export interface TribalKnowledgeSearchResponse {
  owner: string;
  repo: string;
  query: string;
  results: TribalKnowledgeSearchResult[];
  count: number;
}

export interface EmbeddingAdapter {
  embed(texts: string[]): Promise<number[][]>;
}

export interface SearchIndexAdapter {
  indexExists(indexName: string): Promise<boolean>;
  createIndex(schema: SearchIndexSchema): Promise<void>;
  upsertDocuments(indexName: string, documents: TribalKnowledgeDocument[]): Promise<void>;
  documentExists(indexName: string, documentId: string): Promise<boolean>;
  hybridSearch(
    indexName: string,
    query: string,
    vector: number[],
    options: { filter?: string; topK: number }
  ): Promise<Array<{ document: any; score: number }>>;
}

export interface CategorizationAdapter {
  classify(commentBody: string): Promise<ClassificationResult>;
}

export interface ClassificationResult {
  category: CommentCategory;
  codePatterns: string[];
}

export interface SearchIndexSchema {
  name: string;
  fields: SearchFieldSchema[];
  vectorSearch: {
    profiles: Array<{ name: string; algorithmConfigurationName: string }>;
    algorithms: Array<{ name: string; kind: string; parameters?: object }>;
  };
  semanticSearch?: {
    configurations: Array<{
      name: string;
      prioritizedFields: { contentFields: Array<{ fieldName: string }> };
    }>;
  };
}

export interface SearchFieldSchema {
  name: string;
  type: string;
  key?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  vectorSearchDimensions?: number;
  vectorSearchProfileName?: string;
}

export type TribalKnowledgeErrorCode =
  | 'INVALID_INPUT'
  | 'INDEX_CREATE_FAILED'
  | 'EMBEDDING_FAILED'
  | 'UPSERT_FAILED'
  | 'SEARCH_FAILED'
  | 'CLASSIFICATION_FAILED';

export class TribalKnowledgeError extends Error {
  constructor(
    message: string,
    public readonly code: TribalKnowledgeErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'TribalKnowledgeError';
  }
}

export const DEFAULT_INDEXER_CONFIG: Required<TribalKnowledgeIndexerConfig> = {
  indexPrefix: 'tribal',
  embeddingDimensions: 1536,
  embeddingBatchSize: 16,
  incrementalOnly: true,
  recencyWeight: 0.6,
  reactionWeight: 0.4,
  maxAgeDays: 365,
  enableCategorization: true,
  enablePatternExtraction: true,
};

export const ALL_CATEGORIES: readonly CommentCategory[] = Object.freeze([
  'bug',
  'performance',
  'security',
  'architecture',
  'style',
  'test',
  'documentation',
  'nitpick',
  'question',
  'praise',
  'other',
]);

export { ExportedPRComment };
