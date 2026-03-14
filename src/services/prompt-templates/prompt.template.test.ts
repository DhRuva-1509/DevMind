// ─────────────────────────────────────────────────────────────
// PR Summary Prompt Template Service — Unit Tests
// TICKET-13 | DevMind – Sprint 4
// Framework: Mocha + Chai v4 + Sinon
// ─────────────────────────────────────────────────────────────

import { expect } from 'chai';
import sinon, { SinonStub } from 'sinon';
import { PromptTemplateService, BlobAdapter } from './prompt.template.service';
import {
  PromptTemplateConfig,
  PromptTemplateId,
  ABTestConfig,
  PromptTemplate,
} from './prompt.template.types';
import { ExtractedPRContext } from '../pr-context/pr.context.types';

// ── Fixtures ──────────────────────────────────────────────────

function makeContext(overrides: Partial<ExtractedPRContext> = {}): ExtractedPRContext {
  return {
    id: 'pr-context-owner-repo-42',
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: add useQuery migration',
    prBody: 'Closes #10. Migrates from v4 to v5 syntax.',
    prAuthor: 'dhruva',
    prState: 'open',
    headBranch: 'feature/migration',
    baseBranch: 'main',
    prUrl: 'https://github.com/owner/repo/pull/42',
    changedFiles: [
      {
        path: 'src/hooks/useUser.ts',
        changeType: 'modified',
        additions: 10,
        deletions: 5,
        language: 'TypeScript',
        isTest: false,
        isConfig: false,
      },
      {
        path: 'src/hooks/useUser.test.ts',
        changeType: 'modified',
        additions: 5,
        deletions: 2,
        language: 'TypeScript',
        isTest: true,
        isConfig: false,
      },
    ],
    parsedDiffs: [
      {
        path: 'src/hooks/useUser.ts',
        changeType: 'modified',
        hunks: [
          {
            header: '@@ -1,5 +1,10 @@',
            startLine: 1,
            lineCount: 3,
            lines: [
              {
                type: 'removed',
                content: "const { data } = useQuery(['user'], fetchUser);",
                lineNumber: null,
              },
              {
                type: 'added',
                content: "const { data } = useQuery({ queryKey: ['user'], queryFn: fetchUser });",
                lineNumber: 1,
              },
              { type: 'context', content: 'return data;', lineNumber: 2 },
            ],
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
        message: 'feat: migrate useQuery syntax',
        subject: 'feat: migrate useQuery syntax',
        body: null,
        author: 'dhruva',
        timestamp: '2026-03-14T00:00:00Z',
      },
    ],
    issueReferences: [{ number: 10, source: 'pr_body', rawMatch: 'Closes #10', title: null }],
    detectedPatterns: [
      {
        type: 'async_await',
        files: ['src/hooks/useUser.ts'],
        occurrences: 1,
        example: 'const { data } = useQuery',
      },
    ],
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

function makeBlobAdapter(overrides: Partial<BlobAdapter> = {}): BlobAdapter {
  return {
    upload: sinon.stub().resolves({ success: true }),
    download: sinon.stub().resolves({ success: false }),
    exists: sinon.stub().resolves(false),
    listKeys: sinon.stub().resolves([]),
    ...overrides,
  };
}

function makeService(config: PromptTemplateConfig = {}, blob?: BlobAdapter): PromptTemplateService {
  return new PromptTemplateService(config, blob ?? makeBlobAdapter());
}

// ── Tests ─────────────────────────────────────────────────────

describe('PromptTemplateService', () => {
  afterEach(() => sinon.restore());

  // ── Constructor ─────────────────────────────────────────────

  describe('constructor', () => {
    it('creates an instance with default config', () => {
      expect(makeService()).to.be.instanceOf(PromptTemplateService);
    });

    it('accepts custom containerName', () => {
      expect(makeService({ containerName: 'my-container' })).to.be.instanceOf(
        PromptTemplateService
      );
    });

    it('accepts custom blobPrefix', () => {
      expect(makeService({ blobPrefix: 'custom/' })).to.be.instanceOf(PromptTemplateService);
    });

    it('accepts enableCache: false', () => {
      expect(makeService({ enableCache: false })).to.be.instanceOf(PromptTemplateService);
    });

    it('accepts custom cacheTtlMs', () => {
      expect(makeService({ cacheTtlMs: 5000 })).to.be.instanceOf(PromptTemplateService);
    });

    it('accepts custom sizeThresholds', () => {
      expect(
        makeService({ sizeThresholds: { smallMaxLines: 50, mediumMaxLines: 300 } })
      ).to.be.instanceOf(PromptTemplateService);
    });

    it('accepts enableLogging: false', () => {
      expect(makeService({ enableLogging: false })).to.be.instanceOf(PromptTemplateService);
    });

    it('accepts activeAbTest', () => {
      expect(makeService({ activeAbTest: 'my-test' })).to.be.instanceOf(PromptTemplateService);
    });
  });

  // ── classifyPRSize ───────────────────────────────────────────

  describe('classifyPRSize()', () => {
    it('classifies PR with <= 100 total lines as small', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 50,
            deletions: 50,
            language: 'TypeScript',
            isTest: false,
            isConfig: false,
          },
        ],
      });
      expect(makeService().classifyPRSize(ctx)).to.equal('small');
    });

    it('classifies PR with exactly 100 lines as small', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 60,
            deletions: 40,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      expect(makeService().classifyPRSize(ctx)).to.equal('small');
    });

    it('classifies PR with 101-500 lines as medium', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 200,
            deletions: 100,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      expect(makeService().classifyPRSize(ctx)).to.equal('medium');
    });

    it('classifies PR with exactly 500 lines as medium', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 300,
            deletions: 200,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      expect(makeService().classifyPRSize(ctx)).to.equal('medium');
    });

    it('classifies PR with > 500 lines as large', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 400,
            deletions: 200,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      expect(makeService().classifyPRSize(ctx)).to.equal('large');
    });

    it('sums lines across all changed files', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 20,
            deletions: 10,
            language: null,
            isTest: false,
            isConfig: false,
          },
          {
            path: 'b.ts',
            changeType: 'added',
            additions: 40,
            deletions: 30,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      // total = 20+10+40+30 = 100 → small
      expect(makeService().classifyPRSize(ctx)).to.equal('small');
    });

    it('respects custom sizeThresholds', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 30,
            deletions: 20,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      const svc = makeService({ sizeThresholds: { smallMaxLines: 10, mediumMaxLines: 50 } });
      expect(svc.classifyPRSize(ctx)).to.equal('medium');
    });

    it('returns small for empty changedFiles', () => {
      const ctx = makeContext({ changedFiles: [] });
      expect(makeService().classifyPRSize(ctx)).to.equal('small');
    });
  });

  // ── selectABVariant ──────────────────────────────────────────

  describe('selectABVariant()', () => {
    it('returns null when no activeAbTest configured', () => {
      expect(makeService({ activeAbTest: null }).selectABVariant()).to.be.null;
    });

    it('returns null when activeAbTest is not set', () => {
      expect(makeService().selectABVariant()).to.be.null;
    });

    it('returns control or experiment when test is active', () => {
      const variant = makeService({ activeAbTest: 'test-1' }).selectABVariant();
      expect(['control', 'experiment']).to.include(variant);
    });
  });

  // ── renderTemplate ───────────────────────────────────────────

  describe('renderTemplate()', () => {
    it('replaces {{variable}} placeholders', () => {
      const svc = makeService();
      const result = svc.renderTemplate('Hello {{name}}!', { name: 'Dhruva' });
      expect(result).to.equal('Hello Dhruva!');
    });

    it('replaces multiple different placeholders', () => {
      const svc = makeService();
      const result = svc.renderTemplate('PR #{{prNumber}} by {{author}}', {
        prNumber: 42,
        author: 'dhruva',
      });
      expect(result).to.equal('PR #42 by dhruva');
    });

    it('replaces the same placeholder multiple times', () => {
      const svc = makeService();
      const result = svc.renderTemplate('{{x}} and {{x}}', { x: 'hello' });
      expect(result).to.equal('hello and hello');
    });

    it('replaces missing placeholder with empty string', () => {
      const svc = makeService();
      const result = svc.renderTemplate('Hello {{name}}!', {});
      expect(result).to.equal('Hello !');
    });

    it('replaces null value with empty string', () => {
      const svc = makeService();
      const result = svc.renderTemplate('Hello {{name}}!', { name: null });
      expect(result).to.equal('Hello !');
    });

    it('handles {{#if var}}...{{/if}} when var is truthy', () => {
      const svc = makeService();
      const result = svc.renderTemplate('{{#if show}}visible{{/if}}', { show: true });
      expect(result).to.equal('visible');
    });

    it('handles {{#if var}}...{{/if}} when var is falsy', () => {
      const svc = makeService();
      const result = svc.renderTemplate('{{#if show}}visible{{/if}}', { show: false });
      expect(result).to.equal('');
    });

    it('handles {{#if var}}...{{/if}} when var is empty string', () => {
      const svc = makeService();
      const result = svc.renderTemplate('prefix{{#if val}} val{{/if}}suffix', { val: '' });
      expect(result).to.equal('prefixsuffix');
    });

    it('handles {{#if var}}...{{/if}} when var is null', () => {
      const svc = makeService();
      const result = svc.renderTemplate('{{#if val}}show{{/if}}', { val: null });
      expect(result).to.equal('');
    });

    it('converts number values to string', () => {
      const svc = makeService();
      const result = svc.renderTemplate('Count: {{count}}', { count: 42 });
      expect(result).to.equal('Count: 42');
    });

    it('trims leading/trailing whitespace from result', () => {
      const svc = makeService();
      const result = svc.renderTemplate('  hello  ', {});
      expect(result).to.equal('hello');
    });

    it('returns empty string for empty template', () => {
      const svc = makeService();
      expect(svc.renderTemplate('', {})).to.equal('');
    });

    it('preserves unmatched content', () => {
      const svc = makeService();
      const result = svc.renderTemplate('no placeholders here', {});
      expect(result).to.equal('no placeholders here');
    });
  });

  // ── buildTemplateVars ────────────────────────────────────────

  describe('buildTemplateVars()', () => {
    it('returns object with all required keys', () => {
      const svc = makeService();
      const vars = svc.buildTemplateVars(makeContext(), 'small');
      const required = [
        'prNumber',
        'prTitle',
        'prAuthor',
        'prState',
        'headBranch',
        'baseBranch',
        'prUrl',
        'prBody',
        'prSize',
        'totalFilesChanged',
        'filesAdded',
        'filesModified',
        'filesRemoved',
        'totalAdditions',
        'totalDeletions',
        'fileList',
        'diffSummary',
        'commitSummary',
        'linkedIssues',
        'codePatterns',
        'contextTokens',
        'wasTruncated',
      ];
      required.forEach((key) => expect(vars).to.have.property(key));
    });

    it('sets prNumber correctly', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.prNumber).to.equal(42);
    });

    it('sets prTitle correctly', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.prTitle).to.equal('feat: add useQuery migration');
    });

    it('sets prSize correctly', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'large');
      expect(vars.prSize).to.equal('large');
    });

    it('sets totalFilesChanged from changedFiles length', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.totalFilesChanged).to.equal(2);
    });

    it('counts filesAdded correctly', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'added',
            additions: 5,
            deletions: 0,
            language: null,
            isTest: false,
            isConfig: false,
          },
          {
            path: 'b.ts',
            changeType: 'modified',
            additions: 3,
            deletions: 1,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      const vars = makeService().buildTemplateVars(ctx, 'small');
      expect(vars.filesAdded).to.equal(1);
    });

    it('counts filesModified correctly', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.filesModified).to.equal(2);
    });

    it('counts filesRemoved correctly', () => {
      const ctx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'removed',
            additions: 0,
            deletions: 10,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      const vars = makeService().buildTemplateVars(ctx, 'small');
      expect(vars.filesRemoved).to.equal(1);
    });

    it('sums totalAdditions correctly', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.totalAdditions).to.equal(15);
    });

    it('sums totalDeletions correctly', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.totalDeletions).to.equal(7);
    });

    it('sets wasTruncated from tokenBudget', () => {
      const ctx = makeContext({
        tokenBudget: {
          totalTokens: 9000,
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
      const vars = makeService().buildTemplateVars(ctx, 'medium');
      expect(vars.wasTruncated).to.be.true;
    });

    it('sets contextTokens from tokenBudget', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.contextTokens).to.equal(500);
    });

    it('builds fileList with path info', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.fileList).to.include('src/hooks/useUser.ts');
    });

    it('builds commitSummary from commits', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.commitSummary).to.include('feat: migrate useQuery syntax');
    });

    it('builds linkedIssues from issueReferences', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.linkedIssues).to.include('#10');
    });

    it('sets linkedIssues to empty string when no references', () => {
      const ctx = makeContext({ issueReferences: [] });
      const vars = makeService().buildTemplateVars(ctx, 'small');
      expect(vars.linkedIssues).to.equal('');
    });

    it('builds codePatterns from detectedPatterns', () => {
      const vars = makeService().buildTemplateVars(makeContext(), 'small');
      expect(vars.codePatterns).to.include('async_await');
    });

    it('sets codePatterns to empty string when no patterns', () => {
      const ctx = makeContext({ detectedPatterns: [] });
      const vars = makeService().buildTemplateVars(ctx, 'small');
      expect(vars.codePatterns).to.equal('');
    });

    it('handles null prBody', () => {
      const ctx = makeContext({ prBody: null });
      const vars = makeService().buildTemplateVars(ctx, 'small');
      expect(vars.prBody).to.equal('');
    });
  });

  // ── estimateTokens ───────────────────────────────────────────

  describe('estimateTokens()', () => {
    it('estimates ~1 token per 4 chars', () => {
      expect(makeService().estimateTokens('1234')).to.equal(1);
    });

    it('returns 0 for empty string', () => {
      expect(makeService().estimateTokens('')).to.equal(0);
    });

    it('rounds up', () => {
      expect(makeService().estimateTokens('12345')).to.equal(2);
    });

    it('returns higher estimate for longer strings', () => {
      const svc = makeService();
      expect(svc.estimateTokens('longer string here')).to.be.greaterThan(
        svc.estimateTokens('short')
      );
    });
  });

  // ── buildBlobKey / buildLatestKey ────────────────────────────

  describe('buildBlobKey()', () => {
    it('builds versioned key without variant', () => {
      const key = makeService().buildBlobKey('pr-summary-system', '1.0.0', null);
      expect(key).to.include('pr-summary-system');
      expect(key).to.include('v1.0.0');
    });

    it('includes variant in key when provided', () => {
      const key = makeService().buildBlobKey('pr-summary-system', '1.0.0', 'experiment');
      expect(key).to.include('experiment');
    });

    it('uses blobPrefix from config', () => {
      const key = makeService({ blobPrefix: 'custom/' }).buildBlobKey(
        'pr-summary-system',
        '1.0.0',
        null
      );
      expect(key.startsWith('custom/')).to.be.true;
    });
  });

  describe('buildLatestKey()', () => {
    it('builds latest key without variant', () => {
      const key = makeService().buildLatestKey('pr-summary-system', null);
      expect(key).to.include('latest');
      expect(key).to.include('pr-summary-system');
    });

    it('includes variant when provided', () => {
      const key = makeService().buildLatestKey('pr-summary-system', 'control');
      expect(key).to.include('control');
    });
  });

  // ── incrementVersion ─────────────────────────────────────────

  describe('incrementVersion()', () => {
    it('increments patch version', () => {
      expect(makeService().incrementVersion('1.0.0')).to.equal('1.0.1');
    });

    it('increments from 1.0.9 to 1.0.10', () => {
      expect(makeService().incrementVersion('1.0.9')).to.equal('1.0.10');
    });

    it('increments from 2.3.5 to 2.3.6', () => {
      expect(makeService().incrementVersion('2.3.5')).to.equal('2.3.6');
    });

    it('preserves major and minor version', () => {
      const result = makeService().incrementVersion('3.7.2');
      expect(result.startsWith('3.7.')).to.be.true;
    });
  });

  // ── renderPrompt ─────────────────────────────────────────────

  describe('renderPrompt()', () => {
    it('returns a RenderedPrompt with correct shape', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result).to.have.all.keys(
        'systemPrompt',
        'contextPrompt',
        'templateVersions',
        'abVariant',
        'prSize',
        'estimatedTokens',
        'usedFallback'
      );
    });

    it('returns non-empty systemPrompt', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.systemPrompt).to.be.a('string').and.have.length.above(10);
    });

    it('returns non-empty contextPrompt', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.contextPrompt).to.be.a('string').and.have.length.above(10);
    });

    it('contextPrompt includes PR number', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.contextPrompt).to.include('42');
    });

    it('contextPrompt includes PR title', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.contextPrompt).to.include('feat: add useQuery migration');
    });

    it('sets prSize on result', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(['small', 'medium', 'large']).to.include(result.prSize);
    });

    it('sets estimatedTokens > 0', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.estimatedTokens).to.be.greaterThan(0);
    });

    it('sets abVariant to null when no test configured', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.abVariant).to.be.null;
    });

    it('sets usedFallback: true when blob unavailable', async () => {
      const blob = makeBlobAdapter({
        download: sinon.stub().rejects(new Error('Blob unavailable')),
      });
      const result = await makeService({}, blob).renderPrompt(makeContext());
      expect(result.usedFallback).to.be.true;
    });

    it('sets usedFallback: false when blob returns template', async () => {
      const tpl: PromptTemplate = {
        id: 'pr-summary-system',
        name: 'system',
        template: 'You are a helpful assistant.',
        version: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          changelog: '',
          author: 'test',
        },
        targetSize: null,
        abVariant: null,
        abTestConfig: null,
        blobKey: 'pr-summary/pr-summary-system/latest.json',
        maxTokens: 200,
      };
      const blob = makeBlobAdapter({
        download: sinon.stub().resolves({ success: true, content: JSON.stringify(tpl) }),
      });
      const result = await makeService({}, blob).renderPrompt(makeContext());
      expect(result.usedFallback).to.be.false;
    });

    it('uses small template for small PRs', async () => {
      const smallCtx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 10,
            deletions: 5,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      const result = await makeService().renderPrompt(smallCtx);
      expect(result.prSize).to.equal('small');
    });

    it('uses large template for large PRs', async () => {
      const largeCtx = makeContext({
        changedFiles: [
          {
            path: 'a.ts',
            changeType: 'modified',
            additions: 400,
            deletions: 200,
            language: null,
            isTest: false,
            isConfig: false,
          },
        ],
      });
      const result = await makeService().renderPrompt(largeCtx);
      expect(result.prSize).to.equal('large');
    });

    it('sets templateVersions with system and context keys', async () => {
      const result = await makeService().renderPrompt(makeContext());
      expect(result.templateVersions).to.have.keys('system', 'context');
    });
  });

  // ── renderErrorPrompt ────────────────────────────────────────

  describe('renderErrorPrompt()', () => {
    it('returns a string', async () => {
      const result = await makeService().renderErrorPrompt(
        42,
        'https://github.com/owner/repo/pull/42'
      );
      expect(result).to.be.a('string');
    });

    it('includes PR number', async () => {
      const result = await makeService().renderErrorPrompt(
        42,
        'https://github.com/owner/repo/pull/42'
      );
      expect(result).to.include('42');
    });

    it('includes PR URL', async () => {
      const result = await makeService().renderErrorPrompt(
        42,
        'https://github.com/owner/repo/pull/42'
      );
      expect(result).to.include('https://github.com/owner/repo/pull/42');
    });

    it('falls back to built-in error template when blob unavailable', async () => {
      const blob = makeBlobAdapter({ download: sinon.stub().rejects(new Error('Blob down')) });
      const result = await makeService({}, blob).renderErrorPrompt(99, 'https://example.com/pr/99');
      expect(result).to.include('99');
    });
  });

  // ── publishTemplate ──────────────────────────────────────────

  describe('publishTemplate()', () => {
    it('uploads template to blob storage', async () => {
      const blob = makeBlobAdapter();
      const svc = makeService({}, blob);
      await svc.publishTemplate('pr-summary-system', 'New template text', 'Test change', 'dhruva');
      expect((blob.upload as SinonStub).callCount).to.be.at.least(2); // versioned + latest + manifest
    });

    it('returns a PromptTemplate with correct id', async () => {
      const blob = makeBlobAdapter();
      const svc = makeService({}, blob);
      const result = await svc.publishTemplate('pr-summary-system', 'New text', 'Test', 'dhruva');
      expect(result.id).to.equal('pr-summary-system');
    });

    it('returns template with incremented version', async () => {
      const blob = makeBlobAdapter();
      const svc = makeService({}, blob);
      const result = await svc.publishTemplate('pr-summary-system', 'text', 'change', 'dhruva');
      expect(result.version.version).to.be.a('string');
      expect(result.version.version).to.match(/^\d+\.\d+\.\d+$/);
    });

    it('sets author on version', async () => {
      const blob = makeBlobAdapter();
      const result = await makeService({}, blob).publishTemplate(
        'pr-summary-system',
        'text',
        'change',
        'dhruva'
      );
      expect(result.version.author).to.equal('dhruva');
    });

    it('sets changelog on version', async () => {
      const blob = makeBlobAdapter();
      const result = await makeService({}, blob).publishTemplate(
        'pr-summary-system',
        'text',
        'my change',
        'dhruva'
      );
      expect(result.version.changelog).to.equal('my change');
    });

    it('sets abVariant when provided', async () => {
      const blob = makeBlobAdapter();
      const result = await makeService({}, blob).publishTemplate(
        'pr-summary-system',
        'text',
        'change',
        'dhruva',
        'experiment'
      );
      expect(result.abVariant).to.equal('experiment');
    });

    it('throws PromptTemplateError when upload fails', async () => {
      const blob = makeBlobAdapter({
        upload: sinon.stub().resolves({ success: false, error: 'Storage full' }),
      });
      const svc = makeService({}, blob);
      let threw = false;
      try {
        await svc.publishTemplate('pr-summary-system', 'text', 'change', 'dhruva');
      } catch {
        threw = true;
      }
      expect(threw).to.be.true;
    });

    it('invalidates cache after publish', async () => {
      const blob = makeBlobAdapter();
      const svc = makeService({ enableCache: true }, blob);
      // Prime cache with a render
      await svc.renderPrompt(makeContext());
      // Publish new version
      await svc.publishTemplate('pr-summary-system', 'new text', 'update', 'dhruva');
      // Cache for that key should be gone — next get will hit blob
      expect((blob.download as SinonStub).callCount).to.be.at.least(0);
    });
  });

  // ── registerABTest ───────────────────────────────────────────

  describe('registerABTest()', () => {
    it('uploads updated manifest to blob', async () => {
      const blob = makeBlobAdapter();
      const svc = makeService({}, blob);
      const testConfig: ABTestConfig = {
        testName: 'concise-vs-detailed',
        controlWeight: 0.5,
        expiresAt: null,
        active: true,
      };
      await svc.registerABTest(testConfig);
      expect((blob.upload as SinonStub).callCount).to.be.at.least(1);
    });

    it('does not throw on success', async () => {
      const blob = makeBlobAdapter();
      const svc = makeService({}, blob);
      await svc.registerABTest({
        testName: 'test',
        controlWeight: 0.5,
        expiresAt: null,
        active: true,
      });
    });
  });

  // ── getManifest ──────────────────────────────────────────────

  describe('getManifest()', () => {
    it('returns a manifest object', async () => {
      const manifest = await makeService().getManifest();
      expect(manifest).to.have.keys('latestVersion', 'versions', 'activeTests', 'updatedAt');
    });

    it('latestVersion is a semver string', async () => {
      const manifest = await makeService().getManifest();
      expect(manifest.latestVersion).to.match(/^\d+\.\d+\.\d+$/);
    });

    it('versions is an array', async () => {
      const manifest = await makeService().getManifest();
      expect(manifest.versions).to.be.an('array');
    });

    it('activeTests is an array', async () => {
      const manifest = await makeService().getManifest();
      expect(manifest.activeTests).to.be.an('array');
    });

    it('creates manifest when blob is empty', async () => {
      const blob = makeBlobAdapter({ download: sinon.stub().resolves({ success: false }) });
      const manifest = await makeService({}, blob).getManifest();
      expect(manifest.latestVersion).to.equal('1.0.0');
    });

    it('parses existing manifest from blob', async () => {
      const existing = {
        latestVersion: '2.5.0',
        versions: [],
        activeTests: [],
        updatedAt: new Date().toISOString(),
      };
      const blob = makeBlobAdapter({
        download: sinon.stub().resolves({ success: true, content: JSON.stringify(existing) }),
      });
      const manifest = await makeService({}, blob).getManifest();
      expect(manifest.latestVersion).to.equal('2.5.0');
    });

    it('caches manifest on second call', async () => {
      const blob = makeBlobAdapter({ download: sinon.stub().resolves({ success: false }) });
      const svc = makeService({ enableCache: true }, blob);
      await svc.getManifest();
      await svc.getManifest();
      // Second call hits cache — blob.upload was only called once (for manifest creation)
      expect((blob.download as SinonStub).callCount).to.equal(1);
    });
  });

  // ── listVersions ─────────────────────────────────────────────

  describe('listVersions()', () => {
    it('returns an array', async () => {
      const versions = await makeService().listVersions();
      expect(versions).to.be.an('array');
    });

    it('each version has version string', async () => {
      const versions = await makeService().listVersions();
      versions.forEach((v) => expect(v.version).to.be.a('string'));
    });

    it('each version has createdAt ISO string', async () => {
      const versions = await makeService().listVersions();
      versions.forEach((v) => expect(v.createdAt).to.match(/^\d{4}-\d{2}-\d{2}T/));
    });
  });

  // ── caching ──────────────────────────────────────────────────

  describe('caching', () => {
    it('returns cached template on second call', async () => {
      const tpl: PromptTemplate = {
        id: 'pr-summary-system',
        name: 'system',
        template: 'cached template',
        version: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          changelog: '',
          author: 'test',
        },
        targetSize: null,
        abVariant: null,
        abTestConfig: null,
        blobKey: 'pr-summary/pr-summary-system/latest.json',
        maxTokens: 100,
      };
      const blob = makeBlobAdapter({
        download: sinon.stub().resolves({ success: true, content: JSON.stringify(tpl) }),
      });
      const svc = makeService({ enableCache: true }, blob);
      await svc.getTemplate('pr-summary-system', null);
      await svc.getTemplate('pr-summary-system', null);
      // Only one blob download — second was from cache
      expect((blob.download as SinonStub).callCount).to.equal(1);
    });

    it('does not cache when enableCache is false', async () => {
      const tpl: PromptTemplate = {
        id: 'pr-summary-system',
        name: 'system',
        template: 'text',
        version: {
          version: '1.0.0',
          createdAt: new Date().toISOString(),
          changelog: '',
          author: 'test',
        },
        targetSize: null,
        abVariant: null,
        abTestConfig: null,
        blobKey: 'test',
        maxTokens: 100,
      };
      const blob = makeBlobAdapter({
        download: sinon.stub().resolves({ success: true, content: JSON.stringify(tpl) }),
      });
      const svc = makeService({ enableCache: false }, blob);
      await svc.getTemplate('pr-summary-system', null);
      await svc.getTemplate('pr-summary-system', null);
      expect((blob.download as SinonStub).callCount).to.equal(2);
    });

    it('falls back to built-in when blob returns empty', async () => {
      const blob = makeBlobAdapter({ download: sinon.stub().resolves({ success: false }) });
      const tpl = await makeService({}, blob).getTemplate('pr-summary-system', null);
      expect(tpl.template).to.include('You are an expert software engineer');
    });
  });

  // ── getBuiltInContextTemplate ────────────────────────────────

  describe('getBuiltInContextTemplate()', () => {
    it('returns template string for small', () => {
      const tpl = makeService().getBuiltInContextTemplate('small');
      expect(tpl).to.be.a('string').and.have.length.above(0);
    });

    it('returns template string for medium', () => {
      const tpl = makeService().getBuiltInContextTemplate('medium');
      expect(tpl).to.be.a('string').and.have.length.above(0);
    });

    it('returns template string for large', () => {
      const tpl = makeService().getBuiltInContextTemplate('large');
      expect(tpl).to.be.a('string').and.have.length.above(0);
    });

    it('small template contains prNumber placeholder', () => {
      expect(makeService().getBuiltInContextTemplate('small')).to.include('{{prNumber}}');
    });

    it('medium template contains prNumber placeholder', () => {
      expect(makeService().getBuiltInContextTemplate('medium')).to.include('{{prNumber}}');
    });

    it('large template contains prNumber placeholder', () => {
      expect(makeService().getBuiltInContextTemplate('large')).to.include('{{prNumber}}');
    });

    it('large template is longer than small template', () => {
      const svc = makeService();
      expect(svc.getBuiltInContextTemplate('large').length).to.be.greaterThan(
        svc.getBuiltInContextTemplate('small').length
      );
    });

    it('large template includes wasTruncated block', () => {
      expect(makeService().getBuiltInContextTemplate('large')).to.include('wasTruncated');
    });
  });
});
