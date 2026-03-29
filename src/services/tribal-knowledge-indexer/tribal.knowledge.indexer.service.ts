import {
  TribalKnowledgeIndexerConfig,
  TribalKnowledgeDocument,
  IndexingResult,
  TribalKnowledgeSearchOptions,
  TribalKnowledgeSearchResponse,
  TribalKnowledgeSearchResult,
  EmbeddingAdapter,
  SearchIndexAdapter,
  CategorizationAdapter,
  SearchIndexSchema,
  CommentCategory,
  TribalKnowledgeError,
  DEFAULT_INDEXER_CONFIG,
  ExportedPRComment,
} from './tribal.knowledge.indexer.types';

export class TribalKnowledgeIndexerService {
  private readonly config: Required<TribalKnowledgeIndexerConfig>;

  constructor(
    config: TribalKnowledgeIndexerConfig = {},
    private readonly embeddingAdapter: EmbeddingAdapter,
    private readonly searchAdapter: SearchIndexAdapter,
    private readonly categorizationAdapter?: CategorizationAdapter
  ) {
    this.config = { ...DEFAULT_INDEXER_CONFIG, ...config };
  }

  /**
   * Index a batch of exported PR comments for a repository.
   * Generates embeddings via Azure OpenAI.
   * Creates dedicated index per repository.
   * Categorizes via LLM.
   * Extracts code patterns.
   * Incremental — skips already-indexed comments.
   * Scores by recency + reactions.
   */
  async indexComments(
    owner: string,
    repo: string,
    comments: ExportedPRComment[]
  ): Promise<IndexingResult> {
    if (!owner?.trim()) {
      throw new TribalKnowledgeError('owner is required', 'INVALID_INPUT');
    }
    if (!repo?.trim()) {
      throw new TribalKnowledgeError('repo is required', 'INVALID_INPUT');
    }

    const startTime = Date.now();
    const indexedAt = new Date().toISOString();
    const indexName = this.buildIndexName(owner, repo);

    await this._ensureIndex(indexName);

    let indexed = 0;
    let skipped = 0;
    let failed = 0;

    const toProcess: ExportedPRComment[] = [];
    for (const comment of comments) {
      if (this.config.incrementalOnly) {
        const docId = this.buildDocumentId(comment.commentId);
        let exists = false;
        try {
          exists = await this.searchAdapter.documentExists(indexName, docId);
        } catch {
          // Non-fatal: proceed to index
        }
        if (exists) {
          skipped++;
          continue;
        }
      }
      toProcess.push(comment);
    }

    const batches = this._batchArray(toProcess, this.config.embeddingBatchSize);

    for (const batch of batches) {
      const texts = batch.map((c) => c.body);

      let vectors: number[][];
      try {
        vectors = await this.embeddingAdapter.embed(texts);
      } catch (err: any) {
        failed += batch.length;
        continue;
      }

      const docs: TribalKnowledgeDocument[] = [];

      for (let i = 0; i < batch.length; i++) {
        const comment = batch[i];
        const vector = vectors[i];

        let category: CommentCategory = 'other';
        let codePatterns: string[] = [];

        if (this.config.enableCategorization && this.categorizationAdapter) {
          try {
            const result = await this.categorizationAdapter.classify(comment.body);
            category = result.category;
            if (this.config.enablePatternExtraction) {
              codePatterns = result.codePatterns;
            }
          } catch {
            // Non-fatal: fall back to defaults
          }
        }

        const relevanceScore = this.computeRelevanceScore(comment);

        const doc: TribalKnowledgeDocument = {
          id: this.buildDocumentId(comment.commentId),
          content: comment.body,
          contentVector: vector,
          owner: comment.owner,
          repo: comment.repo,
          prNumber: comment.prNumber,
          prTitle: comment.prTitle,
          author: comment.author,
          source: comment.source,
          filePath: comment.filePath,
          category,
          codePatterns,
          relevanceScore,
          createdAt: comment.createdAt,
          indexedAt,
        };

        docs.push(doc);
      }

      try {
        await this.searchAdapter.upsertDocuments(indexName, docs);
        indexed += docs.length;
      } catch (err: any) {
        failed += docs.length;
      }
    }

    return {
      owner,
      repo,
      indexName,
      totalComments: comments.length,
      indexed,
      skipped,
      failed,
      durationMs: Date.now() - startTime,
      indexedAt,
    };
  }

  /**
   * Search tribal knowledge for a repository.
   */
  async search(
    owner: string,
    repo: string,
    query: string,
    options: TribalKnowledgeSearchOptions = {}
  ): Promise<TribalKnowledgeSearchResponse> {
    if (!owner?.trim() || !repo?.trim()) {
      throw new TribalKnowledgeError('owner and repo are required', 'INVALID_INPUT');
    }
    if (!query?.trim()) {
      throw new TribalKnowledgeError('query is required', 'INVALID_INPUT');
    }

    const indexName = this.buildIndexName(owner, repo);
    const topK = options.topK ?? 5;

    // Embed the query
    let queryVector: number[];
    try {
      const vectors = await this.embeddingAdapter.embed([query]);
      queryVector = vectors[0];
    } catch (err: any) {
      throw new TribalKnowledgeError(
        `Failed to embed search query: ${err.message}`,
        'EMBEDDING_FAILED',
        err
      );
    }

    const filters: string[] = [];
    if (options.category) filters.push(`category eq '${options.category}'`);
    if (options.filePath) filters.push(`filePath eq '${options.filePath}'`);
    if (options.prNumber != null) filters.push(`prNumber eq ${options.prNumber}`);
    if (options.minRelevanceScore) filters.push(`relevanceScore ge ${options.minRelevanceScore}`);
    const filter = filters.length > 0 ? filters.join(' and ') : undefined;

    let raw: Array<{ document: any; score: number }>;
    try {
      raw = await this.searchAdapter.hybridSearch(indexName, query, queryVector, {
        filter,
        topK,
      });
    } catch (err: any) {
      throw new TribalKnowledgeError(
        `Search failed for ${owner}/${repo}: ${err.message}`,
        'SEARCH_FAILED',
        err
      );
    }

    const results: TribalKnowledgeSearchResult[] = raw.map((r) => {
      const { contentVector: _cv, ...rest } = r.document as TribalKnowledgeDocument;
      return { document: rest, searchScore: r.score };
    });

    return { owner, repo, query, results, count: results.length };
  }

  buildIndexName(owner: string, repo: string): string {
    const sanitized = `${this.config.indexPrefix}-${owner}-${repo}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return sanitized;
  }

  buildDocumentId(commentId: number): string {
    return `comment-${commentId}`;
  }

  /**
   * Relevance score = recencyWeight * recencyScore + reactionWeight * reactionScore.
   * reactionScore is 0 here (no reaction data from ExportedPRComment) — reserved for future.
   */
  computeRelevanceScore(comment: ExportedPRComment): number {
    const ageDays = (Date.now() - new Date(comment.createdAt).getTime()) / 86400000;
    const normalizedAge = Math.min(ageDays / this.config.maxAgeDays, 1);
    const recencyScore = 1 - normalizedAge;

    const reactionScore = 0;

    const score =
      this.config.recencyWeight * recencyScore + this.config.reactionWeight * reactionScore;

    return Math.max(0, Math.min(1, score));
  }

  buildIndexSchema(indexName: string): SearchIndexSchema {
    return {
      name: indexName,
      fields: [
        { name: 'id', type: 'Edm.String', key: true },
        { name: 'content', type: 'Edm.String', searchable: true },
        {
          name: 'contentVector',
          type: 'Collection(Edm.Single)',
          searchable: true,
          vectorSearchDimensions: this.config.embeddingDimensions,
          vectorSearchProfileName: 'tribal-hnsw-profile',
        },
        { name: 'owner', type: 'Edm.String', filterable: true },
        { name: 'repo', type: 'Edm.String', filterable: true },
        { name: 'prNumber', type: 'Edm.Int32', filterable: true, sortable: true },
        { name: 'prTitle', type: 'Edm.String', searchable: true },
        { name: 'author', type: 'Edm.String', filterable: true },
        { name: 'source', type: 'Edm.String', filterable: true },
        { name: 'filePath', type: 'Edm.String', filterable: true, searchable: true },
        { name: 'category', type: 'Edm.String', filterable: true },
        {
          name: 'codePatterns',
          type: 'Collection(Edm.String)',
          filterable: true,
          searchable: true,
        },
        { name: 'relevanceScore', type: 'Edm.Double', filterable: true, sortable: true },
        { name: 'createdAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
        { name: 'indexedAt', type: 'Edm.DateTimeOffset', sortable: true },
      ],
      vectorSearch: {
        profiles: [{ name: 'tribal-hnsw-profile', algorithmConfigurationName: 'tribal-hnsw' }],
        algorithms: [
          {
            name: 'tribal-hnsw',
            kind: 'hnsw',
            parameters: { m: 4, efConstruction: 400, efSearch: 500 },
          },
        ],
      },
      semanticSearch: {
        configurations: [
          {
            name: 'tribal-semantic',
            prioritizedFields: { contentFields: [{ fieldName: 'content' }] },
          },
        ],
      },
    };
  }

  private async _ensureIndex(indexName: string): Promise<void> {
    let exists: boolean;
    try {
      exists = await this.searchAdapter.indexExists(indexName);
    } catch (err: any) {
      throw new TribalKnowledgeError(
        `Failed to check index existence for ${indexName}: ${err.message}`,
        'INDEX_CREATE_FAILED',
        err
      );
    }

    if (!exists) {
      const schema = this.buildIndexSchema(indexName);
      try {
        await this.searchAdapter.createIndex(schema);
      } catch (err: any) {
        throw new TribalKnowledgeError(
          `Failed to create index ${indexName}: ${err.message}`,
          'INDEX_CREATE_FAILED',
          err
        );
      }
    }
  }

  private _batchArray<T>(arr: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      batches.push(arr.slice(i, i + size));
    }
    return batches;
  }
}
