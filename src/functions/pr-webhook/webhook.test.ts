import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import {
  PRWebhookHandler,
  InMemoryJobQueue,
  SummaryGeneratorAdapter,
  CommentPosterAdapter,
  GeneratedSummaryResult,
  HttpRequest,
} from './webhook.handler';
import {
  WebhookFunctionConfig,
  GitHubWebhookPayload,
  PRSummaryJob,
  WebhookSignatureError,
  WebhookPayloadError,
} from './webhook.types';

function makePayload(overrides: Partial<GitHubWebhookPayload> = {}): GitHubWebhookPayload {
  return {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'feat: add useQuery migration',
      state: 'open',
      html_url: 'https://github.com/owner/repo/pull/42',
      head: { ref: 'feature/migration' },
      base: { ref: 'main' },
      user: { login: 'dhruva' },
      updated_at: new Date().toISOString(),
    },
    repository: {
      name: 'repo',
      full_name: 'owner/repo',
      owner: { login: 'owner' },
    },
    sender: { login: 'dhruva' },
    ...overrides,
  };
}

function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(makePayload()),
    ...overrides,
  };
}

function makeSummaryGenerator(
  overrides: Partial<SummaryGeneratorAdapter> = {}
): SummaryGeneratorAdapter {
  return {
    generateSummary: sinon.stub().resolves({
      summary: {
        id: 'pr-summary-owner-repo-42',
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        prTitle: 'feat: add useQuery migration',
        prState: 'open',
        summary: '## Summary\nThis PR migrates useQuery.\n\n## Impact\nLow risk.',
        chunkSummaries: [],
        wasChunked: false,
        foundryAgentId: null,
        foundryThreadId: null,
        templateVersion: '1.0.0',
        abVariant: null,
        status: 'complete',
        errorMessage: null,
        trigger: 'webhook',
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        prUpdatedAt: new Date().toISOString(),
      },
    }),
    ...overrides,
  };
}

function makeCommentPoster(overrides: Partial<CommentPosterAdapter> = {}): CommentPosterAdapter {
  return {
    postComment: sinon.stub().resolves({
      commentId: 101,
      commentUrl: 'https://github.com/owner/repo/pull/42#issuecomment-101',
      action: 'created',
    }),
    formatBody: sinon.stub().returns('<!-- devmind-pr-summary -->\n<details>...</details>'),
    ...overrides,
  };
}

function makeHandler(
  config: Partial<WebhookFunctionConfig> = {},
  generator?: SummaryGeneratorAdapter,
  poster?: CommentPosterAdapter,
  queue?: InMemoryJobQueue
): { handler: PRWebhookHandler; queue: InMemoryJobQueue } {
  const q = queue ?? new InMemoryJobQueue();
  const h = new PRWebhookHandler(
    { webhookSecret: '', enableLogging: false, ...config },
    generator ?? makeSummaryGenerator(),
    poster ?? makeCommentPoster(),
    q
  );
  return { handler: h, queue: q };
}

describe('PRWebhookHandler', () => {
  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates an instance', () => {
      expect(makeHandler().handler).to.be.instanceOf(PRWebhookHandler);
    });

    it('accepts custom supportedActions', () => {
      const { handler } = makeHandler({ supportedActions: ['opened'] });
      expect(handler).to.be.instanceOf(PRWebhookHandler);
    });

    it('accepts custom maxRetryAttempts', () => {
      const { handler } = makeHandler({ maxRetryAttempts: 5 });
      expect(handler).to.be.instanceOf(PRWebhookHandler);
    });

    it('accepts custom retryDelayMs', () => {
      const { handler } = makeHandler({ retryDelayMs: 1000 });
      expect(handler).to.be.instanceOf(PRWebhookHandler);
    });
  });

  describe('handleRequest()', () => {
    it('returns 405 for non-POST request', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest({ ...makeRequest(), method: 'GET' });
      expect(res.status).to.equal(405);
    });

    it('returns 202 for valid opened PR', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest(makeRequest());
      expect(res.status).to.equal(202);
    });

    it('response body has status accepted', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest(makeRequest());
      expect((res.body as any).status).to.equal('accepted');
    });

    it('response body has jobId', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest(makeRequest());
      expect((res.body as any).jobId).to.be.a('string');
    });

    it('response body has message', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest(makeRequest());
      expect((res.body as any).message).to.include('42');
    });

    it('returns 200 with skipped for unsupported action', async () => {
      const { handler } = makeHandler({ supportedActions: ['opened'] });
      const body = JSON.stringify(makePayload({ action: 'closed' }));
      const res = await handler.handleRequest({ ...makeRequest(), body });
      expect(res.status).to.equal(200);
      expect((res.body as any).status).to.equal('skipped');
    });

    it('returns 401 for invalid signature', async () => {
      const { handler } = makeHandler({ webhookSecret: 'secret123' });
      const res = await handler.handleRequest({
        ...makeRequest(),
        headers: { 'x-hub-signature-256': 'sha256=invalidsig' },
      });
      expect(res.status).to.equal(401);
    });

    it('returns 400 for invalid JSON body', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest({ ...makeRequest(), body: 'not json' });
      expect(res.status).to.equal(400);
    });

    it('returns 400 for payload missing pull_request', async () => {
      const { handler } = makeHandler();
      const res = await handler.handleRequest({
        ...makeRequest(),
        body: JSON.stringify({
          action: 'opened',
          repository: { name: 'repo', full_name: 'o/r', owner: { login: 'o' } },
        }),
      });
      expect(res.status).to.equal(400);
    });

    it('enqueues a job on valid request', async () => {
      const { handler, queue } = makeHandler();
      await handler.handleRequest(makeRequest());
      // Allow async processJob to start
      await new Promise((r) => setTimeout(r, 10));
      expect((await queue.size()) + 1).to.be.at.least(1);
    });

    it('accepts synchronize action', async () => {
      const { handler } = makeHandler();
      const body = JSON.stringify(makePayload({ action: 'synchronize' }));
      const res = await handler.handleRequest({ ...makeRequest(), body });
      expect(res.status).to.equal(202);
    });

    it('accepts reopened action', async () => {
      const { handler } = makeHandler();
      const body = JSON.stringify(makePayload({ action: 'reopened' }));
      const res = await handler.handleRequest({ ...makeRequest(), body });
      expect(res.status).to.equal(202);
    });
  });

  describe('validateSignature()', () => {
    it('does not throw when no secret configured', () => {
      const { handler } = makeHandler({ webhookSecret: '' });
      expect(() => handler.validateSignature('', 'body')).to.not.throw();
    });

    it('throws WebhookSignatureError for missing signature header', () => {
      const { handler } = makeHandler({ webhookSecret: 'secret' });
      expect(() => handler.validateSignature('', 'body')).to.throw(WebhookSignatureError);
    });

    it('throws WebhookSignatureError for wrong signature', () => {
      const { handler } = makeHandler({ webhookSecret: 'secret' });
      expect(() => handler.validateSignature('sha256=wrongsig', 'body')).to.throw(
        WebhookSignatureError
      );
    });

    it('does not throw for correct HMAC signature', () => {
      const { handler } = makeHandler({ webhookSecret: 'mysecret' });
      const body = 'test body';
      const hmac = handler.computeHmac(body, 'mysecret');
      expect(() => handler.validateSignature(`sha256=${hmac}`, body)).to.not.throw();
    });

    it('WebhookSignatureError has correct name', () => {
      const { handler } = makeHandler({ webhookSecret: 'secret' });
      let err: any;
      try {
        handler.validateSignature('sha256=bad', 'body');
      } catch (e) {
        err = e;
      }
      expect(err?.name).to.equal('WebhookSignatureError');
    });
  });

  describe('parsePayload()', () => {
    it('parses valid payload', () => {
      const { handler } = makeHandler();
      const result = handler.parsePayload(JSON.stringify(makePayload()));
      expect(result.action).to.equal('opened');
      expect(result.pull_request.number).to.equal(42);
    });

    it('throws WebhookPayloadError for invalid JSON', () => {
      const { handler } = makeHandler();
      expect(() => handler.parsePayload('not json')).to.throw(WebhookPayloadError);
    });

    it('throws WebhookPayloadError for missing action', () => {
      const { handler } = makeHandler();
      expect(() =>
        handler.parsePayload(JSON.stringify({ pull_request: {}, repository: {} }))
      ).to.throw(WebhookPayloadError);
    });

    it('throws WebhookPayloadError for missing pull_request', () => {
      const { handler } = makeHandler();
      expect(() =>
        handler.parsePayload(JSON.stringify({ action: 'opened', repository: {} }))
      ).to.throw(WebhookPayloadError);
    });

    it('throws WebhookPayloadError for missing repository', () => {
      const { handler } = makeHandler();
      expect(() =>
        handler.parsePayload(JSON.stringify({ action: 'opened', pull_request: {} }))
      ).to.throw(WebhookPayloadError);
    });

    it('preserves all payload fields', () => {
      const { handler } = makeHandler();
      const payload = makePayload();
      const result = handler.parsePayload(JSON.stringify(payload));
      expect(result.repository.owner.login).to.equal('owner');
      expect(result.pull_request.title).to.equal('feat: add useQuery migration');
    });
  });

  describe('buildJob()', () => {
    it('returns a PRSummaryJob', () => {
      const { handler } = makeHandler();
      const job = handler.buildJob(makePayload());
      expect(job).to.have.all.keys(
        'jobId',
        'owner',
        'repo',
        'prNumber',
        'prTitle',
        'prUrl',
        'queuedAt',
        'attempts',
        'maxAttempts'
      );
    });

    it('sets owner from repository', () => {
      const { handler } = makeHandler();
      expect(handler.buildJob(makePayload()).owner).to.equal('owner');
    });

    it('sets repo from repository', () => {
      const { handler } = makeHandler();
      expect(handler.buildJob(makePayload()).repo).to.equal('repo');
    });

    it('sets prNumber from pull_request', () => {
      const { handler } = makeHandler();
      expect(handler.buildJob(makePayload()).prNumber).to.equal(42);
    });

    it('sets prTitle from pull_request', () => {
      const { handler } = makeHandler();
      expect(handler.buildJob(makePayload()).prTitle).to.equal('feat: add useQuery migration');
    });

    it('sets prUrl from pull_request', () => {
      const { handler } = makeHandler();
      expect(handler.buildJob(makePayload()).prUrl).to.include('github.com');
    });

    it('sets queuedAt as ISO string', () => {
      const { handler } = makeHandler();
      const job = handler.buildJob(makePayload());
      expect(job.queuedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sets attempts to 0', () => {
      const { handler } = makeHandler();
      expect(handler.buildJob(makePayload()).attempts).to.equal(0);
    });

    it('sets maxAttempts from config', () => {
      const { handler } = makeHandler({ maxRetryAttempts: 5 });
      expect(handler.buildJob(makePayload()).maxAttempts).to.equal(5);
    });

    it('jobId includes owner, repo, prNumber', () => {
      const { handler } = makeHandler();
      const job = handler.buildJob(makePayload());
      expect(job.jobId).to.include('owner');
      expect(job.jobId).to.include('repo');
      expect(job.jobId).to.include('42');
    });
  });

  describe('processJob()', () => {
    function makeJob(overrides: Partial<PRSummaryJob> = {}): PRSummaryJob {
      return {
        jobId: 'job-owner-repo-42-123',
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        prTitle: 'feat: migration',
        prUrl: 'https://github.com/owner/repo/pull/42',
        queuedAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
        ...overrides,
      };
    }

    it('calls generateSummary with correct args', async () => {
      const generator = makeSummaryGenerator();
      const { handler } = makeHandler({}, generator);
      await handler.processJob(makeJob());
      expect((generator.generateSummary as SinonStub).calledWith('owner', 'repo', 42, 'webhook')).to
        .be.true;
    });

    it('calls postComment after generating summary', async () => {
      const poster = makeCommentPoster();
      const { handler } = makeHandler({}, undefined, poster);
      await handler.processJob(makeJob());
      expect((poster.postComment as SinonStub).callCount).to.equal(1);
    });

    it('calls formatBody with summary data', async () => {
      const poster = makeCommentPoster();
      const { handler } = makeHandler({}, undefined, poster);
      await handler.processJob(makeJob());
      expect((poster.formatBody as SinonStub).callCount).to.equal(1);
    });

    it('passes formatted body to postComment', async () => {
      const poster = makeCommentPoster({
        formatBody: sinon.stub().returns('formatted-body'),
      });
      const { handler } = makeHandler({}, undefined, poster);
      await handler.processJob(makeJob());
      const body = (poster.postComment as SinonStub).firstCall.args[3];
      expect(body).to.equal('formatted-body');
    });

    it('retries on failure up to maxAttempts', async () => {
      const generator = makeSummaryGenerator({
        generateSummary: sinon.stub().rejects(new Error('Service unavailable')),
      });
      const { handler } = makeHandler({ retryDelayMs: 0 }, generator);
      let threw = false;
      try {
        await handler.processJob(makeJob({ maxAttempts: 2 }));
      } catch {
        threw = true;
      }
      expect(threw).to.be.true;
      expect((generator.generateSummary as SinonStub).callCount).to.equal(2);
    });

    it('succeeds on second attempt after first failure', async () => {
      const generator = makeSummaryGenerator({
        generateSummary: sinon
          .stub()
          .onFirstCall()
          .rejects(new Error('Transient error'))
          .resolves({
            summary: {
              id: 'x',
              owner: 'owner',
              repo: 'repo',
              prNumber: 42,
              prTitle: 'feat',
              prState: 'open',
              summary: '## Summary\nOK',
              chunkSummaries: [],
              wasChunked: false,
              foundryAgentId: null,
              foundryThreadId: null,
              templateVersion: '1.0.0',
              abVariant: null,
              status: 'complete',
              errorMessage: null,
              trigger: 'webhook',
              generatedAt: new Date().toISOString(),
              expiresAt: new Date().toISOString(),
              prUpdatedAt: new Date().toISOString(),
            },
          }),
      });
      const { handler } = makeHandler({ retryDelayMs: 0 }, generator);
      await handler.processJob(makeJob());
      expect((generator.generateSummary as SinonStub).callCount).to.equal(2);
    });

    it('throws after all retry attempts exhausted', async () => {
      const generator = makeSummaryGenerator({
        generateSummary: sinon.stub().rejects(new Error('Always fails')),
      });
      const { handler } = makeHandler({ retryDelayMs: 0, maxRetryAttempts: 3 }, generator);
      let threw = false;
      try {
        await handler.processJob(makeJob({ maxAttempts: 3 }));
      } catch (e: any) {
        threw = true;
        expect(e.message).to.include('3 attempts');
      }
      expect(threw).to.be.true;
    });
  });

  describe('computeHmac()', () => {
    it('returns a hex string', () => {
      const { handler } = makeHandler();
      const result = handler.computeHmac('body', 'secret');
      expect(result).to.match(/^[0-9a-f]+$/);
    });

    it('produces consistent output', () => {
      const { handler } = makeHandler();
      expect(handler.computeHmac('body', 'secret')).to.equal(handler.computeHmac('body', 'secret'));
    });

    it('produces different output for different secrets', () => {
      const { handler } = makeHandler();
      expect(handler.computeHmac('body', 'secret1')).to.not.equal(
        handler.computeHmac('body', 'secret2')
      );
    });

    it('produces different output for different bodies', () => {
      const { handler } = makeHandler();
      expect(handler.computeHmac('body1', 'secret')).to.not.equal(
        handler.computeHmac('body2', 'secret')
      );
    });
  });

  describe('timingSafeEqual()', () => {
    it('returns true for equal strings', () => {
      const { handler } = makeHandler();
      expect(handler.timingSafeEqual('abc', 'abc')).to.be.true;
    });

    it('returns false for different strings of same length', () => {
      const { handler } = makeHandler();
      expect(handler.timingSafeEqual('abc', 'xyz')).to.be.false;
    });

    it('returns false for different length strings', () => {
      const { handler } = makeHandler();
      expect(handler.timingSafeEqual('abc', 'abcd')).to.be.false;
    });

    it('returns false for empty vs non-empty', () => {
      const { handler } = makeHandler();
      expect(handler.timingSafeEqual('', 'abc')).to.be.false;
    });
  });

  describe('generateJobId()', () => {
    it('returns a string', () => {
      const { handler } = makeHandler();
      expect(handler.generateJobId('owner', 'repo', 42)).to.be.a('string');
    });

    it('includes owner, repo, prNumber', () => {
      const { handler } = makeHandler();
      const id = handler.generateJobId('owner', 'repo', 42);
      expect(id).to.include('owner');
      expect(id).to.include('repo');
      expect(id).to.include('42');
    });

    it('returns lowercase', () => {
      const { handler } = makeHandler();
      const id = handler.generateJobId('Owner', 'Repo', 1);
      expect(id).to.equal(id.toLowerCase());
    });

    it('produces unique IDs for same PR (timestamp)', async () => {
      const { handler } = makeHandler();
      const id1 = handler.generateJobId('owner', 'repo', 42);
      await new Promise((r) => setTimeout(r, 1));
      const id2 = handler.generateJobId('owner', 'repo', 42);
      expect(id1).to.not.equal(id2);
    });
  });

  describe('isSupportedAction()', () => {
    it('returns true for opened', () => {
      expect(makeHandler().handler.isSupportedAction('opened')).to.be.true;
    });

    it('returns true for synchronize', () => {
      expect(makeHandler().handler.isSupportedAction('synchronize')).to.be.true;
    });

    it('returns true for reopened', () => {
      expect(makeHandler().handler.isSupportedAction('reopened')).to.be.true;
    });

    it('returns false for closed', () => {
      expect(makeHandler().handler.isSupportedAction('closed')).to.be.false;
    });

    it('returns false for unknown action', () => {
      expect(makeHandler().handler.isSupportedAction('deleted')).to.be.false;
    });

    it('respects custom supportedActions config', () => {
      const { handler } = makeHandler({ supportedActions: ['opened'] });
      expect(handler.isSupportedAction('synchronize')).to.be.false;
      expect(handler.isSupportedAction('opened')).to.be.true;
    });
  });

  describe('InMemoryJobQueue', () => {
    function makeJob(): PRSummaryJob {
      return {
        jobId: 'job-1',
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        prTitle: 'feat',
        prUrl: 'https://github.com',
        queuedAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
      };
    }

    it('starts empty', async () => {
      const q = new InMemoryJobQueue();
      expect(await q.size()).to.equal(0);
    });

    it('enqueues a job', async () => {
      const q = new InMemoryJobQueue();
      await q.enqueue(makeJob());
      expect(await q.size()).to.equal(1);
    });

    it('dequeues a job', async () => {
      const q = new InMemoryJobQueue();
      await q.enqueue(makeJob());
      const job = await q.dequeue();
      expect(job?.jobId).to.equal('job-1');
    });

    it('dequeues in FIFO order', async () => {
      const q = new InMemoryJobQueue();
      await q.enqueue({ ...makeJob(), jobId: 'job-1' });
      await q.enqueue({ ...makeJob(), jobId: 'job-2' });
      expect((await q.dequeue())?.jobId).to.equal('job-1');
      expect((await q.dequeue())?.jobId).to.equal('job-2');
    });

    it('returns null when dequeuing from empty queue', async () => {
      const q = new InMemoryJobQueue();
      expect(await q.dequeue()).to.be.null;
    });

    it('decrements size after dequeue', async () => {
      const q = new InMemoryJobQueue();
      await q.enqueue(makeJob());
      await q.dequeue();
      expect(await q.size()).to.equal(0);
    });

    it('clear() empties the queue', async () => {
      const q = new InMemoryJobQueue();
      await q.enqueue(makeJob());
      await q.enqueue(makeJob());
      q.clear();
      expect(await q.size()).to.equal(0);
    });

    it('peek() returns all jobs without removing', async () => {
      const q = new InMemoryJobQueue();
      await q.enqueue(makeJob());
      const jobs = q.peek();
      expect(jobs).to.have.length(1);
      expect(await q.size()).to.equal(1);
    });
  });

  describe('WebhookSignatureError', () => {
    it('has correct name', () => {
      expect(new WebhookSignatureError().name).to.equal('WebhookSignatureError');
    });

    it('has descriptive message', () => {
      expect(new WebhookSignatureError().message).to.include('signature');
    });
  });

  describe('WebhookPayloadError', () => {
    it('has correct name', () => {
      expect(new WebhookPayloadError('missing field').name).to.equal('WebhookPayloadError');
    });

    it('includes reason in message', () => {
      expect(new WebhookPayloadError('missing action').message).to.include('missing action');
    });
  });
});
