import * as vscode from 'vscode';
import * as path from 'path';
import * as dotenv from 'dotenv';

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

import { RoutingAgentService } from './services/routing/routing.agent.service';

import {
  ConflictCodeLensManager,
  ConflictHoverManager,
  ConflictExplainerPanel,
} from './services/conflict-explainer-ui/conflict.explainer.ui';
import {
  CONFLICT_COMMANDS,
  ConflictPanelAdapter,
} from './services/conflict-explainer-ui/conflict.explainer.ui.types';
import { GitConflictParserService } from './services/conflict-parser/conflict.parser.service';
import { ConflictExplainerAgent } from './services/conflict-explainer/conflict.explainer.agent';

import { NitpickFixerPanel } from './services/nitpick-fixer-ui/nitpick.fixer.ui';
import {
  NitpickPanelAdapter,
  NitpickPanelWebviewPanel,
  NitpickPanelMessage,
  NITPICK_COMMANDS,
} from './services/nitpick-fixer-ui/nitpick.fixer.ui.types';
import { NitpickFixerAgent } from './services/nitpick-fixer/nitpick.fixer.agent';

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
        try {
          await directIndexClient.getIndex(name);
          return { success: true };
        } catch {
          // doesn't exist — create it
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
        return {
          succeeded,
          failed,
          errors: result.results
            .filter((r: any) => !r.succeeded)
            .map((r: any) => ({ key: r.key ?? '', message: r.errorMessage ?? '' })),
        };
      } catch (e: any) {
        return {
          succeeded: 0,
          failed: docs.length,
          errors: [{ key: 'all', message: e.message ?? '' }],
        };
      }
    },
    async deleteDocuments(indexName, ids) {
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

        const searchText = query && query.trim() ? query : '*';
        const iter = await directClient.search(searchText, searchOptions);
        for await (const result of iter.results) {
          searchResults.push({
            document: result.document,
            score: result.score ?? 0,
            rerankerScore: result.rerankerScore ?? 0,
          });
        }
        return { results: searchResults, durationMs: Date.now() - start };
      } catch (e: any) {
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
        const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? '';
        const apiKey = process.env.AZURE_OPENAI_API_KEY ?? '';
        const url = `${endpoint}openai/deployments/text-embedding-3-small/embeddings?api-version=2024-02-01`;
        const inputTexts = Array.isArray(texts) ? texts : [texts];
        const response = await axios.post(
          url,
          { input: inputTexts },
          { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 30000 }
        );
        const embeddings: number[][] = response.data.data.map((d: any) => d.embedding);
        return { embeddings };
      } catch (e: any) {
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
          { messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1000 },
          { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 }
        );
        const text = response.data.choices[0]?.message?.content ?? '';
        const clean = text.replace(/```json|```/g, '').trim();
        return JSON.parse(clean) as OpenAIAnalysisResponse;
      } catch {
        return { warnings: [] };
      }
    },
  };

  const loggingAdapter: LoggingAdapter = {
    async log(entry) {
      try {
        await cosmosService.upsert('telemetry', entry as any);
      } catch {}
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

function buildRoutingAgent(cosmosService: CosmosDBService): RoutingAgentService {
  // Classifier adapter — direct REST call to GPT-4o (TD-3.2: API key, not DefaultAzureCredential)
  const classifierAdapter = {
    async complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? '';
      const apiKey = process.env.AZURE_OPENAI_API_KEY ?? '';
      const url = `${endpoint}openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01`;
      const response = await axios.post(
        url,
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: maxTokens,
        },
        { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
      );
      return response.data.choices[0]?.message?.content ?? '{}';
    },
  };

  const loggingAdapter = {
    async log(entry: any): Promise<void> {
      try {
        await (cosmosService as any).upsert('telemetry', {
          ...entry,
          partitionKey: entry.route ?? 'routing',
        });
      } catch {
        // non-fatal
      }
    },
  };

  return new RoutingAgentService(
    { enableLogging: true, enableConsoleLogging: true },
    classifierAdapter,
    loggingAdapter
  );
}

function buildConflictExplainerAgent(cosmosService: CosmosDBService): ConflictExplainerAgent {
  const openaiAdapter = {
    async complete(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT ?? '';
      const apiKey = process.env.AZURE_OPENAI_API_KEY ?? '';
      const url = `${endpoint}openai/deployments/gpt-4o/chat/completions?api-version=2024-02-01`;
      const response = await axios.post(
        url,
        {
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
        },
        { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 }
      );
      return response.data.choices[0]?.message?.content ?? '{}';
    },
  };
  const loggingAdapter = {
    async log(entry: any): Promise<void> {
      try {
        await (cosmosService as any).upsert('telemetry', {
          ...entry,
          partitionKey: entry.filePath ?? 'conflict',
        });
      } catch {
        /* non-fatal */
      }
    },
  };
  return new ConflictExplainerAgent(
    { enableLogging: true, enableConsoleLogging: true, confidenceThreshold: 0.6 },
    openaiAdapter,
    loggingAdapter
  );
}

function buildNitpickFixerAgent(
  cwd: string,
  cosmosService: CosmosDBService,
  nitpickPanel: NitpickFixerPanel
): NitpickFixerAgent {
  const linterAdapter = {
    async runAll(_paths: string[], cwdArg: string) {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const allFixes: any[] = [];
      const results: any[] = [];
      let totalRemainingIssues = 0;

      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

      try {
        console.log(`[DevMind] Running ESLint --fix in ${cwdArg}`);
        let eslintRaw = '';
        try {
          const r = await execFileAsync(npxBin, ['eslint', 'src', '--fix', '--format', 'json'], {
            cwd: cwdArg,
            timeout: 60000,
          });
          eslintRaw = r.stdout;
        } catch (e: any) {
          eslintRaw = e.stdout ?? '';
        }
        const parsed = eslintRaw ? JSON.parse(eslintRaw) : [];
        let errors = 0;
        let warnings = 0;
        for (const file of parsed) {
          errors += file.errorCount ?? 0;
          warnings += file.warningCount ?? 0;
          const fixCount = (file.fixableErrorCount ?? 0) + (file.fixableWarningCount ?? 0);
          if (fixCount > 0) {
            allFixes.push({
              linter: 'eslint' as const,
              filePath: file.filePath,
              ruleId: null,
              description: `Applied ${fixCount} ESLint fix(es)`,
            });
          }
        }
        totalRemainingIssues += errors + warnings;
        results.push({
          linter: 'eslint',
          success: errors === 0,
          appliedFixes: allFixes.filter((f: any) => f.linter === 'eslint'),
          remainingIssues: errors + warnings,
          raw: eslintRaw,
          durationMs: 0,
        });
        console.log(`[DevMind] ESLint done: ${errors} errors, ${warnings} warnings`);
      } catch (err: any) {
        console.error(`[DevMind] ESLint failed: ${err.message}`);
      }

      try {
        console.log(`[DevMind] Running Prettier --write in ${cwdArg}`);
        let checkRaw = '';
        try {
          const r = await execFileAsync(npxBin, ['prettier', '--check', 'src'], {
            cwd: cwdArg,
            timeout: 30000,
          });
          checkRaw = r.stdout + r.stderr;
        } catch (e: any) {
          checkRaw = (e.stdout ?? '') + (e.stderr ?? '');
        }
        await execFileAsync(npxBin, ['prettier', '--write', 'src'], {
          cwd: cwdArg,
          timeout: 30000,
        }).catch(() => {});
        const unformatted = checkRaw
          .split('\n')
          .filter((l: string) => l.includes('[warn]'))
          .map((l: string) => l.replace('[warn]', '').trim())
          .filter(Boolean);
        const prettierFixes = unformatted.map((f: string) => ({
          linter: 'prettier' as const,
          filePath: f,
          ruleId: null,
          description: 'Applied Prettier formatting',
        }));
        allFixes.push(...prettierFixes);
        results.push({
          linter: 'prettier',
          success: true,
          appliedFixes: prettierFixes,
          remainingIssues: 0,
          raw: checkRaw,
          durationMs: 0,
        });
        console.log(`[DevMind] Prettier done: ${prettierFixes.length} files reformatted`);
      } catch (err: any) {
        console.error(`[DevMind] Prettier failed: ${err.message}`);
      }

      if (results.length === 0) {
        const err: any = new Error(`No linters could run in ${cwdArg}`);
        err.code = 'NO_LINTERS_DETECTED';
        err.name = 'NoLintersDetectedError';
        throw err;
      }

      try {
        const gitStatus = await execFileAsync('git', ['status', '--porcelain'], {
          cwd: cwdArg,
          timeout: 10000,
        });
        const changedFiles = gitStatus.stdout.trim().split('\n').filter(Boolean);
        console.log(`[DevMind] Git status: ${changedFiles.length} changed files`);
        if (changedFiles.length > 0 && allFixes.length === 0) {
          // Linters wrote files but didn't report fixes — synthesise fix entries
          for (const line of changedFiles) {
            const filePath = line.slice(3).trim();
            if (filePath.startsWith('src/')) {
              allFixes.push({
                linter: 'prettier' as const,
                filePath,
                ruleId: null,
                description: 'Applied formatting',
              });
            }
          }
          console.log(`[DevMind] Synthesised ${allFixes.length} fixes from git status`);
        }
      } catch (e: any) {
        console.error(`[DevMind] git status failed: ${e.message}`);
      }

      return {
        cwd: cwdArg,
        results,
        allFixes,
        totalRemainingIssues,
        completedAt: new Date().toISOString(),
        durationMs: 0,
      };
    },
  };

  const gitAdapter = {
    async getDiff(cwdArg: string): Promise<string> {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      try {
        // staged + unstaged changes on tracked files
        const tracked = await execFileAsync('git', ['diff', 'HEAD'], {
          cwd: cwdArg,
          timeout: 15000,
        })
          .then((r) => r.stdout)
          .catch((e: any) => e.stdout ?? '');
        // untracked new files
        const untracked = await execFileAsync(
          'git',
          ['ls-files', '--others', '--exclude-standard'],
          { cwd: cwdArg, timeout: 10000 }
        )
          .then((r) => r.stdout)
          .catch(() => '');
        const combined = [tracked, untracked ? `(untracked files)\n${untracked}` : '']
          .filter(Boolean)
          .join('\n');
        console.log(
          `[DevMind] getDiff: tracked=${tracked.length} chars, untracked=${untracked.trim().split('\n').filter(Boolean).length} files`
        );
        return combined || ' '; // never return empty — agent skips confirm if diff is falsy
      } catch (e: any) {
        return e.stdout ?? ' ';
      }
    },
    async stageAll(cwdArg: string): Promise<void> {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      // git add -A stages tracked changes + untracked files + deletions
      await execFileAsync('git', ['add', '-A'], { cwd: cwdArg, timeout: 15000 });
      console.log(`[DevMind] git add -A done in ${cwdArg}`);
    },
    async commit(message: string, cwdArg: string): Promise<string> {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      await execFileAsync('git', ['commit', '-m', message], { cwd: cwdArg, timeout: 15000 });
      console.log(`[DevMind] git commit done: "${message}"`);
      return message;
    },
    async getLastCommitSha(cwdArg: string): Promise<string> {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      try {
        const r = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd: cwdArg,
          timeout: 10000,
        });
        return r.stdout.trim();
      } catch {
        return 'unknown';
      }
    },
  };

  let _resolvedCommitMessage = 'style: auto-fix linting issues';
  const confirmAdapter = {
    async confirm(diff: any, summary: string): Promise<boolean> {
      return new Promise((resolve) => {
        // Build a synthetic diff if agent parsed nothing (e.g. untracked files)
        const displayDiff =
          diff?.totalFiles > 0
            ? diff
            : {
                files: (diff?.raw ?? '')
                  .split('\n')
                  .filter((l: string) => l.trim())
                  .slice(0, 10)
                  .map((f: string) => ({
                    filePath: f.replace('(untracked files)', '').trim(),
                    diff: '',
                    additions: 0,
                    deletions: 0,
                  }))
                  .filter((f: any) => f.filePath),
                totalFiles: 1,
                totalAdditions: 0,
                totalDeletions: 0,
                raw: diff?.raw ?? 'Linter fixes applied',
              };
        nitpickPanel.showConfirming(displayDiff, summary, 0);
        nitpickPanel.onAccept((_selectedFiles, commitMessage) => {
          _resolvedCommitMessage = commitMessage || _resolvedCommitMessage;
          resolve(true);
        });
        nitpickPanel.onReject(() => resolve(false));
      });
    },
    getCommitMessage(): string {
      return _resolvedCommitMessage;
    },
  };

  const loggingAdapter = {
    async log(entry: any): Promise<void> {
      try {
        await (cosmosService as any).upsert('telemetry', {
          ...entry,
          partitionKey: entry.cwd ?? 'nitpick',
        });
      } catch {
        /* non-fatal */
      }
    },
  };

  return new NitpickFixerAgent(
    {
      cwd,
      autoCommitEnabled: true,
      stageAll: true,
      enableLogging: true,
      enableConsoleLogging: true,
    },
    linterAdapter,
    gitAdapter,
    confirmAdapter,
    loggingAdapter
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

function buildChatHtml(initialMessage: string): string {
  const escaped = initialMessage
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/  •/g, '&nbsp;&nbsp;•')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DevMind Chat</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    margin: 0; padding: 0;
    display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  }
  /* ── Header ── */
  #header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--vscode-widget-border);
    background: var(--vscode-editorWidget-background);
    flex-shrink: 0;
  }
  #header .logo { font-size: 16px; }
  #header h1 { margin: 0; font-size: 13px; font-weight: 600;
    color: var(--vscode-editor-foreground); }
  #header .subtitle { font-size: 11px; color: var(--vscode-descriptionForeground); margin-left: auto; }
  /* ── Messages ── */
  #messages {
    flex: 1; overflow-y: auto; padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .msg-row { display: flex; gap: 8px; align-items: flex-start; }
  .msg-row.user { flex-direction: row-reverse; }
  .avatar {
    width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; font-size: 12px;
  }
  .avatar.agent { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .avatar.user  { background: var(--vscode-badge-background);  color: var(--vscode-badge-foreground); }
  .bubble {
    max-width: 78%; padding: 8px 12px; border-radius: 8px; line-height: 1.55;
    font-size: 12.5px;
  }
  .bubble.agent {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border);
    border-top-left-radius: 2px;
  }
  .bubble.user {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-top-right-radius: 2px;
  }
  .bubble.error {
    background: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
  }
  .bubble.thinking { opacity: 0.65; font-style: italic; }
  .route-badge {
    display: inline-block; margin-top: 6px; font-size: 10px;
    padding: 2px 7px; border-radius: 10px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  /* ── Input area ── */
  #input-area {
    flex-shrink: 0;
    border-top: 1px solid var(--vscode-widget-border);
    padding: 10px 16px 12px;
    background: var(--vscode-editorWidget-background);
  }
  #input-row { display: flex; gap: 8px; align-items: center; }
  #input {
    flex: 1;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 6px; padding: 7px 11px; font-size: 12.5px;
    outline: none; font-family: inherit;
    transition: border-color 0.15s;
  }
  #input:focus { border-color: var(--vscode-focusBorder); }
  #input::placeholder { color: var(--vscode-input-placeholderForeground); }
  #send {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 6px; padding: 7px 14px;
    cursor: pointer; font-size: 12.5px; font-family: inherit;
    transition: background 0.15s; white-space: nowrap;
  }
  #send:hover { background: var(--vscode-button-hoverBackground); }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
  #hint { margin-top: 5px; font-size: 10.5px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<div id="header">
  <span class="logo"></span>
  <h1>DevMind Chat</h1>
  <span class="subtitle">Powered by GPT-4o</span>
</div>

<div id="messages">
  <div class="msg-row">
    <div class="avatar agent">DM</div>
    <div class="bubble agent">${escaped}</div>
  </div>
</div>

<div id="input-area">
  <div id="input-row">
    <input id="input" type="text"
      placeholder="e.g. analyze this file · summarize PR #76 · explain this conflict…"
      autofocus />
    <button id="send">Send ↵</button>
  </div>
  <div id="hint">Press <kbd>Enter</kbd> to send · routes to the right DevMind agent automatically</div>
</div>

<script>
  const vscode = acquireVsCodeApi();
  const messagesEl = document.getElementById('messages');
  const inputEl    = document.getElementById('input');
  const sendBtn    = document.getElementById('send');

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/  •/g, '&nbsp;&nbsp;•')
      .replace(/\\n/g, '<br>');
  }

  function addMessage(text, type, route) {
    const row = document.createElement('div');
    row.className = 'msg-row' + (type === 'user' ? ' user' : '');

    const avatar = document.createElement('div');
    avatar.className = 'avatar ' + (type === 'user' ? 'user' : 'agent');
    avatar.textContent = type === 'user' ? 'You' : 'DM';

    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + type;
    bubble.innerHTML = escapeHtml(text);

    if (route && type === 'agent') {
      const badge = document.createElement('div');
      badge.className = 'route-badge';
      badge.textContent = '→ ' + route;
      bubble.appendChild(badge);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return bubble;
  }

  function setInputEnabled(enabled) {
    inputEl.disabled  = !enabled;
    sendBtn.disabled  = !enabled;
  }

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    inputEl.value = '';
    setInputEnabled(false);
    vscode.postMessage({ command: 'send', text });
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) sendMessage(); });

  window.addEventListener('message', event => {
    const { command, text, route } = event.data;
    if (command === 'thinking') {
      addMessage('Routing your request…', 'agent thinking');
    } else if (command === 'response') {
      addMessage(text, 'agent', route);
      setInputEnabled(true);
      inputEl.focus();
    } else if (command === 'info') {
      addMessage(text, 'agent');
      setInputEnabled(true);
      inputEl.focus();
    } else if (command === 'error') {
      addMessage(text, 'error');
      setInputEnabled(true);
      inputEl.focus();
    }
  });
</script>
</body>
</html>`;
}

export function activate(context: vscode.ExtensionContext): void {
  console.log('DevMind: activating...');

  const adapter = buildAdapter(context);

  const diagManager = new VersionGuardDiagnostics(adapter);
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

  const routingAgent = buildRoutingAgent(cosmosService);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(robot) DevMind';
  statusBarItem.tooltip = 'DevMind — click to open chat';
  statusBarItem.command = 'devmind.openChat';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const vgStatusBarReal = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  context.subscriptions.push(vgStatusBarReal);
  const vgStatusAdapter: VscodeAdapter = {
    ...adapter,
    createStatusBarItem(): StatusBarItem {
      return {
        get text() {
          return vgStatusBarReal.text;
        },
        set text(v) {
          vgStatusBarReal.text = v;
        },
        get tooltip() {
          return typeof vgStatusBarReal.tooltip === 'string' ? vgStatusBarReal.tooltip : '';
        },
        set tooltip(v) {
          vgStatusBarReal.tooltip = v;
        },
        get command() {
          return typeof vgStatusBarReal.command === 'string' ? vgStatusBarReal.command : undefined;
        },
        set command(v) {
          vgStatusBarReal.command = v;
        },
        show() {
          vgStatusBarReal.show();
        },
        hide() {
          vgStatusBarReal.hide();
        },
        dispose() {
          vgStatusBarReal.dispose();
        },
      };
    },
  };
  const statusBar = new StatusBarManager(vgStatusAdapter);

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
          const chunks = await fetchAndChunkDocs(library, projectId);
          const indexResult = await docIndexService.indexChunks(projectId, library, chunks);
          statusBar.setReady(0);
          adapter.showInformationMessage(
            `DevMind: ${library} indexed — ${indexResult.chunksIndexed} chunks stored in Azure Search.`
          );
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
        panel.isOpen() ? panel.update(state) : panel.show(state);
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

  const registry = new CommandRegistry(adapter, handlers);
  registry.registerAll();

  adapter.registerCommand('devmind.helloWorld', () => {
    adapter.showInformationMessage('Hello World from DevMind!');
  });

  const prPanelAdapter: PRSummaryPanelAdapter = {
    createWebviewPanel(viewType: string, title: string) {
      const p = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      return {
        get html() {
          return p.webview.html;
        },
        set html(v: string) {
          p.webview.html = v;
        },
        reveal() {
          p.reveal(vscode.ViewColumn.Beside);
        },
        dispose() {
          p.dispose();
        },
        postMessage(msg: unknown) {
          p.webview.postMessage(msg);
        },
        onDidDispose(cb: () => void) {
          p.onDidDispose(cb);
        },
        onDidReceiveMessage(cb: (msg: PanelMessage) => void) {
          p.webview.onDidReceiveMessage(cb);
        },
      };
    },
    showInformationMessage: (msg: string) => vscode.window.showInformationMessage(msg),
    showErrorMessage: (msg: string) => vscode.window.showErrorMessage(msg),
    openExternal: (url: string) => vscode.env.openExternal(vscode.Uri.parse(url)),
    writeClipboard: (text: string) => vscode.env.clipboard.writeText(text),
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    },
    async postSummaryToGitHub(summary: PRSummary): Promise<void> {
      const githubToken = process.env.GITHUB_TOKEN ?? '';
      if (!githubToken) {
        vscode.window.showErrorMessage('DevMind: GITHUB_TOKEN not set. Add it to your .env file.');
        return;
      }
      const ghClient = new GitHubMCPClient({ token: githubToken });
      const poster = new PRCommentPoster(
        { enableLogging: true },
        {
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

  adapter.registerCommand('devmind.testPRSummary.loading', () => {
    prSummaryPanel.showLoading(76, 'DhRuva-1509/devmind');
  });

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

    prSummaryPanel.showSummary({
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
    });
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
              return await (cosmosService as any).upsert(container, {
                ...item,
                partitionKey: item.partitionKey ?? `${owner}/${repo}`,
              });
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
      async listKeys(_container: string, _prefix: string) {
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
      async runAgent(_agentId: string, systemPrompt: string, userMessage: string) {
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
          { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 60000 }
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
          return await (cosmosService as any).upsert(container, {
            ...item,
            partitionKey:
              (item as any).owner && (item as any).repo
                ? `${(item as any).owner}/${(item as any).repo}`
                : ((item as any).partitionKey ?? 'default'),
          });
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
      prSummaryPanel.showSummary(result.summary);
      if (result.summary.prNumber) {
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

  const conflictParser = new GitConflictParserService();
  const conflictCodeLens = new ConflictCodeLensManager();
  const conflictHover = new ConflictHoverManager();

  const conflictPanelAdapter: ConflictPanelAdapter = {
    createWebviewPanel(viewType: string, title: string) {
      const p = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      return {
        get html() {
          return p.webview.html;
        },
        set html(v: string) {
          p.webview.html = v;
        },
        reveal() {
          p.reveal(vscode.ViewColumn.Beside);
        },
        dispose() {
          p.dispose();
        },
        postMessage(msg: unknown) {
          p.webview.postMessage(msg);
        },
        onDidDispose(cb: () => void) {
          p.onDidDispose(cb);
        },
        onDidReceiveMessage(cb: any) {
          p.webview.onDidReceiveMessage(cb);
        },
      };
    },
    showInformationMessage: (msg: string) => vscode.window.showInformationMessage(msg),
    showErrorMessage: (msg: string) => vscode.window.showErrorMessage(msg),
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    },
  };

  const conflictPanel = new ConflictExplainerPanel(conflictPanelAdapter);

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/*' },
      {
        provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
          const uri = document.uri.toString();
          const content = document.getText();
          const entries = conflictCodeLens.provideCodeLenses(uri, content);
          return entries.map((entry) => {
            const range = new vscode.Range(entry.line, 0, entry.line, 0);
            return new vscode.CodeLens(range, {
              title: entry.title,
              command: entry.command,
              arguments: entry.args,
            });
          });
        },
      }
    )
  );

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { pattern: '**/*' },
      {
        provideHover(
          document: vscode.TextDocument,
          position: vscode.Position
        ): vscode.Hover | null {
          const uri = document.uri.toString();
          const content = document.getText();
          const entry = conflictHover.provideHover(uri, position.line, content);
          if (!entry) return null;
          return new vscode.Hover(new vscode.MarkdownString(entry.markdownContent));
        },
      }
    )
  );

  adapter.registerCommand(CONFLICT_COMMANDS.EXPLAIN_FILE, async (...args: unknown[]) => {
    const uri = args[0] as string | undefined;
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc) {
      vscode.window.showWarningMessage('DevMind: No active file.');
      return;
    }
    const filePath = uri ?? doc.uri.toString();
    const content = doc.getText();
    const { context: parseCtx, hasConflicts } = conflictParser.parse(filePath, content);
    if (!hasConflicts) {
      vscode.window.showInformationMessage('DevMind: No merge conflicts found in this file.');
      return;
    }
    conflictPanel.showLoading(filePath, parseCtx.conflictCount);
    conflictHover.clearFile(filePath);
    try {
      const conflictAgent = buildConflictExplainerAgent(cosmosService);
      const result = await conflictAgent.explain(parseCtx);
      const displays = result.explanations.map((exp) => ({
        conflictIndex: exp.conflictIndex,
        startLine: exp.startLine,
        endLine: exp.endLine,
        currentIntent: exp.currentSide.intent,
        currentKeyChanges: exp.currentSide.keyChanges,
        incomingIntent: exp.incomingSide.intent,
        incomingKeyChanges: exp.incomingSide.keyChanges,
        resolutionStrategy: exp.resolutionStrategy,
        confidenceScore: exp.confidenceScore,
        filePath,
      }));
      displays.forEach((d) => conflictHover.storeExplanation(filePath, d));
      conflictPanel.showExplanations(filePath, displays);
      const statusMsg =
        result.status === 'complete'
          ? `DevMind: ${displays.length} conflict${displays.length === 1 ? '' : 's'} explained.`
          : `DevMind: ${result.successCount}/${result.successCount + result.failureCount} conflicts explained (${result.status}).`;
      vscode.window.showInformationMessage(statusMsg);
    } catch (err: any) {
      conflictPanel.showError(filePath, err.message ?? String(err));
      vscode.window.showErrorMessage(`DevMind: Conflict analysis failed — ${err.message}`);
    }
  });

  adapter.registerCommand(CONFLICT_COMMANDS.EXPLAIN_SINGLE, async (...args: unknown[]) => {
    const uri = args[0] as string | undefined;
    const conflictIndex = args[1] as number | undefined;
    await vscode.commands.executeCommand(CONFLICT_COMMANDS.EXPLAIN_FILE, uri);
    if (conflictIndex !== undefined && conflictIndex >= 0) {
      setTimeout(() => conflictPanel.navigateTo(conflictIndex), 200);
    }
  });

  adapter.registerCommand(CONFLICT_COMMANDS.NEXT_CONFLICT, () => {
    const idx = (conflictPanel as any).state?.currentIndex;
    conflictPanel.navigateTo((typeof idx === 'number' ? idx : 0) + 1);
  });
  adapter.registerCommand(CONFLICT_COMMANDS.PREV_CONFLICT, () => {
    const idx = (conflictPanel as any).state?.currentIndex;
    conflictPanel.navigateTo((typeof idx === 'number' ? idx : 0) - 1);
  });

  const nitpickPanelAdapter: NitpickPanelAdapter = {
    createWebviewPanel(viewType: string, title: string): NitpickPanelWebviewPanel {
      const p = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
      });
      return {
        get html() {
          return p.webview.html;
        },
        set html(v: string) {
          p.webview.html = v;
        },
        reveal() {
          p.reveal(vscode.ViewColumn.Beside);
        },
        dispose() {
          p.dispose();
        },
        postMessage(msg: unknown) {
          p.webview.postMessage(msg);
        },
        onDidDispose(cb: () => void) {
          p.onDidDispose(cb);
        },
        onDidReceiveMessage(cb: (msg: NitpickPanelMessage) => void) {
          p.webview.onDidReceiveMessage(cb);
        },
      };
    },
    showInformationMessage: (msg: string) => vscode.window.showInformationMessage(msg),
    showErrorMessage: (msg: string) => vscode.window.showErrorMessage(msg),
    registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
      context.subscriptions.push(vscode.commands.registerCommand(id, handler));
    },
  };

  const nitpickPanel = new NitpickFixerPanel(nitpickPanelAdapter);

  adapter.registerCommand(NITPICK_COMMANDS.FIX_NITPICKS, async () => {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    nitpickPanel.onRerun(async () => {
      await vscode.commands.executeCommand(NITPICK_COMMANDS.FIX_NITPICKS);
    });

    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

      nitpickPanel.showRunning('Running ESLint --fix…');
      let eslintFixCount = 0;
      try {
        let eslintRaw = '';
        try {
          const r = await execFileAsync(npxBin, ['eslint', 'src', '--fix', '--format', 'json'], {
            cwd,
            timeout: 60000,
          });
          eslintRaw = r.stdout;
        } catch (e: any) {
          eslintRaw = e.stdout ?? '';
        }
        if (eslintRaw) {
          const parsed = JSON.parse(eslintRaw);
          for (const f of parsed)
            eslintFixCount += (f.fixableErrorCount ?? 0) + (f.fixableWarningCount ?? 0);
        }
        console.log(`[DevMind] ESLint done: ${eslintFixCount} fixes applied`);
      } catch (e: any) {
        console.error(`[DevMind] ESLint error: ${e.message}`);
      }

      nitpickPanel.showRunning('Running Prettier --write…');
      let prettierFixCount = 0;
      try {
        let checkRaw = '';
        try {
          const r = await execFileAsync(npxBin, ['prettier', '--check', 'src'], {
            cwd,
            timeout: 30000,
          });
          checkRaw = r.stdout + r.stderr;
        } catch (e: any) {
          checkRaw = (e.stdout ?? '') + (e.stderr ?? '');
        }
        prettierFixCount = checkRaw.split('\n').filter((l: string) => l.includes('[warn]')).length;
        await execFileAsync(npxBin, ['prettier', '--write', 'src'], { cwd, timeout: 30000 }).catch(
          () => {}
        );
        console.log(`[DevMind] Prettier done: ${prettierFixCount} files reformatted`);
      } catch (e: any) {
        console.error(`[DevMind] Prettier error: ${e.message}`);
      }

      nitpickPanel.showRunning('Checking git status…');
      let changedFiles: string[] = [];
      try {
        const r = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
        changedFiles = r.stdout.trim().split('\n').filter(Boolean);
        console.log(`[DevMind] Changed files: ${changedFiles.length}`);
      } catch (e: any) {
        console.error(`[DevMind] git status error: ${e.message}`);
      }

      if (changedFiles.length === 0) {
        nitpickPanel.showClean('No linting issues found — your code is clean! ✅');
        vscode.window.showInformationMessage('DevMind: No linting issues found.');
        return;
      }

      let diffRaw = '';
      try {
        const tracked = await execFileAsync('git', ['diff'], { cwd, timeout: 15000 })
          .then((r) => r.stdout)
          .catch((e: any) => e.stdout ?? '');
        const untracked = await execFileAsync(
          'git',
          ['ls-files', '--others', '--exclude-standard'],
          { cwd, timeout: 10000 }
        )
          .then((r) => r.stdout)
          .catch(() => '');
        diffRaw = [tracked, untracked].filter(Boolean).join('\n');
      } catch (e: any) {
        console.error(`[DevMind] git diff error: ${e.message}`);
      }

      const fileDiffs = changedFiles.map((line: string) => {
        const filePath = line.slice(3).trim();
        const fileSection =
          diffRaw.split('diff --git').find((s: string) => s.includes(filePath)) ?? '';
        const additions = (fileSection.match(/^\+[^+]/gm) ?? []).length;
        const deletions = (fileSection.match(/^-[^-]/gm) ?? []).length;
        return { filePath, diff: fileSection, additions, deletions };
      });

      const totalAdditions = fileDiffs.reduce((s, f) => s + f.additions, 0);
      const totalDeletions = fileDiffs.reduce((s, f) => s + f.deletions, 0);
      const totalFixes = eslintFixCount + prettierFixCount || changedFiles.length;
      const summary = `${totalFixes} fix${totalFixes === 1 ? '' : 'es'} applied across ${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'}`;
      const diff = {
        files: fileDiffs,
        totalFiles: fileDiffs.length,
        totalAdditions,
        totalDeletions,
        raw: diffRaw,
      };

      let acceptedCommitMessage = 'style: auto-fix linting issues';
      const accepted = await new Promise<boolean>((resolve) => {
        nitpickPanel.showConfirming(diff, summary, 0);
        nitpickPanel.onAccept((_files, commitMessage) => {
          if (commitMessage) acceptedCommitMessage = commitMessage;
          resolve(true);
        });
        nitpickPanel.onReject(() => resolve(false));
      });

      if (!accepted) {
        try {
          await execFileAsync('git', ['checkout', '--', '.'], { cwd, timeout: 15000 });
          // Also remove untracked files that linters created
          const untrackedToDelete = changedFiles
            .filter((l: string) => l.startsWith('??'))
            .map((l: string) => l.slice(3).trim());
          for (const f of untrackedToDelete) {
            const { unlink } = await import('fs/promises');
            await unlink(path.join(cwd, f)).catch(() => {});
          }
        } catch (e: any) {
          console.error(`[DevMind] Revert failed: ${e.message}`);
        }
        nitpickPanel.showSuccess({
          status: 'rejected',
          summary: 'No changes applied — all reverted.',
          appliedFixes: [],
          commitSha: null,
          commitMessage: null,
        } as any);
        vscode.window.showInformationMessage('DevMind: Rejected — changes reverted.');
        return;
      }

      nitpickPanel.showCommitting(acceptedCommitMessage);
      try {
        await execFileAsync('git', ['add', '-A'], { cwd, timeout: 15000 });
        await execFileAsync('git', ['commit', '-m', acceptedCommitMessage], {
          cwd,
          timeout: 15000,
        });
        const shaResult = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], {
          cwd,
          timeout: 10000,
        });
        const commitSha = shaResult.stdout.trim();
        console.log(`[DevMind] Committed: ${commitSha}`);
        nitpickPanel.showSuccess({
          status: 'committed',
          summary,
          appliedFixes: fileDiffs.map((f) => ({
            linter: 'prettier',
            filePath: f.filePath,
            ruleId: null,
            description: 'Applied formatting',
          })),
          commitSha,
          commitMessage: acceptedCommitMessage,
        } as any);
        vscode.window.showInformationMessage(
          `DevMind: ${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'} committed — ${commitSha}`
        );
      } catch (e: any) {
        nitpickPanel.showError(`Commit failed: ${e.message}`);
        vscode.window.showErrorMessage(`DevMind: Commit failed — ${e.message}`);
      }
    } catch (err: any) {
      nitpickPanel.showError(err.message ?? String(err));
      vscode.window.showErrorMessage(`DevMind: Nitpick fixer failed — ${err.message}`);
    }
  });

  adapter.registerCommand('devmind.openChat', async () => {
    let lastActiveEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

    const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) lastActiveEditor = editor;
    });

    const chatWebviewPanel = vscode.window.createWebviewPanel(
      'devmind.chat',
      'DevMind Chat',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    chatWebviewPanel.webview.html = buildChatHtml(routingAgent.buildHelpMessage());

    chatWebviewPanel.onDidDispose(() => editorChangeDisposable.dispose());

    chatWebviewPanel.webview.onDidReceiveMessage(async (msg: { command: string; text: string }) => {
      if (msg.command !== 'send' || !msg.text?.trim()) return;

      const userInput = msg.text.trim();
      chatWebviewPanel.webview.postMessage({ command: 'thinking', text: userInput });

      try {
        const activeEditor = lastActiveEditor;
        const fileContext = activeEditor?.document.uri.fsPath;
        const response = await routingAgent.route({ input: userInput, fileContext });
        const { route, isFallback } = response.classification;

        chatWebviewPanel.webview.postMessage({
          command: 'response',
          text: response.displayMessage,
          route: isFallback ? undefined : route,
          isFallback,
        });

        if (!isFallback) {
          switch (route) {
            case 'version-guard':
              if (!activeEditor) {
                chatWebviewPanel.webview.postMessage({
                  command: 'info',
                  text: '⚠️ No file is open to analyze. Open a TypeScript/JavaScript file first, then ask again.',
                });
                break;
              }
              await vscode.window.showTextDocument(activeEditor.document, {
                viewColumn: activeEditor.viewColumn,
                preserveFocus: false,
              });
              await vscode.commands.executeCommand(COMMANDS.ANALYZE_FILE);
              break;
            case 'pr-summary':
              await vscode.commands.executeCommand('devmind.generatePRSummary');
              break;
            case 'conflict-explainer':
              if (!activeEditor) {
                chatWebviewPanel.webview.postMessage({
                  command: 'info',
                  text: '⚠️ No file is open. Open a file with merge conflicts first, then ask again.',
                });
                break;
              }
              await vscode.commands.executeCommand(
                CONFLICT_COMMANDS.EXPLAIN_FILE,
                activeEditor.document.uri.toString()
              );
              break;
            case 'nitpick-fixer':
              await vscode.commands.executeCommand(NITPICK_COMMANDS.FIX_NITPICKS);
              break;
          }
        }
      } catch (err: any) {
        chatWebviewPanel.webview.postMessage({
          command: 'error',
          text: `Routing failed: ${err.message ?? String(err)}`,
        });
      }
    });
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
