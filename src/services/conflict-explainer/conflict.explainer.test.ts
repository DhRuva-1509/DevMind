import { expect } from 'chai';
import * as sinon from 'sinon';
import { ConflictExplainerAgent } from './conflict.explainer.agent';
import { ConflictExplainerError, OpenAIAdapter, LoggingAdapter } from './conflict.explainer.types';
import { ConflictContext } from '../conflict-parser/conflict.parser.types';

function makeContext(overrides: Partial<ConflictContext> = {}): ConflictContext {
  return {
    filePath: 'src/auth.ts',
    conflictCount: 1,
    conflicts: [
      {
        current: ['return res.status(401).json({ error: "Unauthorized" });'],
        incoming: ['throw new AuthError("Unauthorized", 401);'],
        base: null,
        currentLabel: 'HEAD',
        incomingLabel: 'feature/auth-refactor',
        baseLabel: null,
        startLine: 10,
        endLine: 14,
        format: 'standard',
      },
    ],
    contextLinesBefore: { 0: ['function handleAuth(req, res) {'] },
    contextLinesAfter: { 0: ['}'] },
    rawContent: '<<<<<<< HEAD\n...\n>>>>>>> feature/auth-refactor',
    parsedAt: new Date().toISOString(),
    validation: { isValid: true, errors: [], warnings: [] },
    ...overrides,
  };
}

const VALID_RESPONSE = JSON.stringify({
  currentIntent: 'Return HTTP 401 response directly using Express res object',
  currentKeyChanges: ['Uses res.status(401)', 'Returns JSON error object'],
  incomingIntent: 'Throw a typed AuthError for centralized error handling middleware',
  incomingKeyChanges: ['Throws AuthError class', 'Passes status code to constructor'],
  resolutionStrategy:
    'Use the incoming approach if an error handling middleware exists, otherwise keep current',
  confidenceScore: 0.9,
});

const LOW_CONFIDENCE_RESPONSE = JSON.stringify({
  currentIntent: 'Some change',
  currentKeyChanges: [],
  incomingIntent: 'Another change',
  incomingKeyChanges: [],
  resolutionStrategy: 'Pick one',
  confidenceScore: 0.5,
});

const MISSING_INTENT_RESPONSE = JSON.stringify({
  currentIntent: '',
  currentKeyChanges: [],
  incomingIntent: 'Valid intent',
  incomingKeyChanges: [],
  resolutionStrategy: 'Strategy here',
  confidenceScore: 0.9,
});

function makeAgent(
  openai: Partial<OpenAIAdapter> = {},
  logging?: Partial<LoggingAdapter>,
  configOverrides = {}
): ConflictExplainerAgent {
  const openaiAdapter: OpenAIAdapter = {
    complete: sinon.stub().resolves(VALID_RESPONSE),
    ...openai,
  };
  const loggingAdapter = logging
    ? ({ log: sinon.stub().resolves(), ...logging } as LoggingAdapter)
    : undefined;
  return new ConflictExplainerAgent(
    { enableConsoleLogging: false, ...configOverrides },
    openaiAdapter,
    loggingAdapter
  );
}

describe('ConflictExplainerAgent — constructor', () => {
  it('creates an instance with default config', () => {
    const agent = makeAgent();
    expect(agent).to.be.instanceOf(ConflictExplainerAgent);
  });

  it('accepts custom deployment', () => {
    expect(() => makeAgent({}, undefined, { deployment: 'gpt-4o-mini' })).to.not.throw();
  });

  it('accepts custom confidenceThreshold', () => {
    expect(() => makeAgent({}, undefined, { confidenceThreshold: 0.85 })).to.not.throw();
  });

  it('accepts custom maxRetries', () => {
    expect(() => makeAgent({}, undefined, { maxRetries: 1 })).to.not.throw();
  });

  it('accepts enableLogging: false', () => {
    expect(() => makeAgent({}, undefined, { enableLogging: false })).to.not.throw();
  });

  it('accepts custom maxOutputTokens', () => {
    expect(() => makeAgent({}, undefined, { maxOutputTokens: 500 })).to.not.throw();
  });
});

describe('ConflictExplainerAgent — explain() input validation', () => {
  it('throws INVALID_INPUT for null context', async () => {
    const agent = makeAgent();
    try {
      await agent.explain(null as unknown as ConflictContext);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ConflictExplainerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for missing filePath', async () => {
    const agent = makeAgent();
    try {
      await agent.explain(makeContext({ filePath: '' }));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ConflictExplainerError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws NO_CONFLICTS when conflictCount is 0', async () => {
    const agent = makeAgent();
    try {
      await agent.explain(makeContext({ conflictCount: 0, conflicts: [] }));
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ConflictExplainerError).code).to.equal('NO_CONFLICTS');
    }
  });
});

describe('ConflictExplainerAgent — explain() result shape', () => {
  it('returns ExplainerResult with correct keys', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result).to.have.keys([
      'explanations',
      'status',
      'successCount',
      'failureCount',
      'durationMs',
      'generatedAt',
    ]);
  });

  it('sets status: complete when all conflicts explained', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.status).to.equal('complete');
  });

  it('sets successCount to 1 for single conflict', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.successCount).to.equal(1);
  });

  it('sets failureCount to 0 on success', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.failureCount).to.equal(0);
  });

  it('sets durationMs >= 0', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.durationMs).to.be.greaterThanOrEqual(0);
  });

  it('sets generatedAt as ISO string', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.generatedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns one explanation per conflict', async () => {
    const context = makeContext({
      conflictCount: 2,
      conflicts: [
        ...makeContext().conflicts,
        {
          current: ['const x = 1;'],
          incoming: ['const x = 2;'],
          base: null,
          currentLabel: 'HEAD',
          incomingLabel: 'branch',
          baseLabel: null,
          startLine: 20,
          endLine: 24,
          format: 'standard',
        },
      ],
      contextLinesBefore: { 0: [], 1: [] },
      contextLinesAfter: { 0: [], 1: [] },
    });
    const agent = makeAgent();
    const result = await agent.explain(context);
    expect(result.explanations).to.have.length(2);
  });
});

describe('ConflictExplainerAgent — ConflictExplanation shape', () => {
  it('explanation has all required keys', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0]).to.have.keys([
      'conflictIndex',
      'filePath',
      'startLine',
      'endLine',
      'currentSide',
      'incomingSide',
      'resolutionStrategy',
      'confidenceScore',
      'retriesUsed',
      'autoResolved',
    ]);
  });

  it('sets conflictIndex to 0 for first conflict', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].conflictIndex).to.equal(0);
  });

  it('sets filePath from context', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].filePath).to.equal('src/auth.ts');
  });

  it('sets startLine from conflict block', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].startLine).to.equal(10);
  });

  it('sets endLine from conflict block', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].endLine).to.equal(14);
  });

  it('sets currentSide.intent from GPT-4o response', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].currentSide.intent).to.equal(
      'Return HTTP 401 response directly using Express res object'
    );
  });

  it('sets incomingSide.intent from GPT-4o response', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].incomingSide.intent).to.equal(
      'Throw a typed AuthError for centralized error handling middleware'
    );
  });

  it('sets currentSide.keyChanges array', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].currentSide.keyChanges).to.deep.equal([
      'Uses res.status(401)',
      'Returns JSON error object',
    ]);
  });

  it('sets incomingSide.keyChanges array', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].incomingSide.keyChanges).to.deep.equal([
      'Throws AuthError class',
      'Passes status code to constructor',
    ]);
  });

  it('sets resolutionStrategy from GPT-4o response', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].resolutionStrategy).to.include('middleware');
  });

  it('sets confidenceScore from GPT-4o response', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].confidenceScore).to.equal(0.9);
  });

  it('retriesUsed is 0 on first-pass success', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].retriesUsed).to.equal(0);
  });
});

describe('ConflictExplainerAgent — Human-in-the-Loop (HITL)', () => {
  it('autoResolved is always false', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].autoResolved).to.be.false;
  });

  it('autoResolved is false even after retries', async () => {
    const stub = sinon.stub();
    stub.onFirstCall().resolves(LOW_CONFIDENCE_RESPONSE);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 2 });
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].autoResolved).to.be.false;
  });

  it('autoResolved is false on best-effort result after reflection exhausted', async () => {
    const stub = sinon.stub().resolves(LOW_CONFIDENCE_RESPONSE);
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 1 });
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].autoResolved).to.be.false;
  });

  it('autoResolved is typed as literal false (not boolean)', async () => {
    const agent = makeAgent();
    const result = await agent.explain(makeContext());
    // TypeScript type ensures this — value check confirms runtime behaviour
    const val: false = result.explanations[0].autoResolved;
    expect(val).to.equal(false);
  });
});

describe('ConflictExplainerAgent — Reflection pattern', () => {
  it('re-prompts when confidence is below threshold', async () => {
    const stub = sinon.stub();
    stub.onFirstCall().resolves(LOW_CONFIDENCE_RESPONSE);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    const result = await agent.explain(makeContext());
    expect(stub.callCount).to.equal(2);
    expect(result.explanations[0].retriesUsed).to.equal(1);
  });

  it('re-prompts when currentIntent is empty', async () => {
    const stub = sinon.stub();
    stub.onFirstCall().resolves(MISSING_INTENT_RESPONSE);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    expect(stub.callCount).to.equal(2);
  });

  it('re-prompts when incomingIntent is empty', async () => {
    const missingIncoming = JSON.stringify({
      currentIntent: 'Valid',
      currentKeyChanges: [],
      incomingIntent: '',
      incomingKeyChanges: [],
      resolutionStrategy: 'Strategy',
      confidenceScore: 0.9,
    });
    const stub = sinon.stub();
    stub.onFirstCall().resolves(missingIncoming);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    expect(stub.callCount).to.equal(2);
  });

  it('re-prompts when resolutionStrategy is empty', async () => {
    const missingStrategy = JSON.stringify({
      currentIntent: 'Valid',
      currentKeyChanges: [],
      incomingIntent: 'Valid',
      incomingKeyChanges: [],
      resolutionStrategy: '',
      confidenceScore: 0.9,
    });
    const stub = sinon.stub();
    stub.onFirstCall().resolves(missingStrategy);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    expect(stub.callCount).to.equal(2);
  });

  it('returns best-effort result when reflection exhausted after maxRetries', async () => {
    const stub = sinon.stub().resolves(LOW_CONFIDENCE_RESPONSE);
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 2 });
    const result = await agent.explain(makeContext());
    // 1 initial + 2 retries = 3 calls
    expect(stub.callCount).to.equal(3);
    expect(result.explanations[0].retriesUsed).to.equal(2);
    expect(result.explanations[0].confidenceScore).to.equal(0.5);
  });

  it('accepts explanation on second attempt', async () => {
    const stub = sinon.stub();
    stub.onFirstCall().resolves(LOW_CONFIDENCE_RESPONSE);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    const result = await agent.explain(makeContext());
    expect(result.explanations[0].confidenceScore).to.equal(0.9);
    expect(result.status).to.equal('complete');
  });

  it('does not retry when first attempt passes threshold', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    expect(stub.callCount).to.equal(1);
  });

  it('passes rejection reason in retry prompt', async () => {
    const stub = sinon.stub();
    stub.onFirstCall().resolves(LOW_CONFIDENCE_RESPONSE);
    stub.onSecondCall().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const retryUserPrompt = stub.secondCall.args[1] as string;
    expect(retryUserPrompt).to.include('PREVIOUS ATTEMPT WAS REJECTED');
  });

  it('respects custom confidenceThreshold', async () => {
    // With threshold 0.4, the low-confidence response (0.5) should pass
    const stub = sinon.stub().resolves(LOW_CONFIDENCE_RESPONSE);
    const agent = makeAgent({ complete: stub }, undefined, { confidenceThreshold: 0.4 });
    const result = await agent.explain(makeContext());
    expect(stub.callCount).to.equal(1);
    expect(result.explanations[0].confidenceScore).to.equal(0.5);
  });

  it('respects maxRetries: 1 — only 2 total calls', async () => {
    const stub = sinon.stub().resolves(LOW_CONFIDENCE_RESPONSE);
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 1 });
    await agent.explain(makeContext());
    expect(stub.callCount).to.equal(2);
  });
});

describe('ConflictExplainerAgent — OpenAI adapter', () => {
  it('calls openaiAdapter.complete with system and user prompts', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    expect(stub.calledOnce).to.be.true;
    expect(stub.firstCall.args[0]).to.be.a('string'); // system prompt
    expect(stub.firstCall.args[1]).to.be.a('string'); // user prompt
  });

  it('system prompt instructs not to auto-resolve', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const systemPrompt = stub.firstCall.args[0] as string;
    expect(systemPrompt).to.include('Do NOT resolve the conflict yourself');
  });

  it('user prompt includes file path', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('src/auth.ts');
  });

  it('user prompt includes current block content', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('res.status(401)');
  });

  it('user prompt includes incoming block content', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('AuthError');
  });

  it('user prompt includes context before', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('handleAuth');
  });

  it('user prompt includes context after', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('}');
  });

  it('user prompt includes conflict line range', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    await agent.explain(makeContext());
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('10');
    expect(userPrompt).to.include('14');
  });

  it('passes maxOutputTokens to adapter', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub }, undefined, { maxOutputTokens: 500 });
    await agent.explain(makeContext());
    expect(stub.firstCall.args[2]).to.equal(500);
  });

  it('user prompt includes base block for diff3 format', async () => {
    const stub = sinon.stub().resolves(VALID_RESPONSE);
    const agent = makeAgent({ complete: stub });
    const context = makeContext();
    context.conflicts[0].base = ['original base line'];
    context.conflicts[0].format = 'diff3';
    await agent.explain(context);
    const userPrompt = stub.firstCall.args[1] as string;
    expect(userPrompt).to.include('original base line');
  });
});

describe('ConflictExplainerAgent — _parseResponse()', () => {
  const agent = makeAgent();

  it('parses valid JSON response', () => {
    const result = agent._parseResponse(VALID_RESPONSE);
    expect(result.currentIntent).to.include('HTTP 401');
    expect(result.confidenceScore).to.equal(0.9);
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n' + VALID_RESPONSE + '\n```';
    const result = agent._parseResponse(fenced);
    expect(result.currentIntent).to.be.a('string');
  });

  it('strips plain code fences', () => {
    const fenced = '```\n' + VALID_RESPONSE + '\n```';
    const result = agent._parseResponse(fenced);
    expect(result.currentIntent).to.be.a('string');
  });

  it('throws PARSE_FAILED for invalid JSON', () => {
    try {
      agent._parseResponse('not json at all');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as ConflictExplainerError).code).to.equal('PARSE_FAILED');
    }
  });

  it('defaults confidenceScore to 0 when missing', () => {
    const noScore = JSON.stringify({
      currentIntent: 'A',
      currentKeyChanges: [],
      incomingIntent: 'B',
      incomingKeyChanges: [],
      resolutionStrategy: 'C',
    });
    const result = agent._parseResponse(noScore);
    expect(result.confidenceScore).to.equal(0);
  });

  it('defaults currentKeyChanges to [] when not an array', () => {
    const noKeys = JSON.stringify({
      currentIntent: 'A',
      currentKeyChanges: null,
      incomingIntent: 'B',
      incomingKeyChanges: [],
      resolutionStrategy: 'C',
      confidenceScore: 0.8,
    });
    const result = agent._parseResponse(noKeys);
    expect(result.currentKeyChanges).to.deep.equal([]);
  });

  it('defaults missing fields to empty strings', () => {
    const minimal = JSON.stringify({ confidenceScore: 0.8 });
    const result = agent._parseResponse(minimal);
    expect(result.currentIntent).to.equal('');
    expect(result.incomingIntent).to.equal('');
    expect(result.resolutionStrategy).to.equal('');
  });
});

describe('ConflictExplainerAgent — logging', () => {
  it('calls loggingAdapter.log on success', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub });
    await agent.explain(makeContext());
    expect(logStub.calledOnce).to.be.true;
  });

  it('log entry has correct type', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub });
    await agent.explain(makeContext());
    const entry = logStub.firstCall.args[0];
    expect(entry.type).to.equal('conflict-explanation');
  });

  it('log entry includes filePath', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub });
    await agent.explain(makeContext());
    expect(logStub.firstCall.args[0].filePath).to.equal('src/auth.ts');
  });

  it('log entry includes conflictCount', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub });
    await agent.explain(makeContext());
    expect(logStub.firstCall.args[0].conflictCount).to.equal(1);
  });

  it('log entry includes successCount', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub });
    await agent.explain(makeContext());
    expect(logStub.firstCall.args[0].successCount).to.equal(1);
  });

  it('sets telemetryId on result when logging succeeds', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub });
    const result = await agent.explain(makeContext());
    expect(result.telemetryId).to.be.a('string');
  });

  it('does not throw when loggingAdapter.log fails', async () => {
    const logStub = sinon.stub().rejects(new Error('DB down'));
    const agent = makeAgent({}, { log: logStub });
    const result = await agent.explain(makeContext());
    expect(result.status).to.equal('complete');
  });

  it('does not call loggingAdapter when enableLogging is false', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent({}, { log: logStub }, { enableLogging: false });
    await agent.explain(makeContext());
    expect(logStub.called).to.be.false;
  });

  it('does not call loggingAdapter when none provided', async () => {
    const agent = makeAgent({}, undefined, { enableLogging: true });
    // No adapter — should not throw
    const result = await agent.explain(makeContext());
    expect(result.status).to.equal('complete');
  });
});

describe('ConflictExplainerAgent — status handling', () => {
  it('status is partial when some conflicts fail', async () => {
    const stub = sinon.stub();
    stub.onFirstCall().resolves(VALID_RESPONSE);
    stub.onSecondCall().rejects(new Error('LLM error'));
    const context = makeContext({
      conflictCount: 2,
      conflicts: [
        ...makeContext().conflicts,
        {
          current: ['x'],
          incoming: ['y'],
          base: null,
          currentLabel: 'HEAD',
          incomingLabel: 'branch',
          baseLabel: null,
          startLine: 20,
          endLine: 24,
          format: 'standard',
        },
      ],
      contextLinesBefore: { 0: [], 1: [] },
      contextLinesAfter: { 0: [], 1: [] },
    });
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 0 });
    const result = await agent.explain(context);
    expect(result.status).to.equal('partial');
    expect(result.successCount).to.equal(1);
    expect(result.failureCount).to.equal(1);
  });

  it('status is failed when all conflicts fail', async () => {
    const stub = sinon.stub().rejects(new Error('LLM unavailable'));
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 0 });
    const result = await agent.explain(makeContext());
    expect(result.status).to.equal('failed');
    expect(result.successCount).to.equal(0);
    expect(result.failureCount).to.equal(1);
  });

  it('does not throw when all conflicts fail — returns failed result', async () => {
    const stub = sinon.stub().rejects(new Error('LLM unavailable'));
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 0 });
    const result = await agent.explain(makeContext());
    expect(result).to.be.an('object');
    expect(result.status).to.equal('failed');
  });

  it('explanations array is empty when all conflicts fail', async () => {
    const stub = sinon.stub().rejects(new Error('LLM unavailable'));
    const agent = makeAgent({ complete: stub }, undefined, { maxRetries: 0 });
    const result = await agent.explain(makeContext());
    expect(result.explanations).to.deep.equal([]);
  });
});
