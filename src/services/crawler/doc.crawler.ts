import * as cheerio from 'cheerio';
import { AnyNode } from 'domhandler';
import {
  DocCrawlerConfig,
  DocFramework,
  LibraryEntry,
  SUPPORTED_LIBRARIES,
  CrawlPage,
  ContentChunk,
  CrawlResult,
  CrawlError,
  ChunkOptions,
  CrawlCacheEntry,
  CrawlerError,
  RobotsTxtBlockedError,
} from './doc.crawler.types';

export interface HttpResponse {
  status: number;
  data: string;
  headers: Record<string, string>;
}

export interface HttpClient {
  get(url: string, timeoutMs: number): Promise<HttpResponse>;
}

export interface BlobWriter {
  write(container: string, key: string, content: string): Promise<void>;
  exists(container: string, key: string): Promise<boolean>;
}

const DEFAULT_CONFIG: Required<DocCrawlerConfig> = {
  maxDepth: 3,
  maxPages: 200,
  rateLimitMs: 500,
  requestTimeoutMs: 10_000,
  chunkTargetTokens: 750,
  chunkMinTokens: 100,
  chunkMaxTokens: 1000,
  respectRobotsTxt: true,
  cacheTtlMs: 86_400_000,
  enableCache: true,
  storageContainer: 'documentation',
  enableLogging: true,
};

const CHARS_PER_TOKEN = 4;

export class DocCrawlerService {
  private readonly config: Required<DocCrawlerConfig>;
  private readonly http: HttpClient;
  private readonly blob: BlobWriter;
  private visited = new Set<string>();
  private robotsCache = new Map<string, string[]>();
  private resultCache = new Map<string, CrawlCacheEntry>();

  constructor(config: DocCrawlerConfig = {}, http: HttpClient, blob: BlobWriter) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.http = http;
    this.blob = blob;
  }

  async crawlLibrary(libraryName: string): Promise<CrawlResult> {
    const entry = SUPPORTED_LIBRARIES.find(
      (l) => l.name.toLowerCase() === libraryName.toLowerCase()
    );
    if (!entry) {
      throw new CrawlerError(
        `Library "${libraryName}" is not in the supported library registry.`,
        libraryName
      );
    }
    return this.crawlUrl(entry.docsUrl, entry.name, entry.framework);
  }

  /**
   * Crawls an arbitrary documentation URL.
   */
  async crawlUrl(
    seedUrl: string,
    library: string,
    frameworkHint?: DocFramework
  ): Promise<CrawlResult> {
    // Return cached result if valid
    const cached = this.getCachedResult(library);
    if (cached) {
      this.log(`Cache hit for library "${library}"`);
      return cached;
    }

    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    this.visited.clear();

    const errors: CrawlError[] = [];
    let chunksStored = 0;

    this.log(`Starting crawl: ${library} @ ${seedUrl}`);

    const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];

    while (queue.length > 0 && this.visited.size < this.config.maxPages) {
      const item = queue.shift()!;
      const { url, depth } = item;

      if (this.visited.has(url)) {
        continue;
      }
      this.visited.add(url);

      if (depth > this.config.maxDepth) {
        continue;
      }

      // Robots.txt check
      if (this.config.respectRobotsTxt) {
        const blocked = await this.isBlockedByRobots(url);
        if (blocked) {
          this.log(`robots.txt blocked: ${url}`);
          errors.push({ url, reason: 'Blocked by robots.txt' });
          continue;
        }
      }

      // Rate limit
      if (this.visited.size > 1) {
        await this.sleep(this.config.rateLimitMs);
      }

      // Fetch page
      let page: CrawlPage;
      try {
        page = await this.fetchPage(url, depth, frameworkHint);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        const status = (err as { statusCode?: number }).statusCode;
        errors.push({ url, reason, statusCode: status });
        this.log(`Error fetching ${url}: ${reason}`);
        continue;
      }

      // Chunk and store
      const chunks = this.chunkPage(page, library);
      for (const chunk of chunks) {
        try {
          await this.storeChunk(chunk);
          chunksStored++;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          errors.push({ url, reason: `Storage error: ${reason}` });
        }
      }

      // Discover links (only same-origin, only if not at max depth)
      if (depth < this.config.maxDepth) {
        const links = this.extractLinks(page.text, url, seedUrl);
        for (const link of links) {
          if (!this.visited.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        }
      }
    }

    const result: CrawlResult = {
      library,
      seedUrl,
      pagesVisited: this.visited.size,
      chunksStored,
      errors,
      durationMs: Date.now() - startMs,
      startedAt,
      completedAt: new Date().toISOString(),
    };

    this.setCachedResult(library, result);
    this.log(`Crawl complete: ${library} — ${result.pagesVisited} pages, ${chunksStored} chunks`);
    return result;
  }

  /**
   * Returns the list of supported built-in libraries.
   */
  getSupportedLibraries(): LibraryEntry[] {
    return [...SUPPORTED_LIBRARIES];
  }

  /**
   * Clears the result cache for a specific library or all libraries.
   */
  clearCache(library?: string): void {
    if (library) {
      this.resultCache.delete(library);
    } else {
      this.resultCache.clear();
    }
  }

  getCacheSize(): number {
    return this.resultCache.size;
  }

  async fetchPage(url: string, depth: number, frameworkHint?: DocFramework): Promise<CrawlPage> {
    let response: HttpResponse;
    try {
      response = await this.http.get(url, this.config.requestTimeoutMs);
    } catch (err) {
      throw new CrawlerError(`Failed to fetch ${url}`, url, err);
    }

    if (response.status < 200 || response.status >= 300) {
      const e = new CrawlerError(`HTTP ${response.status} for ${url}`, url) as CrawlerError & {
        statusCode: number;
      };
      e.statusCode = response.status;
      throw e;
    }

    const $ = cheerio.load(response.data);
    const framework = frameworkHint ?? this.detectFramework($, url);
    const { title, description, text } = this.extractContent($, framework);

    return {
      url,
      depth,
      text,
      title,
      description,
      framework,
      crawledAt: Date.now(),
    };
  }

  detectFramework($: cheerio.CheerioAPI, url: string): DocFramework {
    // Docusaurus: meta generator or characteristic DOM
    const generator = $('meta[name="generator"]').attr('content') ?? '';
    if (generator.toLowerCase().includes('docusaurus')) return 'docusaurus';
    if ($('.docusaurus-highlight-code-line, .navbar__brand, [class*="docusaurus"]').length)
      return 'docusaurus';

    // Sphinx
    if ($('div.sphinxsidebar, div.related, body.wy-body-for-nav').length) return 'sphinx';
    if (generator.toLowerCase().includes('sphinx')) return 'sphinx';

    // MkDocs
    if ($('div.md-sidebar, div.md-content, [data-md-component]').length) return 'mkdocs';
    if (generator.toLowerCase().includes('mkdocs')) return 'mkdocs';

    // VitePress
    if ($('.VPDoc, .VPSidebar, [class*="vitepress"]').length) return 'vitepress';
    if (url.includes('vitepress')) return 'vitepress';

    return 'generic';
  }

  extractContent(
    $: cheerio.CheerioAPI,
    framework: DocFramework
  ): { title: string; description: string; text: string } {
    const title = $('title').first().text().trim() || $('h1').first().text().trim() || 'Untitled';

    const description = $('meta[name="description"]').attr('content')?.trim() ?? '';

    // Remove non-content elements
    $(
      'script, style, nav, footer, header, [role="navigation"], .navbar, .sidebar, ' +
        '.toc, #toc, .edit-page, .pagination-nav, .theme-doc-footer, ' +
        'noscript, iframe, svg'
    ).remove();

    // Framework-specific main content selectors (ordered by specificity)
    const contentSelectors: Record<DocFramework, string[]> = {
      docusaurus: ['.theme-doc-markdown', 'article', '.markdown', 'main'],
      sphinx: ['div.body', 'div[role="main"]', 'div.document', 'main'],
      mkdocs: ['div.md-content', 'article.md-content__inner', 'main'],
      vitepress: ['.vp-doc', '.content', 'main'],
      generic: ['main', 'article', '[role="main"]', '.content', '.docs-content', 'body'],
    };

    const selectors = contentSelectors[framework] ?? contentSelectors.generic;
    let $content: cheerio.Cheerio<AnyNode> = $('body');

    for (const sel of selectors) {
      const found = $(sel);
      if (found.length) {
        $content = found.first();
        break;
      }
    }
    const text = $content
      .find('p, h1, h2, h3, h4, h5, h6, li, td, th, pre, code')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 0)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return { title, description, text };
  }

  extractLinks(html: string, currentUrl: string, seedUrl: string): string[] {
    const seedOrigin = this.getOrigin(seedUrl);
    const base = currentUrl;

    try {
      const $ = cheerio.load(html);
      const links: string[] = [];

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        const resolved = this.resolveUrl(href, base);
        if (!resolved) return;

        // Same-origin only
        if (!resolved.startsWith(seedOrigin)) return;

        // Skip anchors, query-only, non-HTML
        if (href.startsWith('#')) return;
        if (
          /\.(png|jpg|jpeg|gif|svg|pdf|zip|tar|gz|woff|woff2|ttf|eot|ico|css|js)$/i.test(resolved)
        )
          return;

        links.push(resolved.split('#')[0]); // strip fragment
      });

      return [...new Set(links)];
    } catch {
      return [];
    }
  }

  /**
   * Splits a page's text into token-bounded chunks.
   */
  chunkText(text: string, options: ChunkOptions): string[] {
    const { targetTokens, minTokens, maxTokens } = options;
    const targetChars = targetTokens * CHARS_PER_TOKEN;
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    const minChars = minTokens * CHARS_PER_TOKEN;

    if (!text.trim()) return [];

    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const chunks: string[] = [];
    let current = '';

    for (const para of paragraphs) {
      const candidate = current ? `${current}\n\n${para}` : para;

      if (candidate.length > maxChars && current) {
        // Flush current, start fresh with this paragraph
        if (current.length >= minChars) {
          chunks.push(current.trim());
        }
        current = para;
      } else if (candidate.length >= targetChars) {
        chunks.push(candidate.trim());
        current = '';
      } else {
        current = candidate;
      }
    }

    // Flush remainder
    if (current.trim().length >= minChars) {
      chunks.push(current.trim());
    }

    return chunks;
  }

  chunkPage(page: CrawlPage, library: string): ContentChunk[] {
    const texts = this.chunkText(page.text, {
      targetTokens: this.config.chunkTargetTokens,
      minTokens: this.config.chunkMinTokens,
      maxTokens: this.config.chunkMaxTokens,
    });

    return texts.map((text, index) => {
      const tokenCount = Math.ceil(text.length / CHARS_PER_TOKEN);
      const urlSlug = this.urlToSlug(page.url);
      const blobKey = `${library}/${urlSlug}/chunk-${String(index).padStart(4, '0')}.txt`;

      return { index, sourceUrl: page.url, library, text, tokenCount, blobKey };
    });
  }

  async storeChunk(chunk: ContentChunk): Promise<void> {
    const payload = JSON.stringify({
      sourceUrl: chunk.sourceUrl,
      library: chunk.library,
      index: chunk.index,
      tokenCount: chunk.tokenCount,
      text: chunk.text,
    });
    await this.blob.write(this.config.storageContainer, chunk.blobKey, payload);
  }

  async isBlockedByRobots(url: string): Promise<boolean> {
    const origin = this.getOrigin(url);
    if (!origin) return false;

    if (!this.robotsCache.has(origin)) {
      await this.fetchRobotsTxt(origin);
    }

    const disallowed = this.robotsCache.get(origin) ?? [];
    const path = this.getPath(url);
    return disallowed.some((prefix) => path.startsWith(prefix));
  }

  async fetchRobotsTxt(origin: string): Promise<void> {
    try {
      const response = await this.http.get(`${origin}/robots.txt`, this.config.requestTimeoutMs);
      if (response.status === 200) {
        const disallowed = this.parseRobotsTxt(response.data);
        this.robotsCache.set(origin, disallowed);
      } else {
        this.robotsCache.set(origin, []);
      }
    } catch {
      this.robotsCache.set(origin, []);
    }
  }

  /**
   * Parses robots.txt and returns disallowed paths for * or DevMind user-agent.
   */
  parseRobotsTxt(content: string): string[] {
    const disallowed: string[] = [];
    let activeAgent = false;

    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const [key, ...valueParts] = line.split(':');
      const value = valueParts.join(':').trim();

      if (key.toLowerCase() === 'user-agent') {
        activeAgent = value === '*' || value.toLowerCase().includes('devmind');
      }

      if (activeAgent && key.toLowerCase() === 'disallow' && value) {
        disallowed.push(value);
      }
    }

    return disallowed;
  }

  private getCachedResult(library: string): CrawlResult | null {
    if (!this.config.enableCache) return null;

    const entry = this.resultCache.get(library);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.resultCache.delete(library);
      return null;
    }

    return entry.result;
  }

  private setCachedResult(library: string, result: CrawlResult): void {
    if (!this.config.enableCache) return;
    this.resultCache.set(library, {
      result,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }

  getOrigin(url: string): string {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  }

  getPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return '';
    }
  }

  resolveUrl(href: string, base: string): string | null {
    try {
      return new URL(href, base).href;
    } catch {
      return null;
    }
  }

  urlToSlug(url: string): string {
    try {
      const u = new URL(url);
      return (
        (u.pathname + u.search)
          .replace(/^\//, '')
          .replace(/\/$/, '')
          .replace(/[^a-z0-9]/gi, '-')
          .replace(/-+/g, '-')
          .toLowerCase()
          .slice(0, 120) || 'index'
      );
    } catch {
      return 'index';
    }
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[DocCrawler] ${message}`);
    }
  }
}
