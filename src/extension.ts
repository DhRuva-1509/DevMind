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

// ── Build VersionGuardAgent adapters ──────────────────────────

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
        // upsert<T>(containerName, item) — item needs id field for Cosmos
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
      await blobService.uploadBlob(key, content, { contentType: 'application/json' }, container);
    },
    async exists(container: string, key: string): Promise<boolean> {
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
    // Try to fetch the actual docs page
    const response = await axios.get(entry.url, {
      timeout: 10000,
      headers: { 'User-Agent': 'DevMind/1.0' },
      responseType: 'text',
    });

    const html = response.data as string;

    // Simple text extraction — strip HTML tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Split into ~500 token chunks
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
    // Fallback: use built-in description if fetch fails
    console.log(`DevMind: fetch failed for ${library}, using fallback description`);
  }

  // Always add the built-in description as a chunk
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

// ── Activate ──────────────────────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  console.log('DevMind: activating...');

  // 1. VS Code adapter
  const adapter = buildAdapter(context);

  // 2. UI service classes
  const diagManager = new VersionGuardDiagnostics(adapter);
  const statusBar = new StatusBarManager(adapter);
  const panel = new VersionGuardPanel(adapter);
  const provider = new VersionGuardProvider(diagManager, adapter);
  const progress = new ProgressManager(adapter);

  // 3. Feature toggle (reads VS Code setting)
  const toggle: FeatureToggleAdapter = {
    isEnabled(): boolean {
      return (adapter.getConfiguration('versionGuard.enabled') as boolean) ?? true;
    },
  };

  // 4. Azure services
  const {
    openaiService,
    searchService,
    blobService,
    cosmosService,
    directSearchIndexClient,
    getDirectSearchClient,
  } = buildAzureServices();

  // 5. Project ID from workspace
  const projectId = vscode.workspace.name ?? 'devmind';

  // 6. Higher-level services
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

  // 7. Code action provider (lightbulb)
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

  // 8. Command handlers — real Azure pipeline
  const handlers: CommandHandlers = {
    // REAL: Analyze file using VersionGuardAgent → Azure OpenAI + Search
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

    // REAL: Index library using DocCrawler → Blob → DocIndexService → Azure Search
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
