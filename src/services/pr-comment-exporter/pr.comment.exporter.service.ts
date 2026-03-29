import {
  PRCommentExporterConfig,
  ExportResult,
  ExportedPRComment,
  RepoSyncState,
  RawComment,
  PRSummaryItem,
  GitHubCommentFetchAdapter,
  CosmosExportAdapter,
  ExporterLoggingAdapter,
  ExporterTelemetryEntry,
  PRCommentExporterError,
  DEFAULT_CONFIG,
} from './pr.comment.exporter.types';

export class PRCommentExporterService {
  private readonly config: Required<PRCommentExporterConfig>;

  constructor(
    config: PRCommentExporterConfig = {},
    private readonly githubAdapter: GitHubCommentFetchAdapter,
    private readonly cosmosAdapter: CosmosExportAdapter,
    private readonly loggingAdapter?: ExporterLoggingAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Export PR comments for a repository.
   * Incremental sync: only processes PRs updated after lastSyncedAt.
   * Handles pagination, bot filtering, rate-limit errors, and Cosmos upserts.
   */
  async exportComments(owner: string, repo: string): Promise<ExportResult> {
    if (!owner?.trim()) {
      throw new PRCommentExporterError('owner is required', 'INVALID_INPUT');
    }
    if (!repo?.trim()) {
      throw new PRCommentExporterError('repo is required', 'INVALID_INPUT');
    }

    const startTime = Date.now();
    const exportedAt = new Date().toISOString();

    const syncState = await this._loadSyncState(owner, repo);
    const isIncremental = syncState?.lastSyncedAt != null;
    const since = syncState?.lastSyncedAt ?? null;

    let prsProcessed = 0;
    let commentsExported = 0;
    let commentsSkipped = 0;
    let commentsAlreadySynced = 0;
    let wasPaginated = false;
    let errorMessage: string | undefined;

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= this.config.maxPages) {
        let prs: PRSummaryItem[];

        try {
          prs = await this.githubAdapter.listPRs(owner, repo, page, this.config.pageSize);
        } catch (err: any) {
          if (this._isRateLimit(err)) {
            throw new PRCommentExporterError(
              `GitHub rate limit exceeded fetching PRs for ${owner}/${repo}`,
              'RATE_LIMIT_EXCEEDED',
              err
            );
          }
          throw new PRCommentExporterError(
            `Failed to fetch PRs for ${owner}/${repo}: ${err.message}`,
            'GITHUB_FETCH_FAILED',
            err
          );
        }

        if (prs.length === 0) {
          hasMore = false;
          break;
        }

        if (prs.length < this.config.pageSize) {
          hasMore = false;
        }

        const prsToProcess = since
          ? prs.filter((pr) => new Date(pr.updatedAt) > new Date(since))
          : prs;

        if (isIncremental && prsToProcess.length === 0) {
          hasMore = false;
          break;
        }

        for (const pr of prsToProcess) {
          const result = await this._processPR(owner, repo, pr);
          prsProcessed++;
          commentsExported += result.exported;
          commentsSkipped += result.skipped;
          commentsAlreadySynced += result.alreadySynced;
        }

        if (page === this.config.maxPages && hasMore) {
          wasPaginated = true;
        }

        page++;
      }
    } catch (err: any) {
      if (err instanceof PRCommentExporterError) throw err;
      errorMessage = err.message ?? String(err);
    }

    await this._saveSyncState(owner, repo, syncState, commentsExported, exportedAt);

    const result: ExportResult = {
      owner,
      repo,
      prsProcessed,
      commentsExported,
      commentsSkipped,
      commentsAlreadySynced,
      isIncremental,
      wasPaginated,
      durationMs: Date.now() - startTime,
      exportedAt,
      ...(errorMessage ? { errorMessage } : {}),
    };

    await this._logResult(owner, repo, result);

    return result;
  }

  /**
   * Returns true if the username matches any configured bot pattern.
   * Public for testing.
   */
  isBot(username: string): boolean {
    if (!username) return true;
    const lower = username.toLowerCase();
    return this.config.botPatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
  }

  /**
   * Returns true if the comment body is meaningful enough to export.
   * Public for testing.
   */
  isExportable(comment: RawComment): boolean {
    if (!comment.body?.trim()) return false;
    if (this.isBot(comment.user)) return false;
    return true;
  }

  buildCommentId(owner: string, repo: string, commentId: number): string {
    return `${owner}/${repo}/comments/${commentId}`.toLowerCase();
  }

  buildPartitionKey(owner: string, repo: string): string {
    return `${owner}/${repo}`.toLowerCase();
  }

  buildSyncStateId(owner: string, repo: string): string {
    return `sync-state/${owner}/${repo}`.toLowerCase();
  }

  private async _processPR(
    owner: string,
    repo: string,
    pr: PRSummaryItem
  ): Promise<{ exported: number; skipped: number; alreadySynced: number }> {
    let exported = 0;
    let skipped = 0;
    let alreadySynced = 0;

    let rawComments: RawComment[];

    try {
      rawComments = await this.githubAdapter.listPRComments(owner, repo, pr.number);
    } catch (err: any) {
      if (this._isRateLimit(err)) {
        throw new PRCommentExporterError(
          `GitHub rate limit exceeded fetching comments for PR #${pr.number}`,
          'RATE_LIMIT_EXCEEDED',
          err
        );
      }
      return { exported: 0, skipped: 0, alreadySynced: 0 };
    }

    for (const raw of rawComments) {
      if (!this.isExportable(raw)) {
        skipped++;
        continue;
      }

      const id = this.buildCommentId(owner, repo, raw.id);
      const partitionKey = this.buildPartitionKey(owner, repo);

      if (this.config.enableStorage) {
        try {
          const existing = await this.cosmosAdapter.readComment(id, partitionKey);
          if (existing) {
            alreadySynced++;
            continue;
          }
        } catch {}
      }

      const comment: ExportedPRComment = {
        id,
        partitionKey,
        commentId: raw.id,
        owner,
        repo,
        prNumber: pr.number,
        prTitle: pr.title,
        body: raw.body!.trim(),
        author: raw.user,
        source: raw.source,
        filePath: raw.path ?? null,
        diffLine: raw.line ?? null,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        exportedAt: new Date().toISOString(),
      };

      if (this.config.enableStorage) {
        try {
          await this.cosmosAdapter.upsertComment(comment);
          exported++;
        } catch (err: any) {
          skipped++;
        }
      } else {
        exported++;
      }
    }

    return { exported, skipped, alreadySynced };
  }

  private async _loadSyncState(owner: string, repo: string): Promise<RepoSyncState | null> {
    try {
      return await this.cosmosAdapter.readSyncState(owner, repo);
    } catch {
      return null;
    }
  }

  private async _saveSyncState(
    owner: string,
    repo: string,
    existing: RepoSyncState | null,
    newExports: number,
    exportedAt: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const state: RepoSyncState = {
        id: this.buildSyncStateId(owner, repo),
        partitionKey: this.buildPartitionKey(owner, repo),
        owner,
        repo,
        lastSyncedAt: exportedAt,
        totalExported: (existing?.totalExported ?? 0) + newExports,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.cosmosAdapter.upsertSyncState(state);
    } catch {}
  }

  private _isRateLimit(err: any): boolean {
    return (
      err?.status === 429 ||
      err?.code === 'RATE_LIMIT_EXCEEDED' ||
      (err?.message ?? '').toLowerCase().includes('rate limit')
    );
  }

  private async _logResult(owner: string, repo: string, result: ExportResult): Promise<void> {
    if (!this.loggingAdapter || !this.config.enableLogging) return;
    try {
      const entry: ExporterTelemetryEntry = {
        id: `export-${owner}-${repo}-${Date.now()}`,
        partitionKey: this.buildPartitionKey(owner, repo),
        type: 'pr-comment-export',
        owner,
        repo,
        prsProcessed: result.prsProcessed,
        commentsExported: result.commentsExported,
        commentsSkipped: result.commentsSkipped,
        isIncremental: result.isIncremental,
        durationMs: result.durationMs,
        timestamp: result.exportedAt,
      };
      await this.loggingAdapter.log(entry);
    } catch {}
  }
}
