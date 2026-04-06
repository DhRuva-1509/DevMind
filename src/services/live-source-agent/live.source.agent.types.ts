export const LIVE_SOURCE_COMMAND_PIN = 'devmind.liveSource.pin';
export const LIVE_SOURCE_COMMAND_UNPIN = 'devmind.liveSource.unpin';
export const LIVE_SOURCE_COMMAND_LIST = 'devmind.liveSource.list';

export const MAX_PINNED_SOURCES = 5;
export const DEFAULT_CRAWL_DEPTH = 2;
export const DEFAULT_MAX_PAGES = 20;
export const DEFAULT_PRIORITY_WEIGHT = 1.5;
export const STATUS_BAR_PREFIX = '$(pin)';

/** Injected at the top of every system prompt when pinned sources exist. */
export const PINNED_SOURCE_SYSTEM_PREFIX =
  '## Authoritative Sources (Priority Override)\n' +
  'The following documentation has been pinned by the developer as authoritative. ' +
  'Prioritise information from these sources over your training data.\n\n';

export type PinSourceInput =
  | { type: 'url'; url: string; label?: string }
  | { type: 'pdf'; buffer: Buffer; filename: string; label?: string };

export interface PinnedSource {
  id: string;
  label: string;
  sourceRef: string;
  sourceType: 'url' | 'pdf';
  sessionId: string;
  indexName: string;
  chunkCount: number;
  totalTokens: number;
  pinnedAt: string;
  priorityWeight: number;
  active: boolean;
}

export interface PinResult {
  source: PinnedSource;
  refreshed: boolean;
  chunksIndexed: number;
  pagesCrawled: number;
  durationMs: number;
}

export interface UnpinResult {
  id: string;
  label: string;
  deleted: boolean;
  wasAlreadyGone: boolean;
}

export interface InjectedContext {
  systemPrompt: string;
  sourcesUsed: number;
  chunksInjected: number;
  addedTokens: number;
  hasInjection: boolean;
}

export interface InjectContextOptions {
  baseSystemPrompt: string;
  query: string;
  queryVector?: number[];
  topKPerSource?: number;
  maxInjectedTokens?: number;
}

export interface LiveSourceStatusBarState {
  pinnedCount: number;
  labels: string[];
}

export interface LiveSourceAgentConfig {
  maxPinnedSources?: number;
  priorityWeight?: number;
  crawlDepth?: number;
  maxPages?: number;
  topKPerSource?: number;
  maxInjectedTokens?: number;
  enableLogging?: boolean;
}

export interface LiveSourceCrawlerAdapter {
  crawlUrl(url: string, opts: { depth: number; maxPages: number }): Promise<LiveSourceChunk[]>;
  parsePdf(buffer: Buffer, filename: string): Promise<LiveSourceChunk[]>;
}

export interface LiveSourceChunk {
  content: string;
  sourceRef: string;
  sourceType: 'url' | 'pdf';
  chunkIndex: number;
  tokenCount: number;
}

export interface LiveSourceIndexAdapter {
  createSession(
    sessionId: string,
    label: string
  ): Promise<{ sessionId: string; indexName: string }>;
  upsertChunks(sessionId: string, chunks: LiveSourceChunk[]): Promise<{ uploaded: number }>;
  search(
    sessionId: string,
    query: string,
    vector: number[] | undefined,
    topK: number
  ): Promise<Array<{ content: string; score: number }>>;

  deleteSession(sessionId: string): Promise<void>;
}

export interface LiveSourceEmbeddingAdapter {
  embed(text: string): Promise<number[]>;
}

export interface LiveSourceStateAdapter {
  save(sources: PinnedSource[]): Promise<void>;
  load(): Promise<PinnedSource[]>;
}

export interface LiveSourceProgressAdapter {
  report(message: string, increment?: number): void;
}

export interface LiveSourceStatusBarAdapter {
  update(state: LiveSourceStatusBarState): void;
  clear(): void;
}

export class LiveSourceError extends Error {
  constructor(
    message: string,
    public readonly code: LiveSourceErrorCode,
    public readonly sourceRef?: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'LiveSourceError';
  }
}

export type LiveSourceErrorCode =
  | 'INVALID_INPUT'
  | 'MAX_SOURCES_REACHED'
  | 'CRAWL_FAILED'
  | 'INDEX_FAILED'
  | 'UNPIN_FAILED'
  | 'SOURCE_NOT_FOUND'
  | 'INJECT_FAILED';
