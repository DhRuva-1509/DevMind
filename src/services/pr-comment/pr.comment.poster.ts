import {
  PRCommentPosterConfig,
  PostCommentResult,
  FormattedComment,
  PostAction,
  PRCommentPermissionError,
  PRCommentPostError,
  DEVMIND_FOOTER,
  DEVMIND_COMMENT_MARKER,
} from './pr.comment.types';
import { PRSummary } from '../pr-summary/pr.summary.types';

/** Wraps GitHubMCPClient */
export interface GitHubCommentAdapter {
  listPRComments(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<
    Array<{
      id: number;
      body: string;
      author: string;
      url: string;
    }>
  >;
  createPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<{
    id: number;
    url: string;
  }>;
  updatePRComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string
  ): Promise<{
    id: number;
    url: string;
  }>;
}

/** Wraps VS Code confirmation dialog */
export interface ConfirmAdapter {
  confirm(message: string, detail?: string): Promise<boolean>;
}

const DEFAULT_CONFIG: Required<PRCommentPosterConfig> = {
  footer: DEVMIND_FOOTER,
  commentMarker: DEVMIND_COMMENT_MARKER,
  enableLogging: true,
};

export class PRCommentPoster {
  private readonly config: Required<PRCommentPosterConfig>;

  constructor(
    config: PRCommentPosterConfig = {},
    private readonly github: GitHubCommentAdapter,
    private readonly confirm: ConfirmAdapter
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * AC-1/4/5: Posts (or updates) the PR summary as a GitHub comment.
   * Shows a confirmation dialog before posting.
   * Finds and updates an existing DevMind comment if one exists.
   */
  async postSummary(summary: PRSummary): Promise<PostCommentResult | null> {
    const { owner, repo, prNumber } = summary;

    const confirmed = await this.confirm.confirm(
      `Post PR summary to ${owner}/${repo} #${prNumber}?`,
      'This will add a comment to the pull request on GitHub.'
    );
    if (!confirmed) {
      this.log(`User cancelled posting for PR #${prNumber}`);
      return null;
    }

    const formatted = this.formatComment(summary);

    try {
      const existingId = await this.findExistingComment(owner, repo, prNumber);

      let commentId: number;
      let commentUrl: string;
      let action: PostAction;

      if (existingId !== null) {
        this.log(`Updating existing comment ${existingId} on PR #${prNumber}`);
        const result = await this.github.updatePRComment(owner, repo, existingId, formatted.body);
        commentId = result.id;
        commentUrl = result.url;
        action = 'updated';
      } else {
        this.log(`Creating new comment on PR #${prNumber}`);
        const result = await this.github.createPRComment(owner, repo, prNumber, formatted.body);
        commentId = result.id;
        commentUrl = result.url;
        action = 'created';
      }

      this.log(`Comment ${action} on PR #${prNumber} — id: ${commentId}, url: ${commentUrl}`);

      return {
        commentId,
        action,
        commentUrl,
        postedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      if (this.isPermissionError(err)) {
        throw new PRCommentPermissionError(owner, repo, prNumber);
      }
      throw new PRCommentPostError(prNumber, String(err));
    }
  }

  /**
   * AC-2/3: Formats a PRSummary into collapsible markdown with footer.
   * Uses a <details> block so the full summary is collapsed by default.
   */
  formatComment(summary: PRSummary): FormattedComment {
    const { prNumber, prTitle, summary: summaryText, wasChunked, chunkSummaries } = summary;

    const statusBadge =
      summary.status === 'complete'
        ? '✅ Complete'
        : summary.status === 'partial'
          ? '⚠️ Partial'
          : '❌ Failed';

    const chunkNote = wasChunked
      ? `\n> ⚡ Large PR — summarised in ${chunkSummaries.length} chunks\n`
      : '';

    const body = [
      this.config.commentMarker,
      `<details>`,
      `<summary><strong>🤖 DevMind PR Summary — PR #${prNumber}: ${this.escapeMarkdown(prTitle)}</strong> &nbsp; ${statusBadge}</summary>`,
      ``,
      chunkNote,
      summaryText,
      ``,
      `</details>`,
      // AC-3: Footer
      this.config.footer,
    ].join('\n');

    return { body, charCount: body.length };
  }

  /**
   * AC-4: Finds an existing DevMind-managed comment on the PR.
   * Returns the comment ID if found, null otherwise.
   */
  async findExistingComment(owner: string, repo: string, prNumber: number): Promise<number | null> {
    try {
      const comments = await this.github.listPRComments(owner, repo, prNumber);
      const existing = comments.find((c) => c.body.includes(this.config.commentMarker));
      return existing?.id ?? null;
    } catch {
      // If we can't list comments, proceed with creating a new one
      return null;
    }
  }

  /**
   * Returns a preview of the formatted comment (first 500 chars).
   * Useful for showing in the confirm dialog.
   */
  getCommentPreview(summary: PRSummary): string {
    const formatted = this.formatComment(summary);
    const preview = formatted.body.slice(0, 500);
    return formatted.body.length > 500 ? `${preview}…` : preview;
  }

  // ── Helpers ──────────────────────────────────────────────────

  /**
   * AC-6: Detects permission/auth errors from GitHub API.
   */
  isPermissionError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as Record<string, unknown>;
    const status = e['status'] as number | undefined;
    const message = String(e['message'] ?? '').toLowerCase();
    return (
      status === 403 ||
      status === 401 ||
      message.includes('forbidden') ||
      message.includes('not authorized') ||
      message.includes('resource not accessible')
    );
  }

  buildCommentMarker(): string {
    return this.config.commentMarker;
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/[_*[\]`]/g, (c) => `\\${c}`);
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[PRCommentPoster] ${message}`);
    }
  }
}
