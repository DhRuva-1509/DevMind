import * as vscode from 'vscode';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load .env from project root
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import {
  VscodeAdapter,
  DiagnosticCollection,
  StatusBarItem,
  WebviewPanel,
  VersionGuardDiagnostics,
  VersionGuardProvider,
  StatusBarManager,
  VersionGuardPanel,
  CommandRegistry,
  ProgressManager,
  CommandHandlers,
} from './services/ui/version.guard.ui';

import {
  DiagnosticEntry,
  CodeActionEntry,
  WebviewState,
  ProgressStep,
  COMMANDS,
} from './services/ui/version.guard.ui.types';

import { AzureOpenAIService } from './services/azure/openai/openai.service';
import { AzureKeyCredential, SearchIndexClient, SearchClient } from '@azure/search-documents';
import { AzureSearchService } from './services/azure/search/search.service';
import { BlobStorageService } from './services/azure/blob/blob.service';
import { CosmosDBService } from './services/azure/cosmos/cosmos.service';
import { KeyVaultService } from './services/azure/keyvault/keyvault.service';

import { DependencyParserService } from './services/parser/dependency.parser';
import {
  DocCrawlerService,
  HttpClient,
  HttpResponse,
  BlobWriter,
} from './services/crawler/doc.crawler';
import {
  DocIndexService,
  SearchServiceAdapter,
  EmbeddingAdapter,
} from './services/search/doc.index.service';
import {
  VersionGuardAgent,
  DependencyReaderAdapter,
  DocSearchAdapter,
  OpenAIAdapter,
  LoggingAdapter,
  FeatureToggleAdapter,
} from './services/agents/version.guard.agent';
import { VersionGuardWarning, OpenAIAnalysisResponse } from './services/agents/version.guard.types';
import axios from 'axios';
import { AzureOpenAI } from 'openai';

import { PRSummaryPanel } from './services/pr-summary-panel/pr.summary.panel';
import { PRSummaryPanelAdapter } from './services/pr-summary-panel/pr.summary.panel';
import { PanelMessage } from './services/pr-summary-panel/pr.summary.panel.types';
import { PRCommentPoster } from './services/pr-comment/pr.comment.poster';
import { PRSummary } from './services/pr-summary/pr.summary.types';
import { GitHubMCPClient } from './services/mcp/github.client';
import { PRSummaryAgent } from './services/pr-summary/pr.summary.agent';
import { PRContextExtractorService } from './services/pr-context/pr.context.service';
import { PromptTemplateService } from './services/prompt-templates/prompt.template.service';

function buildAdapter(context: vscode.ExtensionContext): VscodeAdapter {
  return {
    createDiagnosticCollection(name: string): DiagnosticCollection {
      const real = vscode.languages.createDiagnosticCollection(name);
      context.subscriptions.push(real);
      const store = new Map<string, DiagnosticEntry[]>();
      return {
        set(uri: string, entries: DiagnosticEntry[]): void {
          store.set(uri, entries);
          const vsUri = vscode.Uri.parse(uri);
          const vsDiags = entries.map((e) => {
            const range = new vscode.Range(e.line, e.character, e.endLine, e.endCharacter);
            const severity =
              {
                error: vscode.DiagnosticSeverity.Error,
                warning: vscode.DiagnosticSeverity.Warning,
                info: vscode.DiagnosticSeverity.Information,
                hint: vscode.DiagnosticSeverity.Hint,
              }[e.severity] ?? vscode.DiagnosticSeverity.Warning;
            const diag = new vscode.Diagnostic(range, e.message, severity);
            diag.source = e.source;
            diag.code = e.code;
            return diag;
          });
          real.set(vsUri, vsDiags);
        },
        delete(uri: string): void {
          store.delete(uri);
          real.delete(vscode.Uri.parse(uri));
        },
        clear(): void {
          store.clear();
          real.clear();
        },
        get(uri: string): DiagnosticEntry[] {
          return store.get(uri) ?? [];
        },
        dispose(): void {
          real.dispose();
        },
      };
    },

    createStatusBarItem(): StatusBarItem {
      const real = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      context.subscriptions.push(real);
      return {
        get text(): string {
          return real.text;
        },
        set text(v: string) {
          real.text = v;
        },
        get tooltip(): string {
          return typeof real.tooltip === 'string' ? real.tooltip : '';
        },
        set tooltip(v: string) {
          real.tooltip = v;
        },
        get command(): string | undefined {
          return typeof real.command === 'string' ? real.command : undefined;
        },
        set command(v: string | undefined) {
          real.command = v;
        },
        show(): void {
          real.show();
        },
        hide(): void {
          real.hide();
        },
        dispose(): void {
          real.dispose();
        },
      };
    },

    createWebviewPanel(viewType: string, title: string): WebviewPanel {
      const real = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Beside, {
        enableScripts: true,
      });
      return {
        get html(): string {
          return real.webview.html;
        },
        set html(v: string) {
          real.webview.html = v;
        },
        reveal(): void {
          real.reveal();
        },
        dispose(): void {
          real.dispose();
        },
        postMessage(msg: unknown): void {
          real.webview.postMessage(msg);
        },
        onDidDispose(cb: () => void): void {
          real.onDidDispose(cb);
        },
      };
    },

    registerCommand(id: string, handler: (...args: unknown[]) => unknown): void {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    },
    async executeCommand(id: string, ...args: unknown[]): Promise<void> {
      await vscode.commands.executeCommand(id, ...args);
    },
    showInformationMessage(msg: string): void {
      vscode.window.showInformationMessage(msg);
    },
    showWarningMessage(msg: string): void {
      vscode.window.showWarningMessage(msg);
    },
    showErrorMessage(msg: string): void {
      vscode.window.showErrorMessage(msg);
    },

    async withProgress(
      title: string,
      steps: ProgressStep[],
      task: () => Promise<void>
    ): Promise<void> {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title, cancellable: false },
        async (progress) => {
          for (const step of steps) {
            progress.report({ message: step.message, increment: step.increment });
          }
          await task();
        }
      );
    },

    async applyEdit(uri: string, range: CodeActionEntry['range'], newText: string): Promise<void> {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        vscode.Uri.parse(uri),
        new vscode.Range(range.line, range.character, range.endLine, range.endCharacter),
        newText
      );
      await vscode.workspace.applyEdit(edit);
    },

    async showQuickPick(items: string[]): Promise<string | undefined> {
      return vscode.window.showQuickPick(items);
    },

    getConfiguration(key: string): unknown {
      return vscode.workspace.getConfiguration('devmind').get(key);
    },
  };
}

function buildAzureServices() {
  const openaiService = new AzureOpenAIService({
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    enableLogging: false,
  });

  const searchService = new AzureSearchService({
    endpoint: process.env.AZURE_SEARCH_ENDPOINT ?? '',
    indexName: 'devmind-default',
    enableLogging: false,
  });

  const searchApiKey = process.env.AZURE_SEARCH_API_KEY ?? '';
  const searchEndpoint = process.env.AZURE_SEARCH_ENDPOINT ?? '';
  const directSearchIndexClient =
    searchEndpoint && searchApiKey
      ? new SearchIndexClient(searchEndpoint, new AzureKeyCredential(searchApiKey))
      : null;

  // Factory for per-index search clients using API key
  const getDirectSearchClient = (indexName: string) =>
    searchEndpoint && searchApiKey
      ? new SearchClient(searchEndpoint, indexName, new AzureKeyCredential(searchApiKey))
      : null;

  const blobService = new BlobStorageService({
    accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL ?? '',
    enableLogging: false,
  });

  const cosmosService = new CosmosDBService({
    endpoint: process.env.AZURE_COSMOS_ENDPOINT ?? '',
    enableLogging: false,
  });

  const keyVaultService = new KeyVaultService({
    vaultUrl: process.env.AZURE_KEYVAULT_URL ?? '',
  });

  return {
    openaiService,
    searchService,
    blobService,
    cosmosService,
    keyVaultService,
    directSearchIndexClient,
    getDirectSearchClient,
  };
}

function buildDocIndexService(
  searchService: AzureSearchService,
  openaiService: AzureOpenAIService,
  projectId: string,
  directIndexClient: any,
  getDirectSearchClient: (indexName: string) => any
): DocIndexService {
  const searchAdapter: SearchServiceAdapter = {
    async createIndex(name, schema) {
      try {
        if (!directIndexClient) {
          return { success: false, error: 'Search client not available' };
        }
        // Check if index already exists
        try {
          await directIndexClient.getIndex(name);
          return { success: true }; // already exists
        } catch {
          // doesn't exist, create it
        }

        const fields = ((schema as any).fields ?? []).map((f: any) => {
          const field: any = {
            name: f.name,
            type: f.type,
            key: f.key ?? false,
            searchable: f.searchable ?? false,
            filterable: f.filterable ?? false,
            retrievable: f.retrievable ?? true,
          };
          // Vector fields: SDK v12 uses vectorSearchDimensions (not dimensions)
          if (f.dimensions) {
            field.vectorSearchDimensions = Number(f.dimensions);
            field.vectorSearchProfileName = f.vectorSearchProfile ?? 'devmind-vector-profile';
          }
          return field;
        });

        console.log(
          'DevMind createIndex fields:',
          JSON.stringify(fields.find((f: any) => f.name === 'contentVector'))
        );

        // Build vector search config if any vector fields exist
        const hasVectorFields = ((schema as any).fields ?? []).some((f: any) => f.dimensions);
        const vectorSearch = hasVectorFields
          ? {
              profiles: [
                { name: 'devmind-vector-profile', algorithmConfigurationName: 'devmind-hnsw' },
              ],
              algorithms: [
                { name: 'devmind-hnsw', kind: 'hnsw', hnswParameters: { metric: 'cosine' } },
              ],
            }
          : undefined;

        // Semantic search config
        const semanticSearch = {
          defaultConfigurationName: 'devmind-semantic',
          configurations: [
            {
              name: 'devmind-semantic',
              prioritizedFields: {
                contentFields: [{ name: 'content' }],
                keywordsFields: [{ name: 'library' }],
              },
            },
          ],
        };

        await directIndexClient.createIndex({
          name,
          fields,
          ...(vectorSearch ? { vectorSearch } : {}),
          semanticSearch,
        });
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e.message ?? 'Failed to create index' };
      }
    },
    async indexExists(name) {
      if (directIndexClient) {
        try {
          await directIndexClient.getIndex(name);
          return true;
        } catch {
          return false;
        }
      }
      return searchService.indexExists(name);
    },
    async deleteIndex(name) {
      const result = await searchService.deleteIndex(name);
      return { success: result.success, error: result.error };
    },
    async listIndexes() {
      try {
        if (!directIndexClient) return [];
        const indexes: string[] = [];
        for await (const index of directIndexClient.listIndexes()) {
          indexes.push(index.name);
        }
        return indexes;
      } catch {
        return [];
      }
    },
    async upsertDocuments(indexName, docs) {
      try {
        // Use direct API key client to avoid DefaultAzureCredential issues
        const directClient = getDirectSearchClient(indexName);
        if (!directClient) {
          return {
            succeeded: 0,
            failed: docs.length,
            errors: [{ key: 'all', message: 'No search client' }],
          };
        }
        const result = await directClient.mergeOrUploadDocuments(docs);
        const succeeded = result.results.filter((r: any) => r.succeeded).length;
        const failed = result.results.filter((r: any) => !r.succeeded).length;
        console.log(`DevMind: upserted ${succeeded} docs to ${indexName}`);
        return {
          succeeded,
          failed,
          errors: result.results
            .filter((r: any) => !r.succeeded)
            .map((r: any) => ({ key: r.key ?? '', message: r.errorMessage ?? '' })),
        };
      } catch (e: any) {
        console.error('DevMind upsert error:', e.message, e.status);
        return {
          succeeded: 0,
          failed: docs.length,
          errors: [{ key: 'all', message: e.message ?? '' }],
        };
      }
    },
    async deleteDocuments(indexName, ids) {
      // deleteDocuments(documentIds, indexName?)
      const result = await searchService.deleteDocuments(ids, indexName);
      return { success: result.success };
    },
    async hybridSearch(indexName, query, vector, options: any) {
      try {
        const directClient = getDirectSearchClient(indexName);
        if (!directClient) return { results: [], durationMs: 0 };
        const start = Date.now();
        const searchResults: any[] = [];
        const searchOptions: any = {
          top: options?.top ?? 8,
          select: ['id', 'content', 'library', 'sourceUrl', 'version'],
        };
        if (options?.filter) searchOptions.filter = options.filter;

        // Use vector search only when we have a valid non-empty vector
        if (vector && Array.isArray(vector) && vector.length > 0) {
          searchOptions.vectorSearchOptions = {
            queries: [
              {
                kind: 'vector',
                vector,
                kNearestNeighborsCount: options?.top ?? 8,
                fields: ['contentVector'],
              },
            ],
          };
        }

        // Always use text search — works even without vector
        const searchText = query && query.trim() ? query : '*';
        const iter = await directClient.search(searchText, searchOptions);
        for await (const result of iter.results) {
          searchResults.push({
            document: result.document,
            score: result.score ?? 0,
            rerankerScore: result.rerankerScore ?? 0,
          });
        }
        console.log(
          `DevMind: hybridSearch found ${searchResults.length} results in ${indexName} for query "${searchText.substring(0, 50)}"`
        );
        return { results: searchResults, durationMs: Date.now() - start };
      } catch (e: any) {
        console.error('DevMind hybridSearch error:', e.message, e.status);
        // Fallback: plain text search without vector
        try {
          const directClient = getDirectSearchClient(indexName);
          if (!directClient) return { results: [], durationMs: 0 };
          const searchResults: any[] = [];
          const iter = await directClient.search(query || '*', { top: options?.top ?? 8 });
          for await (const result of iter.results) {
            searchResults.push({
              document: result.document,
              score: result.score ?? 0,
              rerankerScore: 0,
            });
          }
          console.log(`DevMind: fallback search found ${searchResults.length} results`);
          return { results: searchResults, durationMs: 0 };
        } catch {
          return { results: [], durationMs: 0 };
        }
      }
    },
    async getIndexStats(indexName) {
      try {
        if (!directIndexClient) return null;
        const stats = await directIndexClient.getIndexStatistics(indexName);
        return { documentCount: stats.documentCount ?? 0, storageSize: stats.storageSize ?? 0 };
      } catch {
        return null;
      }
    },
  };

  const embeddingAdapter: EmbeddingAdapter = {
    async embed(texts) {
      try {
        // Use OpenAI REST API directly with API key — bypasses DefaultAzureCredential
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? '';
        const apiKey = process.env.AZURE_OPENAI_API_KEY ?? '';
        const deployment = 'text-embedding-3-small'; // use small for faster/cheaper demo

        const url = `${endpoint}openai/deployments/${deployment}/embeddings?api-version=2024-02-01`;
        const inputTexts = Array.isArray(texts) ? texts : [texts];

        const response = await axios.post(
          url,
          { input: inputTexts },
          {
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
            timeout: 30000,
          }
        );

        const embeddings: number[][] = response.data.data.map((d: any) => d.embedding);
        return { embeddings };
      } catch (e: any) {
        console.error('DevMind embedding error:', e.message);
        return { embeddings: [], error: e.message };
      }
    },
  };

  return new DocIndexService(
    {
      indexPrefix: 'devmind',
      embeddingDimensions: 1536,
      embeddingDeployment: 'text-embedding-3-small',
    },
    searchAdapter,
    embeddingAdapter
  );
}

function buildVersionGuardAgent(
  openaiService: AzureOpenAIService,
  docIndexService: DocIndexService,
  cosmosService: CosmosDBService,
  projectId: string,
  toggle: FeatureToggleAdapter
): VersionGuardAgent {
  const depParser = new DependencyParserService({ enableLogging: false });

  const depsAdapter: DependencyReaderAdapter = {
    async getLibraryVersion(projectRoot, library) {
      try {
        const result = depParser.parsePackageJson(path.join(projectRoot, 'package.json'));
        const dep = result.dependencies.find(
          (d) => d.normalizedName === library || d.name === library
        );
        return dep?.specifier.version ?? null;
      } catch {
        return null;
      }
    },
    async getAllDependencies(projectRoot) {
      try {
        const result = depParser.parsePackageJson(path.join(projectRoot, 'package.json'));
        const map: Record<string, string> = {};
        result.dependencies.forEach((d) => {
          map[d.name] = d.specifier.raw;
        });
        return map;
      } catch {
        return {};
      }
    },
  };

  const docSearchAdapter: DocSearchAdapter = {
    async search(pid, query, options) {
      try {
        const response = await docIndexService.search(pid, query, {
          library: options.library,
          // Don't filter by version — docs are indexed as 'latest'
          // version: options.version,
          topK: options.topK,
        });
        return response.results.map((r) => ({
          content: r.content,
          sourceUrl: r.sourceUrl,
          score: r.score,
        }));
      } catch {
        return [];
      }
    },
    async indexExists(pid, library) {
      try {
        const indexName = docIndexService.buildIndexName(pid, library);
        return docIndexService['searchAdapter']?.indexExists(indexName) ?? false;
      } catch {
        return false;
      }
    },
  };

  const openaiAdapter: OpenAIAdapter = {
    async analyze(prompt, deployment) {
      try {
        // Use OpenAI REST API directly with API key
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? '';
        const apiKey = process.env.AZURE_OPENAI_API_KEY ?? '';
        const model = deployment ?? 'gpt-4o';
        const url = `${endpoint}openai/deployments/${model}/chat/completions?api-version=2024-02-01`;

        const response = await axios.post(
          url,
          {
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 1000,
          },
          {
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
            timeout: 60000,
          }
        );

        const text = response.data.choices[0]?.message?.content ?? '';
        const clean = text.replace(/```json|```/g, '').trim();
        console.log('DevMind GPT-4o raw response:', clean.substring(0, 500));
        const parsed = JSON.parse(clean) as OpenAIAnalysisResponse;
        console.log('DevMind GPT-4o warnings:', JSON.stringify(parsed.warnings));
        return parsed;
      } catch (e: any) {
        console.error('DevMind GPT-4o parse error:', e.message);
        return { warnings: [] };
      }
    },
  };

  const loggingAdapter: LoggingAdapter = {
    async log(entry) {
      try {
        await cosmosService.upsert('telemetry', entry as any);
      } catch {
        // Non-fatal — logging failure never breaks the extension
      }
    },
  };

  return new VersionGuardAgent(
    { projectId, enableLogging: true, minConfidence: 0.7 },
    depsAdapter,
    docSearchAdapter,
    openaiAdapter,
    loggingAdapter,
    toggle
  );
}

function buildDocCrawler(blobService: BlobStorageService): DocCrawlerService {
  const httpClient: HttpClient = {
    async get(url: string, timeoutMs: number): Promise<HttpResponse> {
      const response = await axios.get(url, {
        timeout: timeoutMs,
        responseType: 'text',
        headers: { 'User-Agent': 'DevMind/1.0 Documentation Indexer' },
      });
      return {
        status: response.status,
        data: response.data as string,
        headers: response.headers as Record<string, string>,
      };
    },
  };

  const blobWriter: BlobWriter = {
    async write(container: string, key: string, content: string): Promise<void> {
      // uploadBlob(blobName, content, options?, containerName?)
      await blobService.uploadBlob(key, content, { contentType: 'application/json' }, container);
    },
    async exists(container: string, key: string): Promise<boolean> {
      // blobExists(blobName, containerName?)
      return blobService.blobExists(key, container);
    },
  };

  return new DocCrawlerService(
    { enableLogging: true, rateLimitMs: 300, maxDepth: 2, maxPages: 50 },
    httpClient,
    blobWriter
  );
}

const LIBRARY_DOCS: Record<string, { url: string; description: string }> = {
  'react-query': {
    url: 'https://tanstack.com/query/latest/docs/framework/react/overview',
    description:
      'TanStack Query (React Query) v5 breaking changes: useQuery now requires object argument with queryKey and queryFn properties. The array+function syntax useQuery([key], fn) is removed in v5. Use useQuery({ queryKey: [key], queryFn: fn }) instead. useMutation({ mutationFn }). useInfiniteQuery({ queryKey, queryFn, getNextPageParam }). QueryClient methods unchanged.',
  },
  react: {
    url: 'https://react.dev/learn',
    description:
      'React is a JavaScript library for building user interfaces. Key hooks: useState, useEffect, useContext, useRef, useMemo, useCallback, useReducer. React 18 introduced concurrent features.',
  },
  nextjs: {
    url: 'https://nextjs.org/docs',
    description:
      'Next.js is a React framework for production. App Router uses Server Components by default. Pages Router uses getServerSideProps, getStaticProps, getStaticPaths.',
  },
  vue: {
    url: 'https://vuejs.org/guide',
    description:
      'Vue.js is a progressive JavaScript framework. Composition API uses setup(), ref(), reactive(), computed(), watch(). Options API uses data(), methods, computed, watch.',
  },
  express: {
    url: 'https://expressjs.com/en/guide',
    description:
      'Express is a Node.js web framework. Use app.get(), app.post(), app.use() for routing. Middleware runs in order. req, res, next pattern.',
  },
  fastify: {
    url: 'https://fastify.dev/docs/latest',
    description:
      'Fastify is a fast Node.js web framework. Uses schema-based validation, plugins, decorators. fastify.get(), fastify.post(), fastify.register().',
  },
  prisma: {
    url: 'https://www.prisma.io/docs',
    description:
      'Prisma is a Node.js ORM. PrismaClient for database access. prisma.model.findMany(), findUnique(), create(), update(), delete(), upsert().',
  },
  drizzle: {
    url: 'https://orm.drizzle.team/docs',
    description:
      'Drizzle ORM is a TypeScript ORM. Uses schema definition, db.select(), db.insert(), db.update(), db.delete(). Works with PostgreSQL, MySQL, SQLite.',
  },
  zod: {
    url: 'https://zod.dev',
    description:
      'Zod is a TypeScript schema validation library. z.string(), z.number(), z.object(), z.array(), z.union(), z.parse(), z.safeParse().',
  },
  typescript: {
    url: 'https://www.typescriptlang.org/docs',
    description:
      'TypeScript adds static types to JavaScript. Interfaces, types, generics, enums, decorators, utility types: Partial, Required, Pick, Omit, Record, Readonly.',
  },
};

async function fetchAndChunkDocs(library: string, projectId: string): Promise<any[]> {
  const entry = LIBRARY_DOCS[library];
  if (!entry) return [];

  const chunks: any[] = [];
  const ts = Date.now();

  try {
    const response = await axios.get(entry.url, {
      timeout: 10000,
      headers: { 'User-Agent': 'DevMind/1.0' },
      responseType: 'text',
    });

    const html = response.data as string;
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = text.split(' ').filter((w) => w.length > 0);
    const chunkSize = 400;
    for (let i = 0; i < Math.min(words.length, chunkSize * 10); i += chunkSize) {
      const chunkText = words.slice(i, i + chunkSize).join(' ');
      if (chunkText.length < 50) continue;
      chunks.push({
        id: `${library}-${ts}-${chunks.length}`,
        content: chunkText,
        library,
        sourceUrl: entry.url,
        version: 'latest',
        projectId,
        chunkIndex: chunks.length,
        tokenCount: Math.ceil(chunkText.length / 4),
      });
    }
  } catch {
    console.log(`DevMind: fetch failed for ${library}, using fallback description`);
  }

  chunks.push({
    id: `${library}-desc-${ts}`,
    content: entry.description,
    library,
    sourceUrl: entry.url,
    version: 'latest',
    projectId,
    chunkIndex: chunks.length,
    tokenCount: Math.ceil(entry.description.length / 4),
  });

  return chunks;
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('DevMind: activating...');

  const adapter = buildAdapter(context);

  const diagManager = new VersionGuardDiagnostics(adapter);
  const statusBar = new StatusBarManager(adapter);
  const panel = new VersionGuardPanel(adapter);
  const provider = new VersionGuardProvider(diagManager, adapter);
  const progress = new ProgressManager(adapter);

  const toggle: FeatureToggleAdapter = {
    isEnabled(): boolean {
      return (adapter.getConfiguration('versionGuard.enabled') as boolean) ?? true;
    },
  };

  const {
    openaiService,
    searchService,
    blobService,
    cosmosService,
    directSearchIndexClient,
    getDirectSearchClient,
  } = buildAzureServices();

  const projectId = vscode.workspace.name ?? 'devmind';

  const docIndexService = buildDocIndexService(
    searchService,
    openaiService,
    projectId,
    directSearchIndexClient,
    getDirectSearchClient
  );
  const agent = buildVersionGuardAgent(
    openaiService,
    docIndexService,
    cosmosService,
    projectId,
    toggle
  );
  const crawler = buildDocCrawler(blobService);

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [
        { language: 'typescript' },
        { language: 'typescriptreact' },
        { language: 'javascript' },
        { language: 'javascriptreact' },
      ],
      {
        provideCodeActions(document, range): vscode.CodeAction[] {
          const uri = document.uri.toString();
          const entries = provider.provideCodeActions(uri, {
            line: range.start.line,
            character: range.start.character,
          });
          return entries.map((entry) => {
            const action = new vscode.CodeAction(entry.title, vscode.CodeActionKind.QuickFix);
            action.isPreferred = entry.isPreferred;
            action.command = {
              command: COMMANDS.APPLY_FIX,
              title: entry.title,
              arguments: [entry.warningId],
            };
            return action;
          });
        },
      }
    )
  );

  const handlers: CommandHandlers = {
    async analyzeFile(): Promise<void> {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        adapter.showWarningMessage('DevMind: No active file to analyze.');
        return;
      }

      const uri = editor.document.uri.toString();
      const content = editor.document.getText();
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

      statusBar.setAnalyzing();

      await progress.showAnalysisProgress(editor.document.fileName, async () => {
        try {
          const result = await agent.analyzeFile(uri, content, workspaceRoot, 'command');

          // Map warnings to diagnostic entries
          const entries: DiagnosticEntry[] = result.warnings.map((w: VersionGuardWarning) => ({
            uri,
            line: w.location.line,
            character: w.location.character,
            endLine: w.location.endLine,
            endCharacter: w.location.endCharacter,
            message: w.suggestion
              ? `DevMind [${w.library} v${w.version}]: ${w.message}\n\n💡 Suggested fix:\n${w.suggestion}`
              : `DevMind [${w.library} v${w.version}]: ${w.message}`,
            severity: w.severity,
            source: 'DevMind Version Guard',
            warningId: w.id,
            code: `vg-${w.symbol}`,
          }));

          diagManager.setDiagnostics(uri, entries);

          // Register quick fixes — range comes from agent's buildQuickFix (multiline aware)
          result.warnings.forEach((w: VersionGuardWarning) => {
            if (w.quickFix && w.quickFix.newText) {
              diagManager.registerQuickFix({
                title: w.quickFix.title,
                newText: w.quickFix.newText,
                range: {
                  line: w.quickFix.range.line,
                  character: w.quickFix.range.character,
                  endLine: w.quickFix.range.endLine,
                  endCharacter: w.quickFix.range.endCharacter,
                },
                warningId: w.id,
                uri,
                isPreferred: true,
              });
            }
          });

          statusBar.setReady(result.warnings.length);

          if (result.warnings.length > 0) {
            adapter.showWarningMessage(
              `DevMind: ${result.warnings.length} version issue${result.warnings.length === 1 ? '' : 's'} found. See Problems panel.`
            );
          } else {
            adapter.showInformationMessage('DevMind: No version issues found.');
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          statusBar.setError(msg);
          adapter.showErrorMessage(`DevMind: Analysis failed — ${msg}`);
        }
      });
    },

    async indexLibrary(): Promise<void> {
      const library = await adapter.showQuickPick([
        'react-query',
        'react',
        'nextjs',
        'vue',
        'express',
        'fastify',
        'prisma',
        'drizzle',
        'zod',
        'typescript',
      ]);
      if (!library) return;

      statusBar.setIndexing(library);

      await progress.showIndexingProgress(library, async () => {
        try {
          // Fetch and chunk docs directly — bypasses blob storage auth issues
          const chunks = await fetchAndChunkDocs(library, projectId);
          console.log(`DevMind: Fetched ${chunks.length} chunks for ${library}`);
          const indexResult = await docIndexService.indexChunks(projectId, library, chunks);
          if (indexResult.errors && indexResult.errors.length > 0) {
            console.error(
              'DevMind indexing errors:',
              JSON.stringify(indexResult.errors.slice(0, 3))
            );
          }

          statusBar.setReady(0);
          adapter.showInformationMessage(
            `DevMind: ${library} indexed — ${indexResult.chunksIndexed} chunks stored in Azure Search.`
          );

          // Update webview
          if (panel.isOpen()) {
            const usage = await docIndexService.getStorageUsage(projectId);
            panel.update({
              projectId,
              libraries: usage.indexes.map((i) => ({
                name: i.library,
                version: 'latest',
                documentCount: i.documentCount,
                storageBytes: i.storageBytes,
                status: 'indexed' as const,
                lastIndexed: new Date().toISOString(),
              })),
              totalDocuments: usage.totalDocuments,
              totalStorageBytes: usage.totalStorageBytes,
              lastRefreshed: new Date().toISOString(),
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          statusBar.setError(msg);
          adapter.showErrorMessage(`DevMind: Indexing failed — ${msg}`);
        }
      });
    },

    // Show webview with real storage data
    async showPanel(): Promise<void> {
      try {
        const usage = await docIndexService.getStorageUsage(projectId);
        panel.show({
          projectId,
          libraries: usage.indexes.map((i) => ({
            name: i.library,
            version: 'latest',
            documentCount: i.documentCount,
            storageBytes: i.storageBytes,
            status: 'indexed' as const,
            lastIndexed: new Date().toISOString(),
          })),
          totalDocuments: usage.totalDocuments,
          totalStorageBytes: usage.totalStorageBytes,
          lastRefreshed: new Date().toISOString(),
        });
      } catch {
        panel.show(buildEmptyState(projectId));
      }
    },

    async refreshPanel(): Promise<void> {
      try {
        const usage = await docIndexService.getStorageUsage(projectId);
        const state = {
          projectId,
          libraries: usage.indexes.map((i) => ({
            name: i.library,
            version: 'latest',
            documentCount: i.documentCount,
            storageBytes: i.storageBytes,
            status: 'indexed' as const,
            lastIndexed: new Date().toISOString(),
          })),
          totalDocuments: usage.totalDocuments,
          totalStorageBytes: usage.totalStorageBytes,
          lastRefreshed: new Date().toISOString(),
        };
        if (panel.isOpen()) {
          panel.update(state);
        } else {
          panel.show(state);
        }
      } catch {
        adapter.showErrorMessage('DevMind: Failed to refresh panel.');
      }
    },

    toggleFeature(): void {
      const enabled = (adapter.getConfiguration('versionGuard.enabled') as boolean) ?? true;
      vscode.workspace
        .getConfiguration('devmind')
        .update('versionGuard.enabled', !enabled, vscode.ConfigurationTarget.Global);
      if (enabled) {
        statusBar.setDisabled();
        adapter.showInformationMessage('DevMind Version Guard: Disabled.');
      } else {
        statusBar.setState({ state: 'idle', label: 'DevMind', tooltip: 'Version Guard ready' });
        adapter.showInformationMessage('DevMind Version Guard: Enabled.');
      }
    },

    clearDiagnostics(): void {
      diagManager.clearAll();
      statusBar.setReady(0);
      adapter.showInformationMessage('DevMind: All warnings cleared.');
    },

    async applyFix(warningId: string): Promise<void> {
      await provider.applyQuickFix(warningId);
      adapter.showInformationMessage('DevMind: Fix applied.');
    },
  };

  // 9. Register all commands
  const registry = new CommandRegistry(adapter, handlers);
  registry.registerAll();

  adapter.registerCommand('devmind.helloWorld', () => {
    adapter.showInformationMessage('Hello World from DevMind!');
  });

  const prPanelAdapter: PRSummaryPanelAdapter = {
    createWebviewPanel(viewType: string, title: string) {
      const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      return {
        get html() {
          return panel.webview.html;
        },
        set html(v: string) {
          panel.webview.html = v;
        },
        reveal() {
          panel.reveal(vscode.ViewColumn.Beside);
        },
        dispose() {
          panel.dispose();
        },
        postMessage(msg: unknown) {
          panel.webview.postMessage(msg);
        },
        onDidDispose(cb: () => void) {
          panel.onDidDispose(cb);
        },
        onDidReceiveMessage(cb: (msg: PanelMessage) => void) {
          panel.webview.onDidReceiveMessage(cb);
        },
      };
    },
    showInformationMessage: (msg: string) => {
      vscode.window.showInformationMessage(msg);
    },
    showErrorMessage: (msg: string) => {
      vscode.window.showErrorMessage(msg);
    },
    openExternal: (url: string) => {
      vscode.env.openExternal(vscode.Uri.parse(url));
    },
    writeClipboard: (text: string) => vscode.env.clipboard.writeText(text),
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    },
    async postSummaryToGitHub(summary: PRSummary): Promise<void> {
      const githubToken = process.env.GITHUB_TOKEN ?? '';

      if (!githubToken) {
        vscode.window.showErrorMessage(
          'DevMind: GITHUB_TOKEN not set. Add it to your .env file to post PR comments.'
        );
        return;
      }

      // AC-4.1: Wire GitHubMCPClient — uses PAT token, no DefaultAzureCredential
      const ghClient = new GitHubMCPClient({ token: githubToken });

      const poster = new PRCommentPoster(
        { enableLogging: true },
        {
          // Adapter wraps GitHubMCPClient — follows injected adapter pattern (TD-4.1)
          async listPRComments(owner, repo, prNumber) {
            const comments = await ghClient.listPRComments(owner, repo, prNumber);
            return comments.map((c) => ({ id: c.id, body: c.body, author: c.author, url: c.url }));
          },
          async createPRComment(owner, repo, prNumber, body) {
            const result = await ghClient.createPRComment(owner, repo, prNumber, { body });
            return { id: result.id, url: result.url };
          },
          async updatePRComment(owner, repo, commentId, body) {
            const result = await ghClient.updatePRComment(owner, repo, commentId, { body });
            return { id: result.id, url: result.url };
          },
        },
        {
          async confirm(message: string, detail?: string): Promise<boolean> {
            const choice = await vscode.window.showInformationMessage(
              message,
              { modal: true, detail: detail ?? '' },
              'Post Comment'
            );
            return choice === 'Post Comment';
          },
        }
      );

      const result = await poster.postSummary(summary);
      if (result) {
        const msg = `DevMind: Summary ${result.action} on GitHub PR #${summary.prNumber}`;
        const open = await vscode.window.showInformationMessage(msg, 'View on GitHub');
        if (open === 'View on GitHub' && result.commentUrl) {
          vscode.env.openExternal(vscode.Uri.parse(result.commentUrl));
        }
      }
    },
  };
  const prSummaryPanel = new PRSummaryPanel(prPanelAdapter);

  // Wire regenerate button — re-runs the full pipeline bypassing cache
  prSummaryPanel.onRegenerate(async (prNumber: number, repoLabel: string) => {
    const [owner, repo] = repoLabel.split('/');
    if (!owner || !repo) return;
    try {
      const summaryAgent = buildPRSummaryAgent();
      const result = await summaryAgent.refreshSummary(owner, repo, prNumber);
      prSummaryPanel.showSummary(result.summary);
      vscode.window.showInformationMessage(`DevMind: PR #${prNumber} summary regenerated`);
    } catch (err: any) {
      prSummaryPanel.showError(prNumber, err.message ?? String(err));
    }
  });

  // devmind.testPRSummary.loading — shows the loading spinner
  adapter.registerCommand('devmind.testPRSummary.loading', () => {
    prSummaryPanel.showLoading(76, 'DhRuva-1509/devmind');
  });

  // devmind.testPRSummary.success — shows a realistic success state
  adapter.registerCommand('devmind.testPRSummary.success', () => {
    const testSummaryText =
      '## Summary\n' +
      'This PR migrates all `useQuery` calls from the deprecated array syntax to the v5 object syntax across 6 files.\n\n' +
      '## Changes\n' +
      '- Updated `useQuery([key], fn)` to `useQuery({ queryKey, queryFn })` in all hooks\n' +
      '- Removed deprecated `onSuccess` / `onError` callbacks (moved to `useEffect`)\n' +
      '- Updated `useInfiniteQuery` page param signature\n' +
      '- Added migration test coverage for v5 patterns\n\n' +
      '## Impact\n' +
      'Low risk — purely syntactic migration with no behaviour changes. All existing tests pass.\n\n' +
      '## Notes\n' +
      'Linked to #10 (React Query v5 migration epic). Follow-up PR will update `useMutation` calls.';

    const testSummary = {
      id: 'pr-summary-DhRuva-1509-devmind-76',
      owner: 'DhRuva-1509',
      repo: 'devmind',
      prNumber: 76,
      prTitle: 'feat: migrate useQuery to v5 syntax',
      prState: 'open',
      summary: testSummaryText,
      chunkSummaries: [] as any[],
      wasChunked: false,
      foundryAgentId: 'agent-devmind-01',
      foundryThreadId: 'thread-abc123',
      templateVersion: '1.0.0',
      abVariant: null as string | null,
      status: 'complete' as const,
      errorMessage: null as string | null,
      trigger: 'command' as const,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      prUpdatedAt: new Date().toISOString(),
    };

    prSummaryPanel.showSummary(testSummary);
    prSummaryPanel.setLinkedIssues([
      {
        number: 10,
        title: 'React Query v5 migration epic',
        source: 'pr_body',
        url: 'https://github.com/DhRuva-1509/devmind/issues/10',
      },
      { number: 7, title: 'Upgrade @tanstack/react-query', source: 'branch_name', url: null },
    ]);
  });

  adapter.registerCommand('devmind.testPRSummary.error', () => {
    prSummaryPanel.showError(
      76,
      'Foundry agent unavailable — Azure AI service returned 503. Please try again in a few minutes.'
    );
  });

  function buildPRSummaryAgent(): PRSummaryAgent {
    const githubToken = process.env.GITHUB_TOKEN ?? '';
    const ghClient = new GitHubMCPClient({ token: githubToken });

    const contextAdapter = {
      async extractContext(owner: string, repo: string, prNumber: number) {
        const cosmosAdapter = {
          async read(container: string, id: string) {
            try {
              return await (cosmosService as any).read(container, id, `${owner}/${repo}`);
            } catch {
              return { success: false };
            }
          },
          async upsert(container: string, item: any) {
            try {
              // Inject partitionKey so Cosmos reads can find the document
              const withPartitionKey = {
                ...item,
                partitionKey: item.partitionKey ?? `${owner}/${repo}`,
              };
              return await (cosmosService as any).upsert(container, withPartitionKey);
            } catch {
              return { success: false };
            }
          },
        } as any;

        const githubAdapter = {
          async getPR(o: string, r: string, n: number) {
            return ghClient.getPR(o, r, n);
          },
          async getPRDiff(o: string, r: string, n: number) {
            return ghClient.getPRDiff(o, r, n);
          },
          async listPRComments(o: string, r: string, n: number) {
            return ghClient.listPRComments(o, r, n);
          },
        };

        const extractor = new PRContextExtractorService({}, githubAdapter, cosmosAdapter);
        return extractor.extractContext(owner, repo, prNumber);
      },
    };

    const blobAdapter = {
      async upload(container: string, key: string, content: string) {
        try {
          await blobService.uploadBlob(
            key,
            content,
            { contentType: 'application/json' },
            container
          );
          return { success: true };
        } catch (e: any) {
          return { success: false, error: e.message };
        }
      },
      async download(container: string, key: string) {
        try {
          const result = await (blobService as any).downloadBlob(key, undefined, container);
          let raw = result?.content ?? result?.data ?? result;
          let depth = 0;
          while (raw && typeof raw === 'object' && !Buffer.isBuffer(raw) && depth < 5) {
            raw = raw.content ?? raw.data ?? raw.body ?? raw.text ?? null;
            depth++;
          }
          const str =
            raw == null
              ? undefined
              : Buffer.isBuffer(raw)
                ? raw.toString('utf8')
                : typeof raw === 'string'
                  ? raw
                  : JSON.stringify(raw);
          return { success: true, content: str };
        } catch {
          return { success: false };
        }
      },
      async exists(container: string, key: string) {
        return blobService.blobExists(key, container);
      },
      async listKeys(container: string, prefix: string) {
        return [];
      },
    };

    const promptService = new PromptTemplateService({}, blobAdapter);
    const promptAdapter = {
      async renderPrompt(context: any) {
        return promptService.renderPrompt(context);
      },
      async renderErrorPrompt(prNumber: number, prUrl: string) {
        return promptService.renderErrorPrompt(prNumber, prUrl);
      },
    };

    const foundryAdapter = {
      async runAgent(agentId: string, systemPrompt: string, userMessage: string) {
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? '';
        const apiKey = process.env.AZURE_OPENAI_API_KEY ?? '';
        const url = `${endpoint}openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01`;
        const start = Date.now();
        const response = await axios.post(
          url,
          {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          },
          {
            headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
            timeout: 60000,
          }
        );
        return {
          threadId: `direct-${Date.now()}`,
          content: response.data.choices[0]?.message?.content ?? '',
          tokenCount: response.data.usage?.total_tokens ?? 0,
          durationMs: Date.now() - start,
        };
      },
      async isAvailable() {
        return !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);
      },
    };

    const cacheAdapter = {
      async read<T>(container: string, id: string, partitionKey: string) {
        try {
          return (await (cosmosService as any).read(container, id, partitionKey)) as {
            success: boolean;
            data?: T;
          };
        } catch {
          return { success: false as const };
        }
      },
      async upsert<T extends { id: string }>(container: string, item: T) {
        try {
          const itemWithKey = {
            ...item,
            partitionKey:
              (item as any).owner && (item as any).repo
                ? `${(item as any).owner}/${(item as any).repo}`
                : ((item as any).partitionKey ?? 'default'),
          };
          return await (cosmosService as any).upsert(container, itemWithKey);
        } catch {
          return { success: false };
        }
      },
    };

    return new PRSummaryAgent(
      {
        enableCaching: true,
        enableLogging: true,
        foundryAgentId: 'devmind-gpt4o',
        refreshOnUpdate: false,
      },
      contextAdapter,
      promptAdapter,
      foundryAdapter,
      cacheAdapter
    );
  }

  adapter.registerCommand('devmind.generatePRSummary', async () => {
    // Ask for owner/repo
    const repoInput = await vscode.window.showInputBox({
      prompt: 'Enter GitHub owner/repo (e.g. DhRuva-1509/devmind)',
      value: 'DhRuva-1509/devmind',
      placeHolder: 'owner/repo',
    });
    if (!repoInput) return;

    const [owner, repo] = repoInput.split('/');
    if (!owner || !repo) {
      vscode.window.showErrorMessage('DevMind: Invalid format. Use owner/repo');
      return;
    }

    const prInput = await vscode.window.showInputBox({
      prompt: 'Enter PR number',
      placeHolder: '76',
    });
    if (!prInput) return;
    const prNumber = parseInt(prInput, 10);
    if (isNaN(prNumber)) {
      vscode.window.showErrorMessage('DevMind: Invalid PR number');
      return;
    }

    prSummaryPanel.showLoading(prNumber, `${owner}/${repo}`);

    try {
      const summaryAgent = buildPRSummaryAgent();
      const result = await summaryAgent.generateSummary(owner, repo, prNumber, 'command');
      const { summary } = result;

      prSummaryPanel.showSummary(summary);

      if (summary.prNumber) {
        const ghClient = new GitHubMCPClient({ token: process.env.GITHUB_TOKEN ?? '' });
        try {
          const pr = await ghClient.getPR(owner, repo, prNumber);
          prSummaryPanel.setLinkedIssues(
            pr.linkedIssues.map((n: number) => ({
              number: n,
              title: null,
              source: 'pr_body',
              url: `https://github.com/${owner}/${repo}/issues/${n}`,
            }))
          );
        } catch {
          /* non-fatal */
        }
      }

      vscode.window.showInformationMessage(
        `DevMind: PR #${prNumber} summary generated (${result.fromCache ? 'from cache' : 'fresh'})`
      );
    } catch (err: any) {
      prSummaryPanel.showError(prNumber, err.message ?? String(err));
      vscode.window.showErrorMessage(`DevMind: Failed to generate summary — ${err.message}`);
    }
  });

  console.log(
    `DevMind: activated — ${registry.getRegisteredCommands().length} commands registered ✓`
  );
}

function buildEmptyState(projectId: string): WebviewState {
  return {
    projectId,
    libraries: [],
    totalDocuments: 0,
    totalStorageBytes: 0,
    lastRefreshed: new Date().toISOString(),
  };
}

export function deactivate(): void {}
