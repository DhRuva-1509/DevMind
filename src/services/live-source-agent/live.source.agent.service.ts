import {
  LiveSourceAgentConfig,
  PinnedSource,
  PinSourceInput,
  PinResult,
  UnpinResult,
  InjectedContext,
  InjectContextOptions,
  LiveSourceStatusBarState,
  LiveSourceCrawlerAdapter,
  LiveSourceIndexAdapter,
  LiveSourceEmbeddingAdapter,
  LiveSourceStateAdapter,
  LiveSourceProgressAdapter,
  LiveSourceStatusBarAdapter,
  LiveSourceError,
  PINNED_SOURCE_SYSTEM_PREFIX,
  STATUS_BAR_PREFIX,
  MAX_PINNED_SOURCES,
  DEFAULT_CRAWL_DEPTH,
  DEFAULT_MAX_PAGES,
  DEFAULT_PRIORITY_WEIGHT,
} from './live.source.agent.types';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function deriveLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== '/' ? parsed.pathname.replace(/\/$/, '') : '');
  } catch {
    return url.slice(0, 60);
  }
}

function deriveLabelFromFilename(filename: string): string {
  const base = filename.split('/').pop() ?? filename;
  return base.replace(/\.[^.]+$/, '');
}

function generateId(): string {
  return crypto.randomUUID();
}

export class LiveSourceAgent {
  private readonly _maxSources: number;
  private readonly _priorityWeight: number;
  private readonly _crawlDepth: number;
  private readonly _maxPages: number;
  private readonly _topKPerSource: number;
  private readonly _maxInjectedTokens: number;
  private readonly _log: boolean;

  private _sources: PinnedSource[] = [];
  private _loaded = false;

  constructor(
    config: LiveSourceAgentConfig,
    private readonly _crawlerAdapter: LiveSourceCrawlerAdapter,
    private readonly _indexAdapter: LiveSourceIndexAdapter,
    private readonly _embeddingAdapter: LiveSourceEmbeddingAdapter,
    private readonly _stateAdapter: LiveSourceStateAdapter,
    private readonly _statusBarAdapter?: LiveSourceStatusBarAdapter
  ) {
    this._maxSources = config.maxPinnedSources ?? MAX_PINNED_SOURCES;
    this._priorityWeight = config.priorityWeight ?? DEFAULT_PRIORITY_WEIGHT;
    this._crawlDepth = config.crawlDepth ?? DEFAULT_CRAWL_DEPTH;
    this._maxPages = config.maxPages ?? DEFAULT_MAX_PAGES;
    this._topKPerSource = config.topKPerSource ?? 3;
    this._maxInjectedTokens = config.maxInjectedTokens ?? 2000;
    this._log = config.enableLogging ?? true;
  }

  async pinSource(
    input: PinSourceInput,
    progressAdapter?: LiveSourceProgressAdapter
  ): Promise<PinResult> {
    // Input validation
    if (input.type === 'url') {
      if (!input.url || !input.url.trim()) {
        throw new LiveSourceError('URL must not be empty.', 'INVALID_INPUT', input.url);
      }
      try {
        const parsed = new URL(input.url);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('bad protocol');
        }
      } catch {
        throw new LiveSourceError(
          `Invalid URL: "${input.url}". Must be a valid http or https URL.`,
          'INVALID_INPUT',
          input.url
        );
      }
    } else {
      if (!input.buffer || input.buffer.length === 0) {
        throw new LiveSourceError('PDF buffer must not be empty.', 'INVALID_INPUT');
      }
      if (!input.filename || !input.filename.trim()) {
        throw new LiveSourceError('PDF filename must not be empty.', 'INVALID_INPUT');
      }
    }

    await this._ensureLoaded();

    const sourceRef = input.type === 'url' ? input.url : input.filename;
    const label =
      (input as { label?: string }).label ??
      (input.type === 'url'
        ? deriveLabelFromUrl(input.url)
        : deriveLabelFromFilename(input.filename));

    const existing = this._sources.find((s) => s.active && s.sourceRef === sourceRef);
    const isRefresh = !!existing;

    if (!isRefresh) {
      const activeSources = this._sources.filter((s) => s.active);
      if (activeSources.length >= this._maxSources) {
        throw new LiveSourceError(
          `Maximum pinned sources reached (${this._maxSources}). Unpin one before adding a new source.`,
          'MAX_SOURCES_REACHED',
          sourceRef
        );
      }
    }

    const start = Date.now();

    progressAdapter?.report(`Crawling ${label}…`, 10);
    let chunks: Array<{
      content: string;
      sourceRef: string;
      sourceType: 'url' | 'pdf';
      chunkIndex: number;
      tokenCount: number;
    }>;

    try {
      if (input.type === 'url') {
        chunks = await this._crawlerAdapter.crawlUrl(input.url, {
          depth: this._crawlDepth,
          maxPages: this._maxPages,
        });
      } else {
        chunks = await this._crawlerAdapter.parsePdf(input.buffer, input.filename);
      }
    } catch (err) {
      throw new LiveSourceError(
        `Failed to crawl/parse source "${label}".`,
        'CRAWL_FAILED',
        sourceRef,
        err
      );
    }

    if (chunks.length === 0) {
      throw new LiveSourceError(
        `No content could be extracted from "${label}". The source may be empty or unsupported.`,
        'CRAWL_FAILED',
        sourceRef
      );
    }

    progressAdapter?.report(`Indexing ${chunks.length} chunks…`, 40);

    const sessionId = isRefresh ? existing!.sessionId : `live-${generateId()}`;
    let indexName: string;

    try {
      const session = await this._indexAdapter.createSession(sessionId, label);
      indexName = session.indexName;
    } catch (err) {
      throw new LiveSourceError(
        `Failed to create search index for "${label}".`,
        'INDEX_FAILED',
        sourceRef,
        err
      );
    }

    let uploaded = 0;
    try {
      const result = await this._indexAdapter.upsertChunks(sessionId, chunks);
      uploaded = result.uploaded;
    } catch (err) {
      throw new LiveSourceError(
        `Failed to index chunks for "${label}".`,
        'INDEX_FAILED',
        sourceRef,
        err
      );
    }

    progressAdapter?.report(`Indexed ${uploaded} chunks.`, 40);

    const totalTokens = chunks.reduce((s, c) => s + c.tokenCount, 0);
    const pagesCrawled = input.type === 'url' ? new Set(chunks.map((c) => c.sourceRef)).size : 0;

    const record: PinnedSource = {
      id: isRefresh ? existing!.id : generateId(),
      label,
      sourceRef,
      sourceType: input.type,
      sessionId,
      indexName,
      chunkCount: uploaded,
      totalTokens,
      pinnedAt: isRefresh ? existing!.pinnedAt : new Date().toISOString(),
      priorityWeight: this._priorityWeight,
      active: true,
    };

    if (isRefresh) {
      this._sources = this._sources.map((s) => (s.id === existing!.id ? record : s));
    } else {
      this._sources = [...this._sources, record];
    }

    await this._stateAdapter.save(this._sources);
    this._updateStatusBar();

    if (this._log) {
      console.log(
        `[LiveSourceAgent] Pinned "${label}" — ${uploaded} chunks, ${pagesCrawled} pages, ${Date.now() - start}ms`
      );
    }

    progressAdapter?.report(`Done. "${label}" is now pinned.`, 10);

    return {
      source: record,
      refreshed: isRefresh,
      chunksIndexed: uploaded,
      pagesCrawled,
      durationMs: Date.now() - start,
    };
  }

  async unpinSource(id: string): Promise<UnpinResult> {
    await this._ensureLoaded();

    const source = this._sources.find((s) => s.id === id);
    if (!source) {
      return { id, label: id, deleted: true, wasAlreadyGone: true };
    }

    // Delete the temp index (best-effort)
    let wasAlreadyGone = false;
    try {
      await this._indexAdapter.deleteSession(source.sessionId);
    } catch {
      wasAlreadyGone = true;
    }

    // Mark inactive rather than removing, so history is preserved
    this._sources = this._sources.map((s) => (s.id === id ? { ...s, active: false } : s));
    await this._stateAdapter.save(this._sources);
    this._updateStatusBar();

    if (this._log) {
      console.log(`[LiveSourceAgent] Unpinned "${source.label}"`);
    }

    return { id, label: source.label, deleted: true, wasAlreadyGone };
  }

  async unpinByRef(sourceRef: string): Promise<UnpinResult> {
    await this._ensureLoaded();
    const source = this._sources.find((s) => s.active && s.sourceRef === sourceRef);
    if (!source) {
      return { id: sourceRef, label: sourceRef, deleted: true, wasAlreadyGone: true };
    }
    return this.unpinSource(source.id);
  }

  async injectContext(options: InjectContextOptions): Promise<InjectedContext> {
    await this._ensureLoaded();

    const activeSources = this._sources.filter((s) => s.active);
    if (activeSources.length === 0) {
      return {
        systemPrompt: options.baseSystemPrompt,
        sourcesUsed: 0,
        chunksInjected: 0,
        addedTokens: 0,
        hasInjection: false,
      };
    }

    const topK = options.topKPerSource ?? this._topKPerSource;
    const maxTokens = options.maxInjectedTokens ?? this._maxInjectedTokens;

    let injectedText = PINNED_SOURCE_SYSTEM_PREFIX;
    let chunksInjected = 0;
    let sourcesUsed = 0;
    let addedTokens = estimateTokens(PINNED_SOURCE_SYSTEM_PREFIX);

    for (const source of activeSources) {
      let hits: Array<{ content: string; score: number }> = [];
      try {
        hits = await this._indexAdapter.search(
          source.sessionId,
          options.query,
          options.queryVector,
          topK
        );
      } catch {
        // Non-fatal — skip this source
        continue;
      }

      if (hits.length === 0) continue;

      const sourceHeader = `### ${source.label} (priority: ${source.priorityWeight}x)\n`;
      const sourceText = hits.map((h) => h.content).join('\n\n');
      const block = sourceHeader + sourceText + '\n\n';
      const blockTokens = estimateTokens(block);

      if (addedTokens + blockTokens > maxTokens) break;

      injectedText += block;
      addedTokens += blockTokens;
      chunksInjected += hits.length;
      sourcesUsed++;
    }

    if (sourcesUsed === 0) {
      return {
        systemPrompt: options.baseSystemPrompt,
        sourcesUsed: 0,
        chunksInjected: 0,
        addedTokens: 0,
        hasInjection: false,
      };
    }

    const systemPrompt = injectedText + '---\n\n' + options.baseSystemPrompt;

    return {
      systemPrompt,
      sourcesUsed,
      chunksInjected,
      addedTokens,
      hasInjection: true,
    };
  }

  async listPinnedSources(): Promise<PinnedSource[]> {
    await this._ensureLoaded();
    return this._sources.filter((s) => s.active);
  }

  async getSource(id: string): Promise<PinnedSource | null> {
    await this._ensureLoaded();
    return this._sources.find((s) => s.id === id) ?? null;
  }

  async getStatusBarState(): Promise<LiveSourceStatusBarState> {
    await this._ensureLoaded();
    const active = this._sources.filter((s) => s.active);
    return { pinnedCount: active.length, labels: active.map((s) => s.label) };
  }

  buildStatusBarText(state: LiveSourceStatusBarState): string {
    if (state.pinnedCount === 0) return '';
    if (state.pinnedCount === 1) {
      return `${STATUS_BAR_PREFIX} ${state.labels[0]} pinned`;
    }
    return `${STATUS_BAR_PREFIX} ${state.pinnedCount} docs pinned`;
  }

  private async _ensureLoaded(): Promise<void> {
    if (this._loaded) return;
    this._sources = await this._stateAdapter.load();
    this._loaded = true;
  }

  private _updateStatusBar(): void {
    if (!this._statusBarAdapter) return;
    const active = this._sources.filter((s) => s.active);
    if (active.length === 0) {
      this._statusBarAdapter.clear();
    } else {
      this._statusBarAdapter.update({
        pinnedCount: active.length,
        labels: active.map((s) => s.label),
      });
    }
  }
}
