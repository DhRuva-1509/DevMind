import { expect } from 'chai';
import * as sinon from 'sinon';
import { TribalKnowledgeAgent } from './tribal.knowledge.agent';
import {
  TribalKnowledgeAgentError,
  DEFAULT_AGENT_CONFIG,
  HIGH_SEVERITY_CATEGORIES,
  MEDIUM_SEVERITY_CATEGORIES,
  AgentTriggerContext,
  TribalSearchAdapter,
  WarningGenerationAdapter,
  TribalKnowledgeLoggingAdapter,
} from './tribal.knowledge.agent.types';
import { TribalKnowledgeSearchResult } from '../tribal-knowledge-indexer/tribal.knowledge.indexer.types';

function makeContext(overrides: Partial<AgentTriggerContext> = {}): AgentTriggerContext {
  return {
    trigger: 'pr_open',
    owner: 'owner',
    repo: 'repo',
    prNumber: 42,
    prTitle: 'feat: add auth middleware',
    changedFiles: ['src/auth.ts', 'src/middleware.ts'],
    detectedPatterns: ['async_await', 'error_handling'],
    codeSnippets: [
      {
        filePath: 'src/auth.ts',
        content:
          'async function authenticate(req, res, next) { try { ... } catch (e) { next(e); } }',
        startLine: 10,
        endLine: 20,
      },
    ],
    ...overrides,
  };
}

function makeSearchResult(
  overrides: Partial<TribalKnowledgeSearchResult['document']> = {},
  score = 0.85
): TribalKnowledgeSearchResult {
  return {
    document: {
      id: 'comment-1001',
      content: 'Make sure to handle token expiry in the auth middleware.',
      owner: 'owner',
      repo: 'repo',
      prNumber: 10,
      prTitle: 'fix: auth token refresh',
      author: 'alice',
      source: 'pr_review_comment',
      filePath: 'src/auth.ts',
      category: 'bug',
      codePatterns: ['async_await'],
      relevanceScore: 0.9,
      createdAt: new Date().toISOString(),
      indexedAt: new Date().toISOString(),
      ...overrides,
    },
    searchScore: score,
  };
}

function makeSearch(overrides: Partial<TribalSearchAdapter> = {}): TribalSearchAdapter {
  return {
    search: sinon.stub().resolves([makeSearchResult()]),
    ...overrides,
  };
}

function makeWarning(overrides: Partial<WarningGenerationAdapter> = {}): WarningGenerationAdapter {
  return {
    generate: sinon.stub().resolves('Token expiry is not handled in the current auth middleware.'),
    ...overrides,
  };
}

function makeLogging(
  overrides: Partial<TribalKnowledgeLoggingAdapter> = {}
): TribalKnowledgeLoggingAdapter {
  return {
    log: sinon.stub().resolves(),
    ...overrides,
  };
}

function makeAgent(
  searchOverrides: Partial<TribalSearchAdapter> = {},
  warningOverrides?: Partial<WarningGenerationAdapter>,
  configOverrides = {},
  logging?: TribalKnowledgeLoggingAdapter
) {
  return new TribalKnowledgeAgent(
    configOverrides,
    makeSearch(searchOverrides),
    warningOverrides ? makeWarning(warningOverrides) : undefined,
    logging
  );
}

describe('TribalKnowledgeAgent', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      expect(makeAgent()).to.be.instanceOf(TribalKnowledgeAgent);
    });

    it('accepts custom sensitivityThreshold', () => {
      expect(() => makeAgent({}, undefined, { sensitivityThreshold: 0.5 })).to.not.throw();
    });

    it('accepts custom maxWarnings', () => {
      expect(() => makeAgent({}, undefined, { maxWarnings: 3 })).to.not.throw();
    });

    it('accepts custom topK', () => {
      expect(() => makeAgent({}, undefined, { topK: 5 })).to.not.throw();
    });

    it('accepts enableLogging: false', () => {
      expect(() => makeAgent({}, undefined, { enableLogging: false })).to.not.throw();
    });

    it('accepts enableWarningGeneration: false', () => {
      expect(() => makeAgent({}, undefined, { enableWarningGeneration: false })).to.not.throw();
    });

    it('accepts custom deployment', () => {
      expect(() => makeAgent({}, undefined, { deployment: 'gpt-4o-mini' })).to.not.throw();
    });
  });

  describe('analyze() — input validation', () => {
    it('throws INVALID_INPUT for null context', async () => {
      try {
        await makeAgent().analyze(null as any);
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeAgentError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT for empty owner', async () => {
      try {
        await makeAgent().analyze(makeContext({ owner: '' }));
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeAgentError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT for empty repo', async () => {
      try {
        await makeAgent().analyze(makeContext({ repo: '' }));
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeAgentError).code).to.equal('INVALID_INPUT');
      }
    });

    it('throws INVALID_INPUT when changedFiles is not an array', async () => {
      try {
        await makeAgent().analyze(makeContext({ changedFiles: null as any }));
        expect.fail();
      } catch (e) {
        expect((e as TribalKnowledgeAgentError).code).to.equal('INVALID_INPUT');
      }
    });
  });

  describe('analyze() — result shape', () => {
    it('returns result with correct keys', async () => {
      const result = await makeAgent().analyze(makeContext());
      expect(result).to.include.keys([
        'owner',
        'repo',
        'prNumber',
        'trigger',
        'warnings',
        'status',
        'patternsSearched',
        'rawMatchesFound',
        'durationMs',
        'generatedAt',
      ]);
    });

    it('sets owner and repo on result', async () => {
      const result = await makeAgent().analyze(makeContext());
      expect(result.owner).to.equal('owner');
      expect(result.repo).to.equal('repo');
    });

    it('sets prNumber on result', async () => {
      const result = await makeAgent().analyze(makeContext({ prNumber: 42 }));
      expect(result.prNumber).to.equal(42);
    });

    it('sets prNumber to null when not provided', async () => {
      const result = await makeAgent().analyze(makeContext({ prNumber: undefined }));
      expect(result.prNumber).to.be.null;
    });

    it('sets trigger on result', async () => {
      const result = await makeAgent().analyze(makeContext({ trigger: 'file_change' }));
      expect(result.trigger).to.equal('file_change');
    });

    it('sets durationMs >= 0', async () => {
      const result = await makeAgent().analyze(makeContext());
      expect(result.durationMs).to.be.greaterThanOrEqual(0);
    });

    it('sets generatedAt as ISO string', async () => {
      const result = await makeAgent().analyze(makeContext());
      expect(result.generatedAt).to.match(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('analyze() — triggers (AC-1)', () => {
    it('accepts pr_open trigger', async () => {
      const result = await makeAgent().analyze(makeContext({ trigger: 'pr_open' }));
      expect(result.trigger).to.equal('pr_open');
    });

    it('accepts file_change trigger', async () => {
      const result = await makeAgent().analyze(makeContext({ trigger: 'file_change' }));
      expect(result.trigger).to.equal('file_change');
    });

    it('accepts manual trigger', async () => {
      const result = await makeAgent().analyze(makeContext({ trigger: 'manual' }));
      expect(result.trigger).to.equal('manual');
    });

    it('works with empty changedFiles', async () => {
      const result = await makeAgent().analyze(
        makeContext({ changedFiles: [], codeSnippets: [], detectedPatterns: ['auth'] })
      );
      expect(result).to.be.an('object');
    });
  });

  describe('analyze() — pattern extraction (AC-2)', () => {
    it('builds one search query per detected pattern', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      await agent.analyze(
        makeContext({ detectedPatterns: ['async_await', 'error_handling'], codeSnippets: [] })
      );
      expect(search.callCount).to.equal(2);
    });

    it('builds search query from code snippet content', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      await agent.analyze(
        makeContext({
          detectedPatterns: [],
          codeSnippets: [
            { filePath: 'src/auth.ts', content: 'auth logic here', startLine: 1, endLine: 5 },
          ],
        })
      );
      expect(search.calledOnce).to.be.true;
      expect(search.firstCall.args[2]).to.include('auth logic');
    });

    it('falls back to PR title when no patterns or snippets', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      await agent.analyze(
        makeContext({ detectedPatterns: [], codeSnippets: [], prTitle: 'fix: token refresh' })
      );
      expect(search.calledOnce).to.be.true;
      expect(search.firstCall.args[2]).to.equal('fix: token refresh');
    });

    it('sets patternsSearched to number of search queries made', async () => {
      const result = await makeAgent().analyze(
        makeContext({ detectedPatterns: ['async_await', 'error_handling'], codeSnippets: [] })
      );
      expect(result.patternsSearched).to.equal(2);
    });

    it('truncates snippet to 500 chars in search query', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const longContent = 'x'.repeat(600);
      await agent.analyze(
        makeContext({
          detectedPatterns: [],
          codeSnippets: [{ filePath: 'f.ts', content: longContent, startLine: 1, endLine: 10 }],
        })
      );
      expect(search.firstCall.args[2].length).to.equal(500);
    });
  });

  describe('analyze() — search (AC-3)', () => {
    it('calls searchAdapter.search with correct owner and repo', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      await agent.analyze(makeContext());
      expect(search.firstCall.args[0]).to.equal('owner');
      expect(search.firstCall.args[1]).to.equal('repo');
    });

    it('passes topK to search', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({ topK: 5 }, makeSearch({ search }), undefined);
      await agent.analyze(makeContext({ detectedPatterns: ['auth'], codeSnippets: [] }));
      expect(search.firstCall.args[3].topK).to.equal(5);
    });

    it('passes filePath to search when snippet has a file', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      await agent.analyze(
        makeContext({
          detectedPatterns: [],
          codeSnippets: [{ filePath: 'src/auth.ts', content: 'auth', startLine: 1, endLine: 5 }],
        })
      );
      expect(search.firstCall.args[3].filePath).to.equal('src/auth.ts');
    });

    it('sets rawMatchesFound to total matches returned', async () => {
      const search = sinon
        .stub()
        .resolves([makeSearchResult(), makeSearchResult({ id: 'comment-1002' })]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.rawMatchesFound).to.equal(2);
    });

    it('sets status partial when a search call fails', async () => {
      const search = sinon.stub().rejects(new Error('search down'));
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.status).to.equal('partial');
    });

    it('continues to next pattern when one search fails', async () => {
      const search = sinon.stub();
      search.onFirstCall().rejects(new Error('timeout'));
      search.onSecondCall().resolves([makeSearchResult()]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth', 'error_handling'], codeSnippets: [] })
      );
      expect(result.warnings.length).to.equal(1);
    });
  });

  describe('analyze() — warning generation (AC-4)', () => {
    it('calls warningAdapter.generate for each match above threshold', async () => {
      const generate = sinon.stub().resolves('Token expiry warning.');
      const agent = new TribalKnowledgeAgent({}, makeSearch(), makeWarning({ generate }));
      await agent.analyze(makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] }));
      expect(generate.calledOnce).to.be.true;
    });

    it('warning message is set from LLM response', async () => {
      const generate = sinon.stub().resolves('Check token expiry handling.');
      const agent = new TribalKnowledgeAgent({}, makeSearch(), makeWarning({ generate }));
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].message).to.equal('Check token expiry handling.');
    });

    it('falls back to raw comment when warning generation throws', async () => {
      const generate = sinon.stub().rejects(new Error('LLM down'));
      const agent = new TribalKnowledgeAgent({}, makeSearch(), makeWarning({ generate }));
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].message).to.equal(
        'Make sure to handle token expiry in the auth middleware.'
      );
    });

    it('does not call warningAdapter when enableWarningGeneration is false', async () => {
      const generate = sinon.stub().resolves('warning');
      const agent = new TribalKnowledgeAgent(
        { enableWarningGeneration: false },
        makeSearch(),
        makeWarning({ generate })
      );
      await agent.analyze(makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] }));
      expect(generate.called).to.be.false;
    });

    it('does not call warningAdapter when none provided', async () => {
      const agent = new TribalKnowledgeAgent({}, makeSearch());
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].message).to.equal(
        'Make sure to handle token expiry in the auth middleware.'
      );
    });

    it('system prompt instructs not to repeat past comment verbatim', async () => {
      const generate = sinon.stub().resolves('warning');
      const agent = new TribalKnowledgeAgent({}, makeSearch(), makeWarning({ generate }));
      await agent.analyze(makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] }));
      const systemPrompt = generate.firstCall.args[0] as string;
      expect(systemPrompt).to.include('Do not repeat the past comment verbatim');
    });

    it('user prompt includes past comment content', async () => {
      const generate = sinon.stub().resolves('warning');
      const agent = new TribalKnowledgeAgent({}, makeSearch(), makeWarning({ generate }));
      await agent.analyze(makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] }));
      const userPrompt = generate.firstCall.args[1] as string;
      expect(userPrompt).to.include('Make sure to handle token expiry');
    });

    it('user prompt includes PR title', async () => {
      const generate = sinon.stub().resolves('warning');
      const agent = new TribalKnowledgeAgent({}, makeSearch(), makeWarning({ generate }));
      await agent.analyze(makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] }));
      const userPrompt = generate.firstCall.args[1] as string;
      expect(userPrompt).to.include('feat: add auth middleware');
    });

    it('passes maxOutputTokens to warningAdapter', async () => {
      const generate = sinon.stub().resolves('warning');
      const agent = new TribalKnowledgeAgent(
        { maxOutputTokens: 200 },
        makeSearch(),
        makeWarning({ generate })
      );
      await agent.analyze(makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] }));
      expect(generate.firstCall.args[2]).to.equal(200);
    });
  });

  describe('analyze() — related PRs (AC-5)', () => {
    it('warning includes relatedPRs array', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].relatedPRs).to.be.an('array');
      expect(result.warnings[0].relatedPRs).to.have.length(1);
    });

    it('related PR has correct prNumber', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].relatedPRs[0].prNumber).to.equal(10);
    });

    it('related PR has correct prTitle', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].relatedPRs[0].prTitle).to.equal('fix: auth token refresh');
    });

    it('related PR has GitHub URL', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].relatedPRs[0].url).to.include('github.com/owner/repo/pull/10');
    });

    it('related PR commentExcerpt is truncated to 200 chars', async () => {
      const longComment = 'x'.repeat(300);
      const search = sinon.stub().resolves([makeSearchResult({ content: longComment })]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].relatedPRs[0].commentExcerpt.length).to.be.at.most(203);
    });

    it('buildRelatedPRUrl returns correct GitHub URL', () => {
      const url = makeAgent().buildRelatedPRUrl('owner', 'repo', 42);
      expect(url).to.equal('https://github.com/owner/repo/pull/42');
    });
  });

  describe('analyze() — sensitivity threshold (AC-6)', () => {
    it('filters out matches below threshold', async () => {
      const search = sinon.stub().resolves([makeSearchResult({}, 0.5)]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.warnings).to.have.length(0);
    });

    it('includes matches at or above threshold', async () => {
      const search = sinon.stub().resolves([makeSearchResult({}, 0.7)]);
      const agent = new TribalKnowledgeAgent(
        { sensitivityThreshold: 0.7 },
        makeSearch({ search }),
        undefined
      );
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.warnings).to.have.length(1);
    });

    it('respects custom sensitivityThreshold', async () => {
      const search = sinon.stub().resolves([makeSearchResult({}, 0.6)]);
      const agent = new TribalKnowledgeAgent(
        { sensitivityThreshold: 0.5 },
        makeSearch({ search }),
        undefined
      );
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.warnings).to.have.length(1);
    });

    it('caps warnings at maxWarnings', async () => {
      const search = sinon
        .stub()
        .resolves([
          makeSearchResult({ id: 'c1' }),
          makeSearchResult({ id: 'c2' }),
          makeSearchResult({ id: 'c3' }),
          makeSearchResult({ id: 'c4' }),
        ]);
      const agent = new TribalKnowledgeAgent({ maxWarnings: 2 }, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.warnings.length).to.be.at.most(2);
    });

    it('rawMatchesFound counts all matches regardless of threshold', async () => {
      const search = sinon.stub().resolves([makeSearchResult({}, 0.5), makeSearchResult({}, 0.3)]);
      const agent = new TribalKnowledgeAgent(
        { sensitivityThreshold: 0.7 },
        makeSearch({ search }),
        undefined
      );
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.rawMatchesFound).to.equal(2);
      expect(result.warnings).to.have.length(0);
    });
  });

  describe('analyze() — warning shape', () => {
    it('warning has all required keys', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0]).to.include.keys([
        'id',
        'filePath',
        'message',
        'severity',
        'category',
        'confidence',
        'relatedPRs',
        'sourceMatch',
      ]);
    });

    it('warning confidence matches searchScore', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].confidence).to.equal(0.85);
    });

    it('warning category matches document category', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].category).to.equal('bug');
    });

    it('warning filePath matches document filePath', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].filePath).to.equal('src/auth.ts');
    });

    it('warning id is a non-empty string', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['async_await'], codeSnippets: [] })
      );
      expect(result.warnings[0].id).to.be.a('string').and.not.empty;
    });
  });

  describe('deriveSeverity()', () => {
    it('returns high for bug category', () => {
      expect(makeAgent().deriveSeverity('bug', 0.9)).to.equal('high');
    });

    it('returns high for security category', () => {
      expect(makeAgent().deriveSeverity('security', 0.9)).to.equal('high');
    });

    it('returns medium for performance category', () => {
      expect(makeAgent().deriveSeverity('performance', 0.9)).to.equal('medium');
    });

    it('returns medium for architecture category', () => {
      expect(makeAgent().deriveSeverity('architecture', 0.9)).to.equal('medium');
    });

    it('returns medium for style with score >= 0.9', () => {
      expect(makeAgent().deriveSeverity('style', 0.95)).to.equal('medium');
    });

    it('returns low for style with score < 0.9', () => {
      expect(makeAgent().deriveSeverity('style', 0.75)).to.equal('low');
    });

    it('returns low for nitpick', () => {
      expect(makeAgent().deriveSeverity('nitpick', 0.8)).to.equal('low');
    });

    it('returns low for praise', () => {
      expect(makeAgent().deriveSeverity('praise', 0.99)).to.equal('low');
    });
  });

  describe('buildSearchQueries()', () => {
    it('returns one query per detected pattern', () => {
      const queries = makeAgent().buildSearchQueries(makeContext({ codeSnippets: [] }));
      expect(queries.length).to.equal(2); // async_await + error_handling
    });

    it('returns one query per code snippet', () => {
      const queries = makeAgent().buildSearchQueries(makeContext({ detectedPatterns: [] }));
      expect(queries.length).to.equal(1);
    });

    it('returns PR title query when no patterns or snippets', () => {
      const queries = makeAgent().buildSearchQueries(
        makeContext({ detectedPatterns: [], codeSnippets: [] })
      );
      expect(queries.length).to.equal(1);
      expect(queries[0].text).to.equal('feat: add auth middleware');
    });

    it('snippet query includes filePath', () => {
      const queries = makeAgent().buildSearchQueries(makeContext({ detectedPatterns: [] }));
      expect(queries[0].filePath).to.equal('src/auth.ts');
    });

    it('pattern query has no filePath', () => {
      const queries = makeAgent().buildSearchQueries(makeContext({ codeSnippets: [] }));
      expect(queries[0].filePath).to.be.undefined;
    });

    it('skips empty snippet content', () => {
      const queries = makeAgent().buildSearchQueries(
        makeContext({
          detectedPatterns: [],
          prTitle: undefined,
          codeSnippets: [{ filePath: 'f.ts', content: '   ', startLine: 1, endLine: 1 }],
        })
      );
      expect(queries.length).to.equal(0);
    });
  });

  describe('analyze() — status', () => {
    it('sets status: complete when matches found', async () => {
      const result = await makeAgent({}, {}).analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.status).to.equal('complete');
    });

    it('sets status: no_matches when no results above threshold', async () => {
      const search = sinon.stub().resolves([]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.status).to.equal('no_matches');
    });

    it('sets status: partial when some searches fail', async () => {
      const search = sinon.stub();
      search.onFirstCall().rejects(new Error('timeout'));
      search.onSecondCall().resolves([makeSearchResult()]);
      const agent = new TribalKnowledgeAgent({}, makeSearch({ search }), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['a', 'b'], codeSnippets: [] })
      );
      expect(result.status).to.equal('partial');
    });
  });

  describe('analyze() — logging (AC-7)', () => {
    it('calls loggingAdapter.log after analysis', async () => {
      const log = sinon.stub().resolves();
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined, makeLogging({ log }));
      await agent.analyze(makeContext({ detectedPatterns: ['auth'], codeSnippets: [] }));
      expect(log.calledOnce).to.be.true;
    });

    it('log entry has type tribal-knowledge-alert', async () => {
      const log = sinon.stub().resolves();
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined, makeLogging({ log }));
      await agent.analyze(makeContext({ detectedPatterns: ['auth'], codeSnippets: [] }));
      expect(log.firstCall.args[0].type).to.equal('tribal-knowledge-alert');
    });

    it('log entry includes owner and repo', async () => {
      const log = sinon.stub().resolves();
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined, makeLogging({ log }));
      await agent.analyze(makeContext({ detectedPatterns: ['auth'], codeSnippets: [] }));
      const entry = log.firstCall.args[0];
      expect(entry.owner).to.equal('owner');
      expect(entry.repo).to.equal('repo');
    });

    it('log entry includes warningsGenerated count', async () => {
      const log = sinon.stub().resolves();
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined, makeLogging({ log }));
      await agent.analyze(makeContext({ detectedPatterns: ['auth'], codeSnippets: [] }));
      expect(log.firstCall.args[0].warningsGenerated).to.equal(1);
    });

    it('sets telemetryId on result when logging succeeds', async () => {
      const log = sinon.stub().resolves();
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined, makeLogging({ log }));
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.telemetryId).to.be.a('string');
    });

    it('does not throw when loggingAdapter.log fails', async () => {
      const log = sinon.stub().rejects(new Error('DB down'));
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined, makeLogging({ log }));
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.warnings.length).to.equal(1);
    });

    it('does not call loggingAdapter when enableLogging is false', async () => {
      const log = sinon.stub().resolves();
      const agent = new TribalKnowledgeAgent(
        { enableLogging: false },
        makeSearch(),
        undefined,
        makeLogging({ log })
      );
      await agent.analyze(makeContext({ detectedPatterns: ['auth'], codeSnippets: [] }));
      expect(log.called).to.be.false;
    });

    it('does not call loggingAdapter when none provided', async () => {
      const agent = new TribalKnowledgeAgent({}, makeSearch(), undefined);
      const result = await agent.analyze(
        makeContext({ detectedPatterns: ['auth'], codeSnippets: [] })
      );
      expect(result.telemetryId).to.be.undefined;
    });
  });

  describe('DEFAULT_AGENT_CONFIG', () => {
    it('sensitivityThreshold is 0.7', () => {
      expect(DEFAULT_AGENT_CONFIG.sensitivityThreshold).to.equal(0.7);
    });

    it('maxWarnings is 5', () => {
      expect(DEFAULT_AGENT_CONFIG.maxWarnings).to.equal(5);
    });

    it('topK is 10', () => {
      expect(DEFAULT_AGENT_CONFIG.topK).to.equal(10);
    });

    it('enableLogging is true', () => {
      expect(DEFAULT_AGENT_CONFIG.enableLogging).to.be.true;
    });

    it('enableWarningGeneration is true', () => {
      expect(DEFAULT_AGENT_CONFIG.enableWarningGeneration).to.be.true;
    });
  });

  describe('HIGH_SEVERITY_CATEGORIES', () => {
    it('contains bug', () => {
      expect(HIGH_SEVERITY_CATEGORIES).to.include('bug');
    });
    it('contains security', () => {
      expect(HIGH_SEVERITY_CATEGORIES).to.include('security');
    });
    it('is frozen', () => {
      expect(() => (HIGH_SEVERITY_CATEGORIES as string[]).push('x')).to.throw();
    });
  });

  describe('MEDIUM_SEVERITY_CATEGORIES', () => {
    it('contains performance', () => {
      expect(MEDIUM_SEVERITY_CATEGORIES).to.include('performance');
    });
    it('contains architecture', () => {
      expect(MEDIUM_SEVERITY_CATEGORIES).to.include('architecture');
    });
    it('is frozen', () => {
      expect(() => (MEDIUM_SEVERITY_CATEGORIES as string[]).push('x')).to.throw();
    });
  });
});
