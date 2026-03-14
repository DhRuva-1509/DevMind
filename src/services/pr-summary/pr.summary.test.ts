import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import {
  PRSummaryAgent,
  ContextAdapter,
  PromptAdapter,
  FoundryAdapter,
  CacheAdapter,
} from './pr.summary.agent';
import { PRSummaryAgentConfig, PRSummary, SummaryTrigger } from './pr.summary.types';
import { ExtractedPRContext } from '../pr-context/pr.context.types';
import { RenderedPrompt } from '../prompt-templates/prompt.template.types';

function makeContext(overrides: Partial<ExtractedPRContext> = {}): ExtractedPRContext {
  return {
    id: 'pr-context-owner-repo-42',
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: add useQuery migration',
    prBody: 'Closes #10.',
    prAuthor: 'dhruva',
    prState: 'open',
    headBranch: 'feature/migration',
    baseBranch: 'main',
    prUrl: 'https://github.com/owner/repo/pull/42',
    changedFiles: [
      {
        path: 'src/a.ts',
        changeType: 'modified',
        additions: 10,
        deletions: 5,
        language: 'TypeScript',
        isTest: false,
        isConfig: false,
      },
      {
        path: 'src/b.ts',
        changeType: 'added',
        additions: 20,
        deletions: 0,
        language: 'TypeScript',
        isTest: false,
        isConfig: false,
      },
    ],
    parsedDiffs: [
      {
        path: 'src/a.ts',
        changeType: 'modified',
        hunks: [
          {
            header: '@@ -1,3 +1,3 @@',
            startLine: 1,
            lineCount: 3,
            lines: [{ type: 'added', content: 'const x = 1;', lineNumber: 1 }],
          },
        ],
        additions: 10,
        deletions: 5,
        truncated: false,
      },
    ],
    commits: [
      {
        sha: 'abc123',
        message: 'feat: migration',
        subject: 'feat: migration',
        body: null,
        author: 'dhruva',
        timestamp: '2026-03-14T00:00:00Z',
      },
    ],
    issueReferences: [{ number: 10, source: 'pr_body', rawMatch: 'Closes #10', title: null }],
    detectedPatterns: [{ type: 'async_await', files: ['src/a.ts'], occurrences: 1, example: null }],
    tokenBudget: {
      totalTokens: 500,
      budgetLimit: 8000,
      wasTruncated: false,
      breakdown: {
        prMetadata: 100,
        changedFiles: 50,
        diffs: 200,
        commits: 50,
        issueRefs: 50,
        patterns: 50,
      },
    },
    extractedAt: '2026-03-14T00:00:00Z',
    expiresAt: '2026-03-14T01:00:00Z',
    ...overrides,
  };
}

function makeRenderedPrompt(overrides: Partial<RenderedPrompt> = {}): RenderedPrompt {
  return {
    systemPrompt: 'You are an expert engineer.',
    contextPrompt: 'PR #42: feat migration. Changed 2 files.',
    templateVersions: { system: '1.0.0', context: '1.0.0' },
    abVariant: null,
    prSize: 'small',
    estimatedTokens: 100,
    usedFallback: false,
    ...overrides,
  };
}

function makeContextAdapter(overrides: Partial<ContextAdapter> = {}): ContextAdapter {
  return {
    extractContext: sinon.stub().resolves({ context: makeContext(), fromCache: false }),
    ...overrides,
  };
}

function makePromptAdapter(overrides: Partial<PromptAdapter> = {}): PromptAdapter {
  return {
    renderPrompt: sinon.stub().resolves(makeRenderedPrompt()),
    renderErrorPrompt: sinon.stub().resolves('Error generating summary for PR #42'),
    ...overrides,
  };
}

function makeFoundryAdapter(overrides: Partial<FoundryAdapter> = {}): FoundryAdapter {
  return {
    runAgent: sinon.stub().resolves({
      threadId: 'thread-123',
      content: '## Summary\n\nThis PR migrates useQuery syntax.',
      tokenCount: 50,
      durationMs: 200,
    }),
    isAvailable: sinon.stub().resolves(true),
    ...overrides,
  };
}

function makeCacheAdapter(overrides: Partial<CacheAdapter> = {}): CacheAdapter {
  return {
    read: sinon.stub().resolves({ success: false }),
    upsert: sinon.stub().resolves({ success: true }),
    ...overrides,
  };
}

function makeAgent(
  config: PRSummaryAgentConfig = {},
  ctx?: ContextAdapter,
  prompt?: PromptAdapter,
  foundry?: FoundryAdapter,
  cache?: CacheAdapter
): PRSummaryAgent {
  return new PRSummaryAgent(
    config,
    ctx ?? makeContextAdapter(),
    prompt ?? makePromptAdapter(),
    foundry ?? makeFoundryAdapter(),
    cache ?? makeCacheAdapter()
  );
}

function makeCachedSummary(overrides: Partial<PRSummary> = {}): PRSummary {
  return {
    id: 'pr-summary-owner-repo-42',
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: add useQuery migration',
    prState: 'open',
    summary: '## Summary\n\nCached summary.',
    chunkSummaries: [],
    wasChunked: false,
    foundryAgentId: 'agent-123',
    foundryThreadId: 'thread-456',
    templateVersion: '1.0.0',
    abVariant: null,
    status: 'complete',
    errorMessage: null,
    trigger: 'command',
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    prUpdatedAt: '2026-03-14T00:00:00Z',
    ...overrides,
  };
}

describe('PRSummaryAgent', () => {
  afterEach(() => sinon.restore());

  describe('constructor', () => {
    it('creates an instance with default config', () => {
      expect(makeAgent()).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts custom foundryAgentId', () => {
      expect(makeAgent({ foundryAgentId: 'agent-abc' })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts custom deployment', () => {
      expect(makeAgent({ deployment: 'gpt-4o-mini' })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts custom maxOutputTokens', () => {
      expect(makeAgent({ maxOutputTokens: 1000 })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts custom largeprThreshold', () => {
      expect(makeAgent({ largeprThreshold: 4000 })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts custom chunkSize', () => {
      expect(makeAgent({ chunkSize: 2000 })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts enableCaching: false', () => {
      expect(makeAgent({ enableCaching: false })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts custom cacheTtlMs', () => {
      expect(makeAgent({ cacheTtlMs: 30000 })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts refreshOnUpdate: false', () => {
      expect(makeAgent({ refreshOnUpdate: false })).to.be.instanceOf(PRSummaryAgent);
    });

    it('accepts enableLogging: false', () => {
      expect(makeAgent({ enableLogging: false })).to.be.instanceOf(PRSummaryAgent);
    });
  });

  describe('generateSummary()', () => {
    it('returns a GenerationResult with correct shape', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result).to.have.all.keys('summary', 'fromCache', 'durationMs', 'contextFromCache');
    });

    it('sets fromCache: false on fresh generation', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.fromCache).to.be.false;
    });

    it('records durationMs >= 0', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.durationMs).to.be.at.least(0);
    });

    it('calls extractContext with correct args', async () => {
      const ctx = makeContextAdapter();
      await makeAgent({ enableCaching: false }, ctx).generateSummary('owner', 'repo', 42);
      expect((ctx.extractContext as SinonStub).calledWith('owner', 'repo', 42)).to.be.true;
    });

    it('calls renderPrompt with context', async () => {
      const prompt = makePromptAdapter();
      await makeAgent({ enableCaching: false }, undefined, prompt).generateSummary(
        'owner',
        'repo',
        42
      );
      expect((prompt.renderPrompt as SinonStub).callCount).to.equal(1);
    });

    it('calls foundry runAgent when available', async () => {
      const foundry = makeFoundryAdapter();
      await makeAgent(
        { enableCaching: false, foundryAgentId: 'agent-1' },
        undefined,
        undefined,
        foundry
      ).generateSummary('owner', 'repo', 42);
      expect((foundry.runAgent as SinonStub).callCount).to.equal(1);
    });

    it('does not call runAgent when foundry unavailable', async () => {
      const foundry = makeFoundryAdapter({ isAvailable: sinon.stub().resolves(false) });
      await makeAgent(
        { enableCaching: false, foundryAgentId: 'agent-1' },
        undefined,
        undefined,
        foundry
      ).generateSummary('owner', 'repo', 42);
      expect((foundry.runAgent as SinonStub).callCount).to.equal(0);
    });

    it('returns summary with prNumber', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.prNumber).to.equal(42);
    });

    it('returns summary with owner and repo', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.owner).to.equal('owner');
      expect(result.summary.repo).to.equal('repo');
    });

    it('returns summary with non-empty summary text', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.summary).to.be.a('string').with.length.above(0);
    });

    it('sets summary status to complete on success', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.status).to.equal('complete');
    });

    it('sets generatedAt as ISO string', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.generatedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('sets expiresAt after generatedAt', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(new Date(result.summary.expiresAt).getTime()).to.be.greaterThan(
        new Date(result.summary.generatedAt).getTime()
      );
    });

    it('writes summary to cache when enableCaching is true', async () => {
      const cache = makeCacheAdapter();
      await makeAgent(
        { enableCaching: true },
        undefined,
        undefined,
        undefined,
        cache
      ).generateSummary('owner', 'repo', 42);
      expect((cache.upsert as SinonStub).callCount).to.equal(1);
    });

    it('does not write to cache when enableCaching is false', async () => {
      const cache = makeCacheAdapter();
      await makeAgent(
        { enableCaching: false },
        undefined,
        undefined,
        undefined,
        cache
      ).generateSummary('owner', 'repo', 42);
      expect((cache.upsert as SinonStub).callCount).to.equal(0);
    });

    it('returns fromCache: true on cache hit', async () => {
      const cached = makeCachedSummary();
      const cache = makeCacheAdapter({
        read: sinon.stub().resolves({ success: true, data: cached }),
      });
      const result = await makeAgent(
        { enableCaching: true },
        undefined,
        undefined,
        undefined,
        cache
      ).generateSummary('owner', 'repo', 42);
      expect(result.fromCache).to.be.true;
      expect(result.durationMs).to.equal(0);
    });

    it('does not call extractContext on cache hit', async () => {
      const cached = makeCachedSummary();
      const cache = makeCacheAdapter({
        read: sinon.stub().resolves({ success: true, data: cached }),
      });
      const ctx = makeContextAdapter();
      await makeAgent({ enableCaching: true }, ctx, undefined, undefined, cache).generateSummary(
        'owner',
        'repo',
        42
      );
      expect((ctx.extractContext as SinonStub).callCount).to.equal(0);
    });

    it('sets trigger on summary', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary(
        'owner',
        'repo',
        42,
        'webhook'
      );
      expect(result.summary.trigger).to.equal('webhook');
    });

    it('defaults trigger to command', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.trigger).to.equal('command');
    });

    it('sets status to failed when foundry throws', async () => {
      const foundry = makeFoundryAdapter({
        runAgent: sinon.stub().rejects(new Error('Foundry down')),
      });
      const result = await makeAgent(
        { enableCaching: false, foundryAgentId: 'agent-1' },
        undefined,
        undefined,
        foundry
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary.status).to.equal('failed');
    });

    it('sets errorMessage when foundry throws', async () => {
      const foundry = makeFoundryAdapter({
        runAgent: sinon.stub().rejects(new Error('Foundry down')),
      });
      const result = await makeAgent(
        { enableCaching: false, foundryAgentId: 'agent-1' },
        undefined,
        undefined,
        foundry
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary.errorMessage).to.include('Foundry down');
    });

    it('throws PRSummaryContextError when context extraction fails', async () => {
      const ctx = makeContextAdapter({
        extractContext: sinon.stub().rejects(new Error('GitHub down')),
      });
      let threw = false;
      try {
        await makeAgent({ enableCaching: false }, ctx).generateSummary('owner', 'repo', 42);
      } catch (e: any) {
        threw = true;
        expect(e.name).to.equal('PRSummaryContextError');
      }
      expect(threw).to.be.true;
    });

    it('re-fetches when cache is expired', async () => {
      const expired = makeCachedSummary({ expiresAt: new Date(0).toISOString() });
      const cache = makeCacheAdapter({
        read: sinon.stub().resolves({ success: true, data: expired }),
      });
      const ctx = makeContextAdapter();
      await makeAgent({ enableCaching: true }, ctx, undefined, undefined, cache).generateSummary(
        'owner',
        'repo',
        42
      );
      expect((ctx.extractContext as SinonStub).callCount).to.equal(1);
    });

    it('sets foundryThreadId from run result', async () => {
      const foundry = makeFoundryAdapter();
      const result = await makeAgent(
        { enableCaching: false, foundryAgentId: 'agent-1' },
        undefined,
        undefined,
        foundry
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary.foundryThreadId).to.equal('thread-123');
    });

    it('sets contextFromCache from extraction result', async () => {
      const ctx = makeContextAdapter({
        extractContext: sinon.stub().resolves({ context: makeContext(), fromCache: true }),
      });
      const result = await makeAgent({ enableCaching: false }, ctx).generateSummary(
        'owner',
        'repo',
        42
      );
      expect(result.contextFromCache).to.be.true;
    });
  });

  describe('requiresChunking()', () => {
    it('returns false for small context', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 500,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      expect(makeAgent().requiresChunking(ctx)).to.be.false;
    });

    it('returns true when tokens exceed largeprThreshold', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 7000,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      expect(makeAgent({ largeprThreshold: 6000 }).requiresChunking(ctx)).to.be.true;
    });

    it('returns false when tokens equal threshold', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 6000,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      expect(makeAgent({ largeprThreshold: 6000 }).requiresChunking(ctx)).to.be.false;
    });

    it('respects custom largeprThreshold', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 2000,
          budgetLimit: 8000,
          wasTruncated: false,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      expect(makeAgent({ largeprThreshold: 1000 }).requiresChunking(ctx)).to.be.true;
    });
  });

  describe('splitContextIntoChunks()', () => {
    it('returns at least one chunk', () => {
      const chunks = makeAgent().splitContextIntoChunks(makeContext());
      expect(chunks).to.have.length.at.least(1);
    });

    it('each chunk has files array', () => {
      const chunks = makeAgent().splitContextIntoChunks(makeContext());
      chunks.forEach((c) => expect(c.files).to.be.an('array'));
    });

    it('each chunk has diffTokens', () => {
      const chunks = makeAgent().splitContextIntoChunks(makeContext());
      chunks.forEach((c) => expect(c.diffTokens).to.be.a('number'));
    });

    it('returns single chunk for small context', () => {
      const ctx = makeContext();
      const chunks = makeAgent({ chunkSize: 10000 }).splitContextIntoChunks(ctx);
      expect(chunks).to.have.length(1);
    });

    it('all files appear in some chunk', () => {
      const ctx = makeContext();
      const chunks = makeAgent().splitContextIntoChunks(ctx);
      const allFiles = chunks.flatMap((c) => c.files);
      ctx.parsedDiffs.forEach((d) => expect(allFiles).to.include(d.path));
    });

    it('splits into multiple chunks when diffs exceed chunkSize', () => {
      const bigContext = makeContext({
        parsedDiffs: Array.from({ length: 10 }, (_, i) => ({
          path: `src/file${i}.ts`,
          changeType: 'modified' as const,
          hunks: [
            {
              header: '@@ -1 +1 @@',
              startLine: 1,
              lineCount: 1,
              lines: [{ type: 'added' as const, content: 'x'.repeat(500), lineNumber: 1 }],
            },
          ],
          additions: 1,
          deletions: 0,
          truncated: false,
        })),
      });
      const chunks = makeAgent({ chunkSize: 50 }).splitContextIntoChunks(bigContext);
      expect(chunks.length).to.be.greaterThan(1);
    });
  });

  describe('buildChunkContext()', () => {
    it('returns an ExtractedPRContext', () => {
      const ctx = makeContext();
      const chunk = { files: ['src/a.ts'], diffTokens: 100 };
      const result = makeAgent().buildChunkContext(ctx, chunk, 0, 2);
      expect(result).to.have.property('prNumber');
    });

    it('filters parsedDiffs to chunk files only', () => {
      const ctx = makeContext();
      const chunk = { files: ['src/a.ts'], diffTokens: 100 };
      const result = makeAgent().buildChunkContext(ctx, chunk, 0, 2);
      result.parsedDiffs.forEach((d) => expect(chunk.files).to.include(d.path));
    });

    it('filters changedFiles to chunk files only', () => {
      const ctx = makeContext();
      const chunk = { files: ['src/a.ts'], diffTokens: 100 };
      const result = makeAgent().buildChunkContext(ctx, chunk, 0, 2);
      result.changedFiles.forEach((f) => expect(chunk.files).to.include(f.path));
    });

    it('appends chunk index to prTitle', () => {
      const ctx = makeContext();
      const result = makeAgent().buildChunkContext(ctx, { files: [], diffTokens: 0 }, 1, 3);
      expect(result.prTitle).to.include('[Chunk 2/3]');
    });

    it('preserves prNumber', () => {
      const ctx = makeContext();
      const result = makeAgent().buildChunkContext(ctx, { files: [], diffTokens: 0 }, 0, 1);
      expect(result.prNumber).to.equal(42);
    });
  });

  describe('mergeChunkSummaries()', () => {
    it('returns a string', () => {
      const ctx = makeContext();
      const result = makeAgent().mergeChunkSummaries([], ctx);
      expect(result).to.be.a('string');
    });

    it('includes PR number in merged output', () => {
      const ctx = makeContext();
      const result = makeAgent().mergeChunkSummaries([], ctx);
      expect(result).to.include('42');
    });

    it('includes each chunk content', () => {
      const ctx = makeContext();
      const chunks = [
        { chunkIndex: 0, files: ['src/a.ts'], content: 'Chunk one content', tokenCount: 10 },
        { chunkIndex: 1, files: ['src/b.ts'], content: 'Chunk two content', tokenCount: 10 },
      ];
      const result = makeAgent().mergeChunkSummaries(chunks, ctx);
      expect(result).to.include('Chunk one content');
      expect(result).to.include('Chunk two content');
    });

    it('includes chunk count header', () => {
      const ctx = makeContext();
      const chunks = [{ chunkIndex: 0, files: ['src/a.ts'], content: 'content', tokenCount: 10 }];
      const result = makeAgent().mergeChunkSummaries(chunks, ctx);
      expect(result).to.include('1 chunk');
    });

    it('handles empty chunks array', () => {
      const ctx = makeContext();
      expect(() => makeAgent().mergeChunkSummaries([], ctx)).to.not.throw();
    });
  });

  describe('buildFallbackSummary()', () => {
    it('returns a string', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.be.a('string').with.length.above(0);
    });

    it('includes PR number', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.include('42');
    });

    it('includes PR author', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.include('dhruva');
    });

    it('includes changed file paths', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.include('src/a.ts');
    });

    it('includes fallback note', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.include('Fallback summary');
    });

    it('includes detected patterns', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.include('async_await');
    });

    it('includes linked issues', () => {
      const result = makeAgent().buildFallbackSummary(makeContext(), makeRenderedPrompt());
      expect(result).to.include('#10');
    });
  });

  describe('isStale()', () => {
    it('returns false for fresh non-expired summary', () => {
      const summary = makeCachedSummary({
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        prUpdatedAt: '2026-03-14T00:00:00Z',
        generatedAt: new Date().toISOString(),
      });
      expect(makeAgent().isStale(summary)).to.be.false;
    });

    it('returns true when TTL expired', () => {
      const summary = makeCachedSummary({ expiresAt: new Date(0).toISOString() });
      expect(makeAgent().isStale(summary)).to.be.true;
    });

    it('returns true when prUpdatedAt is after generatedAt', () => {
      const now = Date.now();
      const summary = makeCachedSummary({
        generatedAt: new Date(now - 5000).toISOString(),
        prUpdatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      });
      expect(makeAgent().isStale(summary)).to.be.true;
    });

    it('returns false when refreshOnUpdate is false even if PR updated', () => {
      const now = Date.now();
      const summary = makeCachedSummary({
        generatedAt: new Date(now - 5000).toISOString(),
        prUpdatedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      });
      expect(makeAgent({ refreshOnUpdate: false }).isStale(summary)).to.be.false;
    });

    it('returns false when prUpdatedAt is before generatedAt', () => {
      const now = Date.now();
      const summary = makeCachedSummary({
        generatedAt: new Date(now).toISOString(),
        prUpdatedAt: new Date(now - 5000).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
      });
      expect(makeAgent().isStale(summary)).to.be.false;
    });
  });

  describe('buildCacheKey()', () => {
    it('returns a string', () => {
      expect(makeAgent().buildCacheKey('owner', 'repo', 42)).to.be.a('string');
    });

    it('includes pr number', () => {
      expect(makeAgent().buildCacheKey('owner', 'repo', 42)).to.include('42');
    });

    it('includes owner and repo', () => {
      const key = makeAgent().buildCacheKey('dhruva', 'devmind', 42);
      expect(key).to.include('dhruva');
      expect(key).to.include('devmind');
    });

    it('returns lowercase', () => {
      const key = makeAgent().buildCacheKey('Owner', 'Repo', 1);
      expect(key).to.equal(key.toLowerCase());
    });

    it('produces deterministic keys', () => {
      const agent = makeAgent();
      expect(agent.buildCacheKey('o', 'r', 1)).to.equal(agent.buildCacheKey('o', 'r', 1));
    });

    it('produces different keys for different PRs', () => {
      const agent = makeAgent();
      expect(agent.buildCacheKey('o', 'r', 1)).to.not.equal(agent.buildCacheKey('o', 'r', 2));
    });
  });

  describe('estimateTokens()', () => {
    it('estimates ~1 token per 4 chars', () => {
      expect(makeAgent().estimateTokens('1234')).to.equal(1);
    });

    it('returns 0 for empty string', () => {
      expect(makeAgent().estimateTokens('')).to.equal(0);
    });

    it('rounds up', () => {
      expect(makeAgent().estimateTokens('12345')).to.equal(2);
    });
  });

  describe('refreshSummary()', () => {
    it('returns a GenerationResult', async () => {
      const result = await makeAgent({ enableCaching: false }).refreshSummary('owner', 'repo', 42);
      expect(result).to.have.property('summary');
    });

    it('calls extractContext', async () => {
      const ctx = makeContextAdapter();
      await makeAgent({ enableCaching: false }, ctx).refreshSummary('owner', 'repo', 42);
      expect((ctx.extractContext as SinonStub).callCount).to.equal(1);
    });

    it('bypasses cache even if valid cache exists', async () => {
      const cached = makeCachedSummary();
      const readStub = sinon.stub();
      readStub.onFirstCall().resolves({ success: false });
      readStub.resolves({ success: false });
      const cache = makeCacheAdapter({ read: readStub });
      const ctx = makeContextAdapter();
      await makeAgent({ enableCaching: true }, ctx, undefined, undefined, cache).refreshSummary(
        'owner',
        'repo',
        42
      );
      expect((ctx.extractContext as SinonStub).callCount).to.equal(1);
    });
  });

  describe('getCachedSummary()', () => {
    it('returns null when caching disabled', async () => {
      const result = await makeAgent({ enableCaching: false }).getCachedSummary(
        'owner',
        'repo',
        42
      );
      expect(result).to.be.null;
    });

    it('returns null when cache miss', async () => {
      const result = await makeAgent({ enableCaching: true }).getCachedSummary('owner', 'repo', 42);
      expect(result).to.be.null;
    });

    it('returns summary on cache hit', async () => {
      const cached = makeCachedSummary();
      const cache = makeCacheAdapter({
        read: sinon.stub().resolves({ success: true, data: cached }),
      });
      const result = await makeAgent(
        { enableCaching: true },
        undefined,
        undefined,
        undefined,
        cache
      ).getCachedSummary('owner', 'repo', 42);
      expect(result).to.not.be.null;
      expect(result?.prNumber).to.equal(42);
    });

    it('returns null for expired cache entry', async () => {
      const expired = makeCachedSummary({ expiresAt: new Date(0).toISOString() });
      const cache = makeCacheAdapter({
        read: sinon.stub().resolves({ success: true, data: expired }),
      });
      const result = await makeAgent(
        { enableCaching: true },
        undefined,
        undefined,
        undefined,
        cache
      ).getCachedSummary('owner', 'repo', 42);
      expect(result).to.be.null;
    });
  });

  describe('chunked generation', () => {
    it('generates chunked summary for large PRs', async () => {
      const largeCtx = makeContext({
        tokenBudget: {
          totalTokens: 8000,
          budgetLimit: 8000,
          wasTruncated: true,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      const ctx = makeContextAdapter({
        extractContext: sinon.stub().resolves({ context: largeCtx, fromCache: false }),
      });
      const result = await makeAgent(
        { enableCaching: false, largeprThreshold: 6000 },
        ctx
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary.wasChunked).to.be.true;
    });

    it('sets wasChunked: false for small PRs', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.wasChunked).to.be.false;
    });

    it('populates chunkSummaries for large PRs', async () => {
      const largeCtx = makeContext({
        tokenBudget: {
          totalTokens: 8000,
          budgetLimit: 8000,
          wasTruncated: true,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      const ctx = makeContextAdapter({
        extractContext: sinon.stub().resolves({ context: largeCtx, fromCache: false }),
      });
      const result = await makeAgent(
        { enableCaching: false, largeprThreshold: 6000 },
        ctx
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary.chunkSummaries).to.be.an('array').with.length.at.least(1);
    });

    it('chunkSummaries are empty for small PRs', async () => {
      const result = await makeAgent({ enableCaching: false }).generateSummary('owner', 'repo', 42);
      expect(result.summary.chunkSummaries).to.deep.equal([]);
    });

    it('sets status partial when some chunks fail', async () => {
      const largeCtx = makeContext({
        tokenBudget: {
          totalTokens: 8000,
          budgetLimit: 8000,
          wasTruncated: true,
          breakdown: {
            prMetadata: 0,
            changedFiles: 0,
            diffs: 0,
            commits: 0,
            issueRefs: 0,
            patterns: 0,
          },
        },
      });
      const ctx = makeContextAdapter({
        extractContext: sinon.stub().resolves({ context: largeCtx, fromCache: false }),
      });
      const foundry = makeFoundryAdapter({
        runAgent: sinon.stub().rejects(new Error('Chunk failed')),
      });
      const result = await makeAgent(
        { enableCaching: false, largeprThreshold: 6000, foundryAgentId: 'agent-1' },
        ctx,
        undefined,
        foundry
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary.status).to.equal('partial');
    });
  });

  describe('caching resilience', () => {
    it('does not throw when cache read fails', async () => {
      const cache = makeCacheAdapter({ read: sinon.stub().rejects(new Error('DB down')) });
      const result = await makeAgent(
        { enableCaching: true },
        undefined,
        undefined,
        undefined,
        cache
      ).generateSummary('owner', 'repo', 42);
      expect(result.fromCache).to.be.false;
    });

    it('does not throw when cache write fails', async () => {
      const cache = makeCacheAdapter({ upsert: sinon.stub().rejects(new Error('DB down')) });
      const result = await makeAgent(
        { enableCaching: true },
        undefined,
        undefined,
        undefined,
        cache
      ).generateSummary('owner', 'repo', 42);
      expect(result.summary).to.exist;
    });
  });
});
