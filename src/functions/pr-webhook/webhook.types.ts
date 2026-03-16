export type WebhookAction = 'opened' | 'reopened' | 'synchronize' | 'closed' | 'edited';

export interface WebhookPullRequest {
  number: number;
  title: string;
  state: string;
  html_url: string;
  head: { ref: string };
  base: { ref: string };
  user: { login: string };
  updated_at: string;
}

export interface WebhookRepository {
  name: string;
  full_name: string;
  owner: { login: string };
}

export interface GitHubWebhookPayload {
  action: WebhookAction;
  pull_request: WebhookPullRequest;
  repository: WebhookRepository;
  sender: { login: string };
}

export interface PRSummaryJob {
  jobId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  queuedAt: string;
  attempts: number;
  maxAttempts: number;
}

export type WebhookResponseStatus = 'accepted' | 'skipped' | 'error';

export interface WebhookResponse {
  status: WebhookResponseStatus;
  jobId?: string;
  message: string;
}

export interface WebhookFunctionConfig {
  webhookSecret: string;
  supportedActions: WebhookAction[];
  maxRetryAttempts: number;
  retryDelayMs: number;
  enableLogging: boolean;
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookFunctionConfig = {
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
  supportedActions: ['opened', 'reopened', 'synchronize'],
  maxRetryAttempts: 3,
  retryDelayMs: 5000,
  enableLogging: true,
};

export class WebhookSignatureError extends Error {
  constructor() {
    super('Invalid webhook signature — request may not be from GitHub.');
    this.name = 'WebhookSignatureError';
  }
}

export class WebhookPayloadError extends Error {
  constructor(reason: string) {
    super(`Invalid webhook payload: ${reason}`);
    this.name = 'WebhookPayloadError';
  }
}
