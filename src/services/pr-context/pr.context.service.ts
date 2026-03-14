// ─────────────────────────────────────────────────────────────
// PR Context Extractor Service
// TICKET-12 | DevMind – Sprint 4
// ─────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto';
import {
  PRContextConfig,
  ExtractedPRContext,
  ExtractionResult,
  ChangedFile,
  FileChangeType,
  ParsedFileDiff,
  DiffHunk,
  DiffLine,
  CommitMessage,
  IssueReference,
  IssueRefSource,
  DetectedPattern,
  CodePatternType,
  TokenBudgetSummary,
  PRContextError,
  PRContextCacheError,
} from './pr.context.types';
import { GitHubPR, GitHubPRDiff, GitHubPRDiffFile } from '../mcp/github.types';

// ── Adapter Interfaces ────────────────────────────────────────
// Injected so the service is fully testable without real GitHub
// or Cosmos DB connections.

export interface GitHubAdapter {
  getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPR>;
  getPRDiff(owner: string, repo: string, prNumber: number): Promise<GitHubPRDiff>;
  listPRComments(owner: string, repo: string, prNumber: number): Promise<Array<{ body: string }>>;
}

export interface CosmosAdapter {
  upsert<T extends { id: string }>(
    containerName: string,
    item: T
  ): Promise<{ success: boolean; error?: string }>;
  read<T>(
    containerName: string,
    id: string,
    partitionKey: string
  ): Promise<{ success: boolean; data?: T; error?: string }>;
}

// ── Constants ─────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<PRContextConfig> = {
  maxTokenBudget: 8000,
  maxDiffLinesPerFile: 200,
  maxFiles: 20,
  maxCommits: 10,
  enableCaching: true,
  cacheTtlMs: 30 * 60 * 1000, // 30 minutes
  enableLogging: true,
};

const CONTAINER_NAME = 'pr-context-cache';

// Language map by extension
const LANGUAGE_MAP: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  py: 'Python',
  rb: 'Ruby',
  java: 'Java',
  go: 'Go',
  rs: 'Rust',
  cs: 'C#',
  cpp: 'C++',
  c: 'C',
  php: 'PHP',
  swift: 'Swift',
  kt: 'Kotlin',
  scala: 'Scala',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  md: 'Markdown',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Shell',
};

const TEST_PATTERNS = [/\.test\.[tj]sx?$/, /\.spec\.[tj]sx?$/, /__tests__\//, /\/test\//];

const CONFIG_PATTERNS = [
  /\.(config|rc)\.[tj]sx?$/,
  /\.(json|yaml|yml|toml|env)$/,
  /^Makefile$/,
  /^Dockerfile/,
  /^docker-compose/,
];

// Issue-linking keywords from GitHub docs
const ISSUE_KEYWORDS = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

// ── Code Pattern Detectors ────────────────────────────────────

const CODE_PATTERN_DETECTORS: Array<{
  type: CodePatternType;
  regex: RegExp;
}> = [
  { type: 'async_await', regex: /\basync\s+\w|\bawait\s+/ },
  { type: 'error_handling', regex: /try\s*\{|catch\s*[({]|\.catch\(|Promise\.reject|throw\s+new/ },
  {
    type: 'database_query',
    regex: /\.(findMany|findUnique|find|select|insert|update|delete|upsert)\(/,
  },
  { type: 'api_call', regex: /fetch\(|axios\.|\.get\(|\.post\(|\.put\(|\.patch\(|\.delete\(/ },
  {
    type: 'state_management',
    regex: /useState\(|useReducer\(|createSlice\(|createStore\(|signal\(/,
  },
  { type: 'test_pattern', regex: /describe\(|it\(|test\(|expect\(|beforeEach\(|afterEach\(/ },
  { type: 'authentication', regex: /jwt\.|bearer|authorization|authenticate|passport|session/ },
  { type: 'caching', regex: /\.cache\(|redis\.|memcache|localStorage|sessionStorage/ },
  { type: 'logging', regex: /console\.(log|warn|error)|logger\.|winston\.|pino\./ },
  { type: 'validation', regex: /z\.(string|number|object)|Joi\.|yup\.|validate\(/ },
];

// ── Service ───────────────────────────────────────────────────

export class PRContextExtractorService {
  private readonly config: Required<PRContextConfig>;

  constructor(
    config: PRContextConfig = {},
    private readonly github: GitHubAdapter,
    private readonly cosmos: CosmosAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Public API ──────────────────────────────────────────────

  /**
   * Main entry point — extracts structured context from a PR.
   * Returns cached result if available and not expired.
   * AC-1..7: orchestrates all extraction steps.
   */
  async extractContext(owner: string, repo: string, prNumber: number): Promise<ExtractionResult> {
    const startMs = Date.now();
    const cacheKey = this.buildCacheKey(owner, repo, prNumber);

    // Check cache first (AC-7)
    if (this.config.enableCaching) {
      const cached = await this.readFromCache(cacheKey, `${owner}/${repo}`);
      if (cached) {
        this.log(`Cache hit for PR #${prNumber} in ${owner}/${repo}`);
        return { context: cached, fromCache: true, durationMs: 0 };
      }
    }

    // Fetch raw data from GitHub
    const [pr, diff] = await Promise.all([
      this.github.getPR(owner, repo, prNumber),
      this.github.getPRDiff(owner, repo, prNumber),
    ]);

    // AC-1: Extract changed files
    const changedFiles = this.extractChangedFiles(diff);

    // AC-2: Parse diff into structured hunks
    const parsedDiffs = this.parseDiffs(diff, changedFiles);

    // AC-3: Extract commit messages (derived from PR data)
    const commits = this.extractCommitMessages(pr);

    // AC-4: Detect linked issue references
    const issueReferences = this.extractIssueReferences(pr);

    // AC-5: Detect code patterns from diffs
    const detectedPatterns = this.detectCodePatterns(parsedDiffs);

    // AC-6: Apply token budget limits
    const { trimmedDiffs, budget } = this.applyTokenBudget(
      parsedDiffs,
      changedFiles,
      commits,
      issueReferences,
      detectedPatterns,
      pr
    );

    const now = new Date();
    const context: ExtractedPRContext = {
      id: cacheKey,
      owner,
      repo,
      prNumber,
      prTitle: pr.title,
      prBody: pr.body ? pr.body.slice(0, 2000) : null,
      prAuthor: pr.author,
      prState: pr.state,
      headBranch: pr.headBranch,
      baseBranch: pr.baseBranch,
      prUrl: pr.url,
      changedFiles: changedFiles.slice(0, this.config.maxFiles),
      parsedDiffs: trimmedDiffs,
      commits,
      issueReferences,
      detectedPatterns,
      tokenBudget: budget,
      extractedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.cacheTtlMs).toISOString(),
    };

    // Store in Cosmos DB cache (AC-7)
    if (this.config.enableCaching) {
      await this.writeToCache(context, owner, repo, prNumber);
    }

    this.log(
      `Extracted context for PR #${prNumber}: ${changedFiles.length} files, ${detectedPatterns.length} patterns, ${budget.totalTokens} tokens`
    );

    return { context, fromCache: false, durationMs: Date.now() - startMs };
  }

  /**
   * Invalidates the cache for a specific PR.
   */
  async invalidateCache(owner: string, repo: string, prNumber: number): Promise<void> {
    const cacheKey = this.buildCacheKey(owner, repo, prNumber);
    // Upsert a tombstone with immediate expiry to invalidate
    await this.cosmos.upsert(CONTAINER_NAME, {
      id: cacheKey,
      owner,
      repo,
      prNumber,
      expiresAt: new Date(0).toISOString(),
    } as any);
  }

  // ── AC-1: Changed Files ─────────────────────────────────────

  /**
   * Extracts the list of changed files with metadata.
   */
  extractChangedFiles(diff: GitHubPRDiff): ChangedFile[] {
    return diff.files.map((f) => ({
      path: f.filename,
      changeType: f.status as FileChangeType,
      additions: f.additions,
      deletions: f.deletions,
      language: this.detectLanguage(f.filename),
      isTest: TEST_PATTERNS.some((p) => p.test(f.filename)),
      isConfig: CONFIG_PATTERNS.some((p) => p.test(f.filename)),
    }));
  }

  // ── AC-2: Diff Parsing ──────────────────────────────────────

  /**
   * Parses raw unified diffs into structured hunks.
   */
  parseDiffs(diff: GitHubPRDiff, changedFiles: ChangedFile[]): ParsedFileDiff[] {
    const results: ParsedFileDiff[] = [];

    for (const file of diff.files) {
      if (!file.patch) {
        results.push({
          path: file.filename,
          changeType: file.status as FileChangeType,
          hunks: [],
          additions: file.additions,
          deletions: file.deletions,
          truncated: false,
        });
        continue;
      }

      const hunks = this.parseUnifiedDiff(file.patch);
      const lines = hunks.reduce((sum, h) => sum + h.lines.length, 0);
      const truncated = lines > this.config.maxDiffLinesPerFile;

      if (truncated) {
        // Keep hunks up to the line limit
        let remaining = this.config.maxDiffLinesPerFile;
        const trimmedHunks: DiffHunk[] = [];
        for (const hunk of hunks) {
          if (remaining <= 0) break;
          const keep = hunk.lines.slice(0, remaining);
          trimmedHunks.push({ ...hunk, lines: keep });
          remaining -= keep.length;
        }
        results.push({
          path: file.filename,
          changeType: file.status as FileChangeType,
          hunks: trimmedHunks,
          additions: file.additions,
          deletions: file.deletions,
          truncated: true,
        });
      } else {
        results.push({
          path: file.filename,
          changeType: file.status as FileChangeType,
          hunks,
          additions: file.additions,
          deletions: file.deletions,
          truncated: false,
        });
      }
    }

    return results;
  }

  /**
   * Parses a unified diff string into structured DiffHunk objects.
   */
  parseUnifiedDiff(patch: string): DiffHunk[] {
    const hunks: DiffHunk[] = [];
    const lines = patch.split('\n');
    let currentHunk: DiffHunk | null = null;
    let lineNumber = 0;

    for (const raw of lines) {
      // Hunk header: @@ -start,count +start,count @@
      const hunkMatch = raw.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (hunkMatch) {
        if (currentHunk) hunks.push(currentHunk);
        lineNumber = parseInt(hunkMatch[2], 10);
        currentHunk = {
          header: raw,
          startLine: lineNumber,
          lineCount: 0,
          lines: [],
        };
        continue;
      }

      if (!currentHunk) continue;

      if (raw.startsWith('+') && !raw.startsWith('+++')) {
        currentHunk.lines.push({ type: 'added', content: raw.slice(1), lineNumber });
        lineNumber++;
        currentHunk.lineCount++;
      } else if (raw.startsWith('-') && !raw.startsWith('---')) {
        currentHunk.lines.push({ type: 'removed', content: raw.slice(1), lineNumber: null });
        currentHunk.lineCount++;
      } else if (raw.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: raw.slice(1), lineNumber });
        lineNumber++;
        currentHunk.lineCount++;
      }
    }

    if (currentHunk) hunks.push(currentHunk);
    return hunks;
  }

  // ── AC-3: Commit Messages ───────────────────────────────────

  /**
   * Extracts structured commit messages from PR metadata.
   * Uses PR title and body as a proxy when commit list is unavailable.
   */
  extractCommitMessages(pr: GitHubPR): CommitMessage[] {
    // Build a synthetic commit from the PR itself
    const subject = pr.title;
    const body = pr.body ?? null;

    const syntheticCommit: CommitMessage = {
      sha: 'pr-head',
      message: body ? `${subject}\n\n${body}` : subject,
      subject,
      body,
      author: pr.author,
      timestamp: pr.updatedAt,
    };

    return [syntheticCommit].slice(0, this.config.maxCommits);
  }

  // ── AC-4: Issue References ──────────────────────────────────

  /**
   * Extracts all linked issue/ticket references from PR body,
   * commit messages, and branch name.
   */
  extractIssueReferences(pr: GitHubPR): IssueReference[] {
    const refs: IssueReference[] = [];
    const seen = new Set<string>();

    const addRef = (number: number, source: IssueRefSource, rawMatch: string) => {
      const key = `${source}-${number}`;
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ number, source, rawMatch, title: null });
      }
    };

    // From PR linked issues list (GitHub auto-detected)
    for (const num of pr.linkedIssues) {
      addRef(num, 'pr_body', `#${num}`);
    }

    // From PR body text
    if (pr.body) {
      const bodyMatches = [...pr.body.matchAll(ISSUE_KEYWORDS)];
      for (const m of bodyMatches) {
        addRef(parseInt(m[1], 10), 'pr_body', m[0]);
      }
    }

    // From branch name (e.g. feature/CS-012-add-parser, fix/issue-42)
    const branchMatches = pr.headBranch.matchAll(/#?(\d{2,})/g);
    for (const m of branchMatches) {
      const num = parseInt(m[1], 10);
      if (num > 0) {
        addRef(num, 'branch_name', m[0]);
      }
    }

    return refs;
  }

  // ── AC-5: Code Patterns ─────────────────────────────────────

  /**
   * Detects code patterns from the added lines in all parsed diffs.
   */
  detectCodePatterns(diffs: ParsedFileDiff[]): DetectedPattern[] {
    // Collect all added lines per file
    const addedLinesByFile: Map<string, string[]> = new Map();
    for (const diff of diffs) {
      const added = diff.hunks
        .flatMap((h) => h.lines)
        .filter((l) => l.type === 'added')
        .map((l) => l.content);
      if (added.length > 0) {
        addedLinesByFile.set(diff.path, added);
      }
    }

    const patternMap: Map<
      CodePatternType,
      { files: Set<string>; count: number; example: string | null }
    > = new Map();

    for (const [file, lines] of addedLinesByFile) {
      const fullText = lines.join('\n');
      for (const detector of CODE_PATTERN_DETECTORS) {
        if (detector.regex.test(fullText)) {
          const existing = patternMap.get(detector.type) ?? {
            files: new Set(),
            count: 0,
            example: null,
          };
          existing.files.add(file);
          existing.count++;
          if (!existing.example) {
            const match = fullText.match(detector.regex);
            if (match) {
              const idx = fullText.indexOf(match[0]);
              existing.example = fullText.slice(Math.max(0, idx - 20), idx + 180).trim();
            }
          }
          patternMap.set(detector.type, existing);
        }
      }
    }

    return Array.from(patternMap.entries()).map(([type, data]) => ({
      type,
      files: Array.from(data.files),
      occurrences: data.count,
      example: data.example ? data.example.slice(0, 200) : null,
    }));
  }

  // ── AC-6: Token Budget ──────────────────────────────────────

  /**
   * Applies token budget limits by trimming diffs if needed.
   * Preserves PR metadata and patterns; trims diffs last.
   */
  applyTokenBudget(
    diffs: ParsedFileDiff[],
    files: ChangedFile[],
    commits: CommitMessage[],
    refs: IssueReference[],
    patterns: DetectedPattern[],
    pr: GitHubPR
  ): { trimmedDiffs: ParsedFileDiff[]; budget: TokenBudgetSummary } {
    const prMetaTokens = this.estimateTokens(
      `${pr.title} ${pr.body ?? ''} ${pr.author} ${pr.headBranch} ${pr.baseBranch}`
    );
    const filesTokens = this.estimateTokens(JSON.stringify(files));
    const commitsTokens = this.estimateTokens(JSON.stringify(commits));
    const refsTokens = this.estimateTokens(JSON.stringify(refs));
    const patternsTokens = this.estimateTokens(JSON.stringify(patterns));

    const fixedTokens = prMetaTokens + filesTokens + commitsTokens + refsTokens + patternsTokens;
    const diffBudget = Math.max(0, this.config.maxTokenBudget - fixedTokens);

    let usedDiffTokens = 0;
    let wasTruncated = false;
    const trimmedDiffs: ParsedFileDiff[] = [];

    for (const diff of diffs.slice(0, this.config.maxFiles)) {
      const diffText = JSON.stringify(diff);
      const diffTokens = this.estimateTokens(diffText);

      if (usedDiffTokens + diffTokens <= diffBudget) {
        trimmedDiffs.push(diff);
        usedDiffTokens += diffTokens;
      } else {
        // Try to include a truncated version
        const remaining = diffBudget - usedDiffTokens;
        if (remaining > 50 && diff.hunks.length > 0) {
          const truncatedDiff: ParsedFileDiff = {
            ...diff,
            hunks: [diff.hunks[0]],
            truncated: true,
          };
          trimmedDiffs.push(truncatedDiff);
          usedDiffTokens += this.estimateTokens(JSON.stringify(truncatedDiff));
        }
        wasTruncated = true;
        break;
      }
    }

    const totalTokens = fixedTokens + usedDiffTokens;

    return {
      trimmedDiffs,
      budget: {
        totalTokens,
        budgetLimit: this.config.maxTokenBudget,
        wasTruncated,
        breakdown: {
          prMetadata: prMetaTokens,
          changedFiles: filesTokens,
          diffs: usedDiffTokens,
          commits: commitsTokens,
          issueRefs: refsTokens,
          patterns: patternsTokens,
        },
      },
    };
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Detects the programming language from a file path.
   */
  detectLanguage(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    return LANGUAGE_MAP[ext] ?? null;
  }

  /**
   * Estimates token count (~4 characters per token).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Builds a deterministic cache key for a PR.
   */
  buildCacheKey(owner: string, repo: string, prNumber: number): string {
    return `pr-context-${owner}-${repo}-${prNumber}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  // ── Cosmos DB Cache ─────────────────────────────────────────

  private async readFromCache(
    cacheKey: string,
    repoPath: string
  ): Promise<ExtractedPRContext | null> {
    try {
      const result = await this.cosmos.read<ExtractedPRContext>(CONTAINER_NAME, cacheKey, repoPath);
      if (!result.success || !result.data) return null;

      // Check expiry
      const expiresAt = new Date(result.data.expiresAt);
      if (expiresAt < new Date()) {
        this.log(`Cache expired for ${cacheKey}`);
        return null;
      }

      return result.data;
    } catch {
      return null;
    }
  }

  private async writeToCache(
    context: ExtractedPRContext,
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<void> {
    try {
      const result = await this.cosmos.upsert(CONTAINER_NAME, context);
      if (!result.success) {
        this.log(`Cache write failed for PR #${prNumber}: ${result.error}`);
      }
    } catch (e) {
      // Non-fatal — caching failure should never break extraction
      this.log(`Cache write error for PR #${prNumber}: ${String(e)}`);
    }
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[PRContextExtractor] ${message}`);
    }
  }
}
