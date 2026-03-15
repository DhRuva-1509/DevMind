import * as crypto from 'crypto';
import {
  GitHubWebhookPayload,
  WebhookAction,
  PRSummaryJob,
  WebhookResponse,
  WebhookFunctionConfig,
  DEFAULT_WEBHOOK_CONFIG,
  WebhookSignatureError,
  WebhookPayloadError,
} from './webhook.types';

/**
 * Wraps PRSummaryAgent.generateSummary()
 * Follows injected adapter pattern (Sprint 3 TD-4.1) — no direct service
 * instantiation inside the handler, all dependencies injected at wire-up time.
 */
export interface GeneratedSummaryResult {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prState: string;
  summary: string;
  wasChunked: boolean;
  chunkSummaries: any[];
  status: string;
  templateVersion: string;
  abVariant: string | null;
  foundryAgentId: string | null;
  foundryThreadId: string | null;
  errorMessage: string | null;
  trigger: string;
  generatedAt: string;
  expiresAt: string;
  prUpdatedAt: string;
}

export interface SummaryGeneratorAdapter {
  generateSummary(
    owner: string,
    repo: string,
    prNumber: number,
    trigger: 'webhook'
  ): Promise<{ summary: GeneratedSummaryResult }>;
}

/** Wraps PRCommentPoster — no confirm dialog in webhook context */
export interface CommentPosterAdapter {
  postComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<{ commentId: number; commentUrl: string; action: string }>;
  formatBody(
    summaryText: string,
    prNumber: number,
    prTitle: string,
    status: string,
    wasChunked: boolean,
    chunkCount: number
  ): string;
}

/** Wraps in-memory or Azure Storage Queue */
export interface JobQueueAdapter {
  enqueue(job: PRSummaryJob): Promise<void>;
  dequeue(): Promise<PRSummaryJob | null>;
  size(): Promise<number>;
}

/** HTTP request/response abstraction (matches Azure Functions HttpRequest shape) */
export interface HttpRequest {
  method: string;
  headers: Record<string, string | undefined>;
  body: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export class InMemoryJobQueue implements JobQueueAdapter {
  private queue: PRSummaryJob[] = [];

  async enqueue(job: PRSummaryJob): Promise<void> {
    this.queue.push(job);
  }

  async dequeue(): Promise<PRSummaryJob | null> {
    return this.queue.shift() ?? null;
  }

  async size(): Promise<number> {
    return this.queue.length;
  }

  // Test helper
  peek(): PRSummaryJob[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
  }
}

export class PRWebhookHandler {
  private readonly config: WebhookFunctionConfig;

  constructor(
    config: Partial<WebhookFunctionConfig> = {},
    private readonly summaryGenerator: SummaryGeneratorAdapter,
    private readonly commentPoster: CommentPosterAdapter,
    private readonly jobQueue: JobQueueAdapter
  ) {
    this.config = { ...DEFAULT_WEBHOOK_CONFIG, ...config };
  }

  async handleRequest(req: HttpRequest): Promise<HttpResponse> {
    // Only accept POST
    if (req.method !== 'POST') {
      return { status: 405, body: { error: 'Method not allowed' } };
    }

    try {
      // AC-3: Validate webhook signature
      this.validateSignature(req.headers['x-hub-signature-256'] ?? '', req.body);

      // Parse and validate payload
      const payload = this.parsePayload(req.body);

      // AC-5: Skip unsupported actions
      if (!this.config.supportedActions.includes(payload.action)) {
        this.log(`Skipping action: ${payload.action}`);
        return {
          status: 200,
          body: {
            status: 'skipped',
            message: `Action '${payload.action}' not processed`,
          } as WebhookResponse,
        };
      }

      // AC-5: Build and enqueue job
      const job = this.buildJob(payload);
      await this.jobQueue.enqueue(job);
      this.log(`Queued job ${job.jobId} for PR #${job.prNumber} in ${job.owner}/${job.repo}`);

      // AC-4/5/6: Process job with retry logic (async in prod, inline for dev)
      const response: WebhookResponse = {
        status: 'accepted',
        jobId: job.jobId,
        message: `PR #${job.prNumber} summary generation queued`,
      };

      // Process inline — in production this would be handled by a queue trigger
      this.processJob(job).catch((err) => {
        this.log(`Background job ${job.jobId} failed: ${String(err)}`);
      });

      return { status: 202, body: response };
    } catch (err) {
      return this.handleError(err);
    }
  }

  // ── AC-4/6: Job Processing with Retries ──────────────────────

  async processJob(job: PRSummaryJob): Promise<void> {
    const { owner, repo, prNumber, prTitle, prUrl } = job;
    let lastError: unknown;

    // AC-7: Retry loop
    for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
      try {
        this.log(`Processing job ${job.jobId} — attempt ${attempt}/${job.maxAttempts}`);

        // AC-4: Generate summary
        const result = await this.summaryGenerator.generateSummary(
          owner,
          repo,
          prNumber,
          'webhook'
        );
        const { summary } = result;

        // AC-6: Format and post comment
        const body = this.commentPoster.formatBody(
          summary.summary,
          prNumber,
          prTitle,
          summary.status,
          summary.wasChunked,
          summary.chunkSummaries.length
        );

        const posted = await this.commentPoster.postComment(owner, repo, prNumber, body);
        this.log(`Job ${job.jobId} complete — comment ${posted.action} at ${posted.commentUrl}`);
        return;
      } catch (err) {
        lastError = err;
        this.log(`Job ${job.jobId} attempt ${attempt} failed: ${String(err)}`);

        if (attempt < job.maxAttempts) {
          await this.sleep(this.config.retryDelayMs);
        }
      }
    }

    // AC-7: All retries exhausted
    throw new Error(
      `Job ${job.jobId} failed after ${job.maxAttempts} attempts. Last error: ${String(lastError)}`
    );
  }

  validateSignature(signatureHeader: string, body: string): void {
    if (!this.config.webhookSecret) {
      // No secret configured — skip validation (dev mode)
      return;
    }

    if (!signatureHeader) {
      throw new WebhookSignatureError();
    }

    const expected = `sha256=${this.computeHmac(body, this.config.webhookSecret)}`;

    // AC-3: Timing-safe comparison
    if (!this.timingSafeEqual(signatureHeader, expected)) {
      throw new WebhookSignatureError();
    }
  }

  parsePayload(body: string): GitHubWebhookPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new WebhookPayloadError('body is not valid JSON');
    }

    const p = parsed as Record<string, unknown>;

    if (!p['action']) throw new WebhookPayloadError('missing action');
    if (!p['pull_request']) throw new WebhookPayloadError('missing pull_request');
    if (!p['repository']) throw new WebhookPayloadError('missing repository');

    return parsed as GitHubWebhookPayload;
  }

  buildJob(payload: GitHubWebhookPayload): PRSummaryJob {
    const { pull_request: pr, repository: repo } = payload;
    return {
      jobId: this.generateJobId(repo.owner.login, repo.name, pr.number),
      owner: repo.owner.login,
      repo: repo.name,
      prNumber: pr.number,
      prTitle: pr.title,
      prUrl: pr.html_url,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: this.config.maxRetryAttempts,
    };
  }

  private handleError(err: unknown): HttpResponse {
    if (err instanceof WebhookSignatureError) {
      this.log(`Signature validation failed`);
      return { status: 401, body: { error: err.message } };
    }
    if (err instanceof WebhookPayloadError) {
      this.log(`Payload error: ${err.message}`);
      return { status: 400, body: { error: err.message } };
    }
    const msg = String(err instanceof Error ? err.message : err);
    this.log(`Unexpected error: ${msg}`);
    return { status: 500, body: { error: 'Internal server error', detail: msg } };
  }

  computeHmac(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    } catch {
      return false;
    }
  }

  generateJobId(owner: string, repo: string, prNumber: number): string {
    return `job-${owner}-${repo}-${prNumber}-${Date.now()}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
  }

  isSupportedAction(action: string): boolean {
    return this.config.supportedActions.includes(action as WebhookAction);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      console.log(`[PRWebhookHandler] ${message}`);
    }
  }
}
