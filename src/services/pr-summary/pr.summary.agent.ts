import {
  PRSummaryAgentConfig,
  PRSummary,
  GenerationResult,
  SummaryTrigger,
  SummaryStatus,
  ChunkSummary,
  FoundryRunResult,
  PRSummaryFoundryError,
  PRSummaryContextError,
} from './pr.summary.types';
import { ExtractedPRContext } from '../pr-context/pr.context.types';
import { RenderedPrompt } from '../prompt-templates/prompt.template.types';

/** Wraps PRContextExtractorService */
export interface ContextAdapter {
  extractContext(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ context: ExtractedPRContext; fromCache: boolean }>;
}

/** Wraps PromptTemplateService */
export interface PromptAdapter {
  renderPrompt(context: ExtractedPRContext): Promise<RenderedPrompt>;
  renderErrorPrompt(prNumber: number, prUrl: string): Promise<string>;
}

/** Wraps Azure AI Foundry Agent Service */
export interface FoundryAdapter {
  runAgent(agentId: string, systemPrompt: string, userMessage: string): Promise<FoundryRunResult>;
  isAvailable(): Promise<boolean>;
}

/** Wraps CosmosDBService for summary caching */
export interface CacheAdapter {
  read<T>(
    container: string,
    id: string,
    partitionKey: string
  ): Promise<{ success: boolean; data?: T }>;
  upsert<T extends { id: string }>(container: string, item: T): Promise<{ success: boolean }>;
}

const DEFAULT_CONFIG: Required<PRSummaryAgentConfig> = {
  foundryAgentId: '',
  foundryProjectId: '',
  deployment: 'gpt-4o',
  maxOutputTokens: 2000,
  largeprThreshold: 6000,
  chunkSize: 3000,
  enableCaching: true,
  cacheTtlMs: 60 * 60 * 1000,
  refreshOnUpdate: true,
  enableLogging: true,
  cacheContainer: 'pr-summaries',
};

export class PRSummaryAgent {
  private readonly config: Required<PRSummaryAgentConfig>;

  constructor(
    config: PRSummaryAgentConfig = {},
    private readonly contextAdapter: ContextAdapter,
    private readonly promptAdapter: PromptAdapter,
    private readonly foundryAdapter: FoundryAdapter,
    private readonly cacheAdapter: CacheAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Main entry point — generates (or returns cached) summary for a PR.
   * AC-2: Triggered by command or webhook.
   * AC-3: Fetches PR data via context adapter (MCP-backed).
   * AC-4: Extracts structured context.
   * AC-5: Generates summary via Foundry Agent.
   * AC-6: Caches result in Cosmos DB.
   * AC-7: Refreshes on PR updates.
   * AC-8: Chunks large PRs.
   */

  async generateSummary(
    owner: string,
    repo: string,
    prNumber: number,
    trigger: SummaryTrigger = 'command'
  ): Promise<GenerationResult> {
    const startMs = Date.now();
    const cacheKey = this.buildCacheKey(owner, repo, prNumber);

    if (this.config.enableCaching) {
      const cached = await this.readFromCache(cacheKey, `${owner}/${repo}`);
      if (cached) {
        if (!this.isStale(cached)) {
          this.log(`Cache hit for PR #${prNumber} in ${owner}/${repo}`);
          return { summary: cached, fromCache: true, durationMs: 0, contextFromCache: true };
        }
        this.log(`Cache stale for PR #${prNumber} — regenerating`);
      }
    }

    let context: ExtractedPRContext;
    let contextFromCache = false;
    try {
      const result = await this.contextAdapter.extractContext(owner, repo, prNumber);
      context = result.context;
      contextFromCache = result.fromCache;
    } catch (err) {
      throw new PRSummaryContextError(prNumber, repo, String(err));
    }

    let summary: PRSummary;
    if (this.requiresChunking(context)) {
      this.log(`PR #${prNumber} requires chunking (${context.tokenBudget.totalTokens} tokens)`);
      summary = await this.generateChunkedSummary(
        context,
        owner,
        repo,
        prNumber,
        trigger,
        cacheKey
      );
    } else {
      summary = await this.generateStandardSummary(
        context,
        owner,
        repo,
        prNumber,
        trigger,
        cacheKey
      );
    }

    // AC-6: Store in Cosmos DB cache
    if (this.config.enableCaching) {
      await this.writeToCache(summary);
    }

    this.log(
      `Generated summary for PR #${prNumber} in ${owner}/${repo} — ` +
        `${summary.wasChunked ? `${summary.chunkSummaries.length} chunks` : 'single pass'}, ` +
        `${Date.now() - startMs}ms`
    );

    return {
      summary,
      fromCache: false,
      durationMs: Date.now() - startMs,
      contextFromCache,
    };
  }

  /**
   * AC-7: Forces regeneration of a summary, bypassing cache.
   */
  async refreshSummary(owner: string, repo: string, prNumber: number): Promise<GenerationResult> {
    // Invalidate cache entry then regenerate
    await this.invalidateCache(owner, repo, prNumber);
    return this.generateSummary(owner, repo, prNumber, 'command');
  }

  /**
   * Returns the cached summary without regenerating. Returns null if not cached.
   */
  async getCachedSummary(owner: string, repo: string, prNumber: number): Promise<PRSummary | null> {
    if (!this.config.enableCaching) return null;
    return this.readFromCache(this.buildCacheKey(owner, repo, prNumber), `${owner}/${repo}`);
  }

  private async generateStandardSummary(
    context: ExtractedPRContext,
    owner: string,
    repo: string,
    prNumber: number,
    trigger: SummaryTrigger,
    cacheKey: string
  ): Promise<PRSummary> {
    const renderedPrompt = await this.promptAdapter.renderPrompt(context);

    let runResult: FoundryRunResult;
    let status: SummaryStatus = 'complete';
    let errorMessage: string | null = null;
    let summaryText = '';
    let threadId: string | null = null;

    try {
      const foundryAvailable = await this.foundryAdapter.isAvailable();
      if (foundryAvailable && this.config.foundryAgentId) {
        runResult = await this.foundryAdapter.runAgent(
          this.config.foundryAgentId,
          renderedPrompt.systemPrompt,
          renderedPrompt.contextPrompt
        );
        summaryText = runResult.content;
        threadId = runResult.threadId;
      } else {
        summaryText = this.buildFallbackSummary(context, renderedPrompt);
      }
    } catch (err) {
      status = 'failed';
      errorMessage = String(err);
      summaryText = await this.promptAdapter.renderErrorPrompt(prNumber, context.prUrl);
    }

    return this.buildSummaryRecord({
      cacheKey,
      owner,
      repo,
      prNumber,
      context,
      summaryText,
      chunkSummaries: [],
      wasChunked: false,
      threadId,
      templateVersion: renderedPrompt.templateVersions.context,
      abVariant: renderedPrompt.abVariant,
      status,
      errorMessage,
      trigger,
    });
  }

  private async generateChunkedSummary(
    context: ExtractedPRContext,
    owner: string,
    repo: string,
    prNumber: number,
    trigger: SummaryTrigger,
    cacheKey: string
  ): Promise<PRSummary> {
    const chunks = this.splitContextIntoChunks(context);
    const chunkSummaries: ChunkSummary[] = [];
    let lastThreadId: string | null = null;
    let overallStatus: SummaryStatus = 'complete';
    let lastTemplateVersion = '1.0.0';
    let lastAbVariant: string | null = null;

    const foundryAvailable = await this.foundryAdapter.isAvailable();

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkContext = this.buildChunkContext(context, chunk, i, chunks.length);

      try {
        const renderedPrompt = await this.promptAdapter.renderPrompt(chunkContext);
        lastTemplateVersion = renderedPrompt.templateVersions.context;
        lastAbVariant = renderedPrompt.abVariant;

        let chunkText = '';
        if (foundryAvailable && this.config.foundryAgentId) {
          const runResult = await this.foundryAdapter.runAgent(
            this.config.foundryAgentId,
            renderedPrompt.systemPrompt,
            `[Chunk ${i + 1}/${chunks.length}]\n\n${renderedPrompt.contextPrompt}`
          );
          chunkText = runResult.content;
          lastThreadId = runResult.threadId;
        } else {
          chunkText = this.buildFallbackSummary(chunkContext, renderedPrompt);
        }

        chunkSummaries.push({
          chunkIndex: i,
          files: chunk.files,
          content: chunkText,
          tokenCount: this.estimateTokens(chunkText),
        });
      } catch (err) {
        overallStatus = 'partial';
        chunkSummaries.push({
          chunkIndex: i,
          files: chunk.files,
          content: `[Chunk ${i + 1} failed: ${String(err)}]`,
          tokenCount: 0,
        });
      }
    }

    const mergedSummary = this.mergeChunkSummaries(chunkSummaries, context);

    return this.buildSummaryRecord({
      cacheKey,
      owner,
      repo,
      prNumber,
      context,
      summaryText: mergedSummary,
      chunkSummaries,
      wasChunked: true,
      threadId: lastThreadId,
      templateVersion: lastTemplateVersion,
      abVariant: lastAbVariant,
      status: overallStatus,
      errorMessage: null,
      trigger,
    });
  }

  /**
   * Returns true when the PR context exceeds the large-PR token threshold.
   */
  requiresChunking(context: ExtractedPRContext): boolean {
    return context.tokenBudget.totalTokens > this.config.largeprThreshold;
  }

  /**
   * Splits a large PR's diffs into chunks under chunkSize tokens.
   */
  splitContextIntoChunks(
    context: ExtractedPRContext
  ): Array<{ files: string[]; diffTokens: number }> {
    const chunks: Array<{ files: string[]; diffTokens: number }> = [];
    let currentFiles: string[] = [];
    let currentTokens = 0;

    for (const diff of context.parsedDiffs) {
      const diffText = JSON.stringify(diff);
      const diffTokens = this.estimateTokens(diffText);

      if (currentTokens + diffTokens > this.config.chunkSize && currentFiles.length > 0) {
        chunks.push({ files: currentFiles, diffTokens: currentTokens });
        currentFiles = [];
        currentTokens = 0;
      }

      currentFiles.push(diff.path);
      currentTokens += diffTokens;
    }

    if (currentFiles.length > 0) {
      chunks.push({ files: currentFiles, diffTokens: currentTokens });
    }

    // Always return at least one chunk
    if (chunks.length === 0) {
      chunks.push({
        files: context.changedFiles.map((f) => f.path),
        diffTokens: context.tokenBudget.totalTokens,
      });
    }

    return chunks;
  }

  /**
   * Builds a reduced ExtractedPRContext for a single chunk.
   */
  buildChunkContext(
    original: ExtractedPRContext,
    chunk: { files: string[]; diffTokens: number },
    chunkIndex: number,
    totalChunks: number
  ): ExtractedPRContext {
    const chunkFiles = new Set(chunk.files);
    const filteredDiffs = original.parsedDiffs.filter((d) => chunkFiles.has(d.path));
    const filteredChanged = original.changedFiles.filter((f) => chunkFiles.has(f.path));

    return {
      ...original,
      prTitle: `${original.prTitle} [Chunk ${chunkIndex + 1}/${totalChunks}]`,
      parsedDiffs: filteredDiffs,
      changedFiles: filteredChanged,
      tokenBudget: {
        ...original.tokenBudget,
        totalTokens: chunk.diffTokens,
        wasTruncated: false,
      },
    };
  }

  /**
   * Merges per-chunk summaries into a final unified markdown document.
   */
  mergeChunkSummaries(chunks: ChunkSummary[], context: ExtractedPRContext): string {
    const header = [
      `## PR #${context.prNumber}: ${context.prTitle}`,
      `*Large PR — summarised in ${chunks.length} chunks*`,
      '',
    ].join('\n');

    const body = chunks
      .map((c, i) => {
        const fileList = c.files.slice(0, 5).join(', ') + (c.files.length > 5 ? '...' : '');
        return `### Chunk ${i + 1}/${chunks.length} (${c.files.length} files: ${fileList})\n\n${c.content}`;
      })
      .join('\n\n---\n\n');

    return `${header}\n${body}`;
  }

  /**
   * Builds a minimal summary when Foundry is unavailable.
   * Used in development/test environments.
   */
  buildFallbackSummary(context: ExtractedPRContext, renderedPrompt: RenderedPrompt): string {
    const fileLines = context.changedFiles
      .slice(0, 10)
      .map(
        (f) =>
          `- ${f.changeType === 'added' ? '➕' : f.changeType === 'removed' ? '➖' : '✏️'} ${f.path}`
      )
      .join('\n');

    const patternLines =
      context.detectedPatterns.length > 0
        ? context.detectedPatterns.map((p) => `- ${p.type} (${p.occurrences}x)`).join('\n')
        : '- None detected';

    const issueLines =
      context.issueReferences.length > 0
        ? context.issueReferences.map((r) => `- #${r.number} (${r.source})`).join('\n')
        : '- None';

    return [
      `## Summary`,
      `PR #${context.prNumber} by ${context.prAuthor}: ${context.prTitle}`,
      ``,
      `## Changes`,
      fileLines,
      ``,
      `## Code Patterns`,
      patternLines,
      ``,
      `## Linked Issues`,
      issueLines,
      ``,
      `*[Fallback summary — Foundry agent unavailable. Template: ${renderedPrompt.templateVersions.context}, Size: ${renderedPrompt.prSize}]*`,
    ].join('\n');
  }

  /**
   * Returns true if the cached summary is stale relative to the PR's last update.
   */
  isStale(summary: PRSummary): boolean {
    if (!this.config.refreshOnUpdate) return false;
    // Expired TTL
    if (new Date(summary.expiresAt) < new Date()) return true;
    // PR was updated after summary was generated
    if (summary.prUpdatedAt && new Date(summary.prUpdatedAt) > new Date(summary.generatedAt)) {
      return true;
    }
    return false;
  }

  private async readFromCache(cacheKey: string, partitionKey: string): Promise<PRSummary | null> {
    try {
      const result = await this.cacheAdapter.read<PRSummary>(
        this.config.cacheContainer,
        cacheKey,
        partitionKey
      );
      if (!result.success || !result.data) return null;
      if (new Date(result.data.expiresAt) < new Date()) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  private async writeToCache(summary: PRSummary): Promise<void> {
    try {
      await this.cacheAdapter.upsert(this.config.cacheContainer, summary);
    } catch (err) {
      this.log(`Cache write failed: ${String(err)}`);
    }
  }

  async invalidateCache(owner: string, repo: string, prNumber: number): Promise<void> {
    const cacheKey = this.buildCacheKey(owner, repo, prNumber);
    try {
      await this.cacheAdapter.upsert(this.config.cacheContainer, {
        id: cacheKey,
        owner,
        repo,
        prNumber,
        expiresAt: new Date(0).toISOString(),
      } as unknown as PRSummary);
    } catch {}
  }

  buildCacheKey(owner: string, repo: string, prNumber: number): string {
    return `pr-summary-${owner}-${repo}-${prNumber}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private buildSummaryRecord(params: {
    cacheKey: string;
    owner: string;
    repo: string;
    prNumber: number;
    context: ExtractedPRContext;
    summaryText: string;
    chunkSummaries: ChunkSummary[];
    wasChunked: boolean;
    threadId: string | null;
    templateVersion: string;
    abVariant: string | null;
    status: SummaryStatus;
    errorMessage: string | null;
    trigger: SummaryTrigger;
  }): PRSummary {
    const now = new Date();
    return {
      id: params.cacheKey,
      owner: params.owner,
      repo: params.repo,
      prNumber: params.prNumber,
      prTitle: params.context.prTitle,
      prState: params.context.prState,
      summary: params.summaryText,
      chunkSummaries: params.chunkSummaries,
      wasChunked: params.wasChunked,
      foundryAgentId: this.config.foundryAgentId || null,
      foundryThreadId: params.threadId,
      templateVersion: params.templateVersion,
      abVariant: params.abVariant,
      status: params.status,
      errorMessage: params.errorMessage,
      trigger: params.trigger,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.cacheTtlMs).toISOString(),
      prUpdatedAt: params.context.extractedAt,
    };
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[PRSummaryAgent] ${message}`);
    }
  }
}
