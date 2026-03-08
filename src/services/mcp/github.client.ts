import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import {
  GitHubMCPConfig,
  GitHubPR,
  GitHubPRDiff,
  GitHubPRDiffFile,
  GitHubIssue,
  GitHubComment,
  CreateCommentInput,
  UpdateCommentInput,
  CodeSearchResult,
  SearchCodeOptions,
  GitHubRateLimit,
  GitHubMCPError,
  GitHubRateLimitError,
  GitHubAuthError,
  GitHubNotFoundError,
} from './github.types';

const DEFAULT_CONFIG: Required<
  Pick<GitHubMCPConfig, 'authType' | 'rateLimitThreshold' | 'maxRetries' | 'retryBaseDelayMs'>
> = {
  authType: 'pat',
  rateLimitThreshold: 4500,
  maxRetries: 3,
  retryBaseDelayMs: 1000,
};

export class GitHubMCPClient {
  private readonly octokit: Octokit;
  private readonly config: Required<GitHubMCPConfig>;
  private rateLimitState: GitHubRateLimit | null = null;

  constructor(config: GitHubMCPConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.octokit = new Octokit({ auth: this.config.token });
  }

  // ── Rate Limit ──────────────────────────────────────────────

  /**
   * Fetches the current GitHub API rate limit status and caches it.
   */
  async getRateLimit(): Promise<GitHubRateLimit> {
    const { data } = await this.octokit.rateLimit.get();
    const core = data.resources.core;

    this.rateLimitState = {
      limit: core.limit,
      remaining: core.remaining,
      resetAt: new Date(core.reset * 1000),
      isNearLimit: core.remaining < this.config.rateLimitThreshold,
    };

    return this.rateLimitState;
  }

  // ── Pull Requests ───────────────────────────────────────────

  /**
   * Fetches a single PR by number.
   */
  async getPR(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });

      const linkedIssues = this.extractLinkedIssues(data.body ?? '');

      return {
        number: data.number,
        title: data.title,
        body: data.body,
        state: data.merged_at ? 'merged' : (data.state as 'open' | 'closed'),
        author: data.user?.login ?? 'unknown',
        headBranch: data.head.ref,
        baseBranch: data.base.ref,
        url: data.html_url,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        draft: data.draft ?? false,
        labels: data.labels.map((l) => l.name ?? ''),
        linkedIssues,
      };
    }, `PR #${prNumber}`);
  }

  /**
   * Lists open PRs for a repository. Returns up to 100.
   */
  async listPRs(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open'
  ): Promise<GitHubPR[]> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.pulls.list({
        owner,
        repo,
        state,
        per_page: 100,
      });

      return data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state as 'open' | 'closed',
        author: pr.user?.login ?? 'unknown',
        headBranch: pr.head.ref,
        baseBranch: pr.base.ref,
        url: pr.html_url,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        draft: pr.draft ?? false,
        labels: pr.labels.map((l) => l.name ?? ''),
        linkedIssues: this.extractLinkedIssues(pr.body ?? ''),
      }));
    }, 'list PRs');
  }

  /**
   * Returns the file-level diff for a PR.
   */
  async getPRDiff(owner: string, repo: string, prNumber: number): Promise<GitHubPRDiff> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      const files: GitHubPRDiffFile[] = data.map((f) => ({
        filename: f.filename,
        status: f.status as GitHubPRDiffFile['status'],
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? null,
      }));

      const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
      const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);
      const totalChanges = totalAdditions + totalDeletions;

      return { prNumber, totalAdditions, totalDeletions, totalChanges, files };
    }, `PR #${prNumber} diff`);
  }

  // ── Issues ──────────────────────────────────────────────────

  /**
   * Fetches a single issue by number.
   */
  async getIssue(owner: string, repo: string, issueNumber: number): Promise<GitHubIssue> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });

      return {
        number: data.number,
        title: data.title,
        body: data.body ?? null,
        state: data.state as 'open' | 'closed',
        author: data.user?.login ?? 'unknown',
        labels: data.labels.map((l) => (typeof l === 'string' ? l : (l.name ?? ''))) as string[],
        url: data.html_url,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    }, `issue #${issueNumber}`);
  }

  // ── Comments ────────────────────────────────────────────────

  /**
   * Lists review comments on a PR.
   */
  async listPRComments(owner: string, repo: string, prNumber: number): Promise<GitHubComment[]> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      });

      return data.map((c) => ({
        id: c.id,
        body: c.body ?? '',
        author: c.user?.login ?? 'unknown',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        url: c.html_url,
      }));
    }, `PR #${prNumber} comments`);
  }

  /**
   * Creates a comment on a PR (or issue).
   */
  async createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    input: CreateCommentInput
  ): Promise<GitHubComment> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: input.body,
      });

      return {
        id: data.id,
        body: data.body ?? '',
        author: data.user?.login ?? 'unknown',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        url: data.html_url,
      };
    }, `create comment on PR #${prNumber}`);
  }

  /**
   * Updates an existing comment by ID.
   */
  async updatePRComment(
    owner: string,
    repo: string,
    commentId: number,
    input: UpdateCommentInput
  ): Promise<GitHubComment> {
    return this.withRetry(async () => {
      const { data } = await this.octokit.issues.updateComment({
        owner,
        repo,
        comment_id: commentId,
        body: input.body,
      });

      return {
        id: data.id,
        body: data.body ?? '',
        author: data.user?.login ?? 'unknown',
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        url: data.html_url,
      };
    }, `update comment #${commentId}`);
  }

  // ── Code Search ─────────────────────────────────────────────

  /**
   * Searches code within a repository.
   * @param query  GitHub code search query string
   */
  async searchCode(
    owner: string,
    repo: string,
    query: string,
    options: SearchCodeOptions = {}
  ): Promise<CodeSearchResult[]> {
    return this.withRetry(async () => {
      const q = `${query} repo:${owner}/${repo}`;
      const { data } = await this.octokit.search.code({
        q,
        per_page: options.perPage ?? 30,
      });

      return data.items.map((item) => ({
        path: item.path,
        repository: item.repository.full_name,
        url: item.html_url,
        fragment: item.text_matches?.[0]?.fragment,
      }));
    }, `code search: ${query}`);
  }

  // ── Internals ───────────────────────────────────────────────

  /**
   * Wraps an API call with exponential back-off retry logic and
   * unified error translation.
   */
  private async withRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        // Proactive rate-limit guard
        if (this.rateLimitState?.isNearLimit) {
          const waitMs = this.rateLimitState.resetAt.getTime() - Date.now() + 500;
          if (waitMs > 0) {
            await this.sleep(waitMs);
          }
        }

        return await fn();
      } catch (err) {
        const translated = this.translateError(err, context);

        // Don't retry auth or not-found errors
        if (translated instanceof GitHubAuthError || translated instanceof GitHubNotFoundError) {
          throw translated;
        }

        attempt++;
        if (attempt >= this.config.maxRetries) {
          throw translated;
        }

        // Rate-limit: wait until reset
        if (translated instanceof GitHubRateLimitError) {
          const waitMs = translated.resetAt.getTime() - Date.now() + 500;
          await this.sleep(Math.max(waitMs, 0));
        } else {
          // Exponential back-off for transient errors
          await this.sleep(this.config.retryBaseDelayMs * Math.pow(2, attempt - 1));
        }
      }
    }
  }

  /**
   * Translates Octokit errors into domain-specific error types.
   */
  private translateError(err: unknown, context: string): GitHubMCPError {
    if (err instanceof RequestError) {
      if (err.status === 401 || err.status === 403) {
        return new GitHubAuthError();
      }
      if (err.status === 404) {
        return new GitHubNotFoundError(context);
      }
      if (err.status === 429) {
        const resetHeader = err.response?.headers?.['x-ratelimit-reset'];
        const resetAt = resetHeader
          ? new Date(Number(resetHeader) * 1000)
          : new Date(Date.now() + 60_000);
        return new GitHubRateLimitError(resetAt);
      }
      return new GitHubMCPError(err.message, err.status, { context });
    }

    if (err instanceof GitHubMCPError) {
      return err;
    }

    return new GitHubMCPError(err instanceof Error ? err.message : String(err), undefined, {
      context,
    });
  }

  /**
   * Extracts linked issue numbers from a PR body using common closing keyword patterns.
   * e.g. "Closes #42", "Fixes #7"
   */
  private extractLinkedIssues(body: string): number[] {
    const pattern = /(?:closes|fixes|resolves)\s+#(\d+)/gi;
    const numbers: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(body)) !== null) {
      numbers.push(parseInt(match[1], 10));
    }

    return [...new Set(numbers)];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
