import { expect } from 'chai';
import * as sinon from 'sinon';
import { RoutingAgentService } from './routing.agent.service';
import {
  RoutingAgentError,
  ClassifierAdapter,
  RoutingLoggingAdapter,
  AgentRoute,
  AGENT_ROUTES,
  ROUTE_DISPLAY_NAMES,
} from './routing.agent.types';

function makeResponse(route: AgentRoute, confidence = 0.95): string {
  return JSON.stringify({ route, confidence });
}

function makeAgent(
  classifierStub?: sinon.SinonStub,
  loggingStub?: sinon.SinonStub,
  configOverrides = {}
): RoutingAgentService {
  const classifier: ClassifierAdapter = {
    complete: classifierStub ?? sinon.stub().resolves(makeResponse('version-guard')),
  };
  const logging = loggingStub ? ({ log: loggingStub } as RoutingLoggingAdapter) : undefined;
  return new RoutingAgentService(
    { enableConsoleLogging: false, ...configOverrides },
    classifier,
    logging
  );
}

describe('RoutingAgentService — constructor', () => {
  it('creates an instance with default config', () => {
    expect(makeAgent()).to.be.instanceOf(RoutingAgentService);
  });

  it('accepts custom deployment', () => {
    expect(() => makeAgent(undefined, undefined, { deployment: 'gpt-4o-mini' })).to.not.throw();
  });

  it('accepts custom confidenceThreshold', () => {
    expect(() => makeAgent(undefined, undefined, { confidenceThreshold: 0.8 })).to.not.throw();
  });

  it('accepts enableLogging: false', () => {
    expect(() => makeAgent(undefined, undefined, { enableLogging: false })).to.not.throw();
  });

  it('accepts custom maxOutputTokens', () => {
    expect(() => makeAgent(undefined, undefined, { maxOutputTokens: 100 })).to.not.throw();
  });
});

describe('RoutingAgentService — route() input validation', () => {
  it('throws INVALID_INPUT for null request', async () => {
    const agent = makeAgent();
    try {
      await agent.route(null as never);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RoutingAgentError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for empty input string', async () => {
    const agent = makeAgent();
    try {
      await agent.route({ input: '' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RoutingAgentError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT for whitespace-only input', async () => {
    const agent = makeAgent();
    try {
      await agent.route({ input: '   ' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RoutingAgentError).code).to.equal('INVALID_INPUT');
    }
  });

  it('throws INVALID_INPUT when input is not a string', async () => {
    const agent = makeAgent();
    try {
      await agent.route({ input: 42 as never });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RoutingAgentError).code).to.equal('INVALID_INPUT');
    }
  });
});

describe('RoutingAgentService — route() result shape', () => {
  it('returns RoutingResponse with correct keys', async () => {
    const agent = makeAgent();
    const result = await agent.route({ input: 'analyze this file' });
    expect(result).to.have.keys(['classification', 'displayMessage', 'routedAt']);
  });

  it('sets routedAt as ISO string', async () => {
    const agent = makeAgent();
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.routedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('classification has all required keys', async () => {
    const agent = makeAgent();
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.classification).to.have.keys([
      'route',
      'confidence',
      'rawLabel',
      'isFallback',
      'durationMs',
    ]);
  });

  it('sets durationMs >= 0', async () => {
    const agent = makeAgent();
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.classification.durationMs).to.be.greaterThanOrEqual(0);
  });

  it('sets isFallback: false for high-confidence route', async () => {
    const agent = makeAgent();
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.classification.isFallback).to.be.false;
  });

  it('sets isFallback: true for unknown route', async () => {
    const stub = sinon.stub().resolves(makeResponse('unknown'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'some random text' });
    expect(result.classification.isFallback).to.be.true;
  });

  it('sets isFallback: true when confidence below threshold', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard', 0.3));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.classification.isFallback).to.be.true;
    expect(result.classification.route).to.equal('unknown');
  });
});

describe('RoutingAgentService — version-guard intent classification', () => {
  const prompts = [
    'analyze this file',
    'check for deprecated APIs',
    'scan for version warnings',
    'are there any outdated libraries in this file',
    'DevMind: Analyze Current File',
    'check if my dependencies are up to date',
    'find deprecated usages in auth.service.ts',
    'version guard this file',
    'warn me about old API usage',
    'is useQuery deprecated in this file',
    'detect breaking changes in my dependencies',
  ];

  for (const prompt of prompts) {
    it(`classifies "${prompt}" as version-guard`, async () => {
      const stub = sinon.stub().resolves(makeResponse('version-guard'));
      const agent = makeAgent(stub);
      const result = await agent.route({ input: prompt });
      expect(result.classification.route).to.equal('version-guard');
    });
  }
});

describe('RoutingAgentService — pr-summary intent classification', () => {
  const prompts = [
    'summarize PR #76',
    'what changed in this pull request',
    'generate PR summary',
    'explain the changes in PR 42',
    'give me a summary of the latest pull request',
    'what did this PR change',
    'DevMind: Generate PR Summary',
    'summarize pull request 100',
    'write a description for PR #55',
    'what issues does PR #76 fix',
    'show me the risk level of this PR',
  ];

  for (const prompt of prompts) {
    it(`classifies "${prompt}" as pr-summary`, async () => {
      const stub = sinon.stub().resolves(makeResponse('pr-summary'));
      const agent = makeAgent(stub);
      const result = await agent.route({ input: prompt });
      expect(result.classification.route).to.equal('pr-summary');
    });
  }
});

describe('RoutingAgentService — conflict-explainer intent classification', () => {
  const prompts = [
    'explain this conflict',
    'what does this merge conflict mean',
    'help me understand this conflict in auth.ts',
    'why is there a conflict here',
    'explain conflict in services/api.ts',
    'what are both sides trying to do',
    'DevMind: Explain this conflict',
    'decode this merge conflict',
    'what was HEAD trying to do',
    'explain the merge conflict on line 42',
    'help me resolve this conflict',
  ];

  for (const prompt of prompts) {
    it(`classifies "${prompt}" as conflict-explainer`, async () => {
      const stub = sinon.stub().resolves(makeResponse('conflict-explainer'));
      const agent = makeAgent(stub);
      const result = await agent.route({ input: prompt });
      expect(result.classification.route).to.equal('conflict-explainer');
    });
  }
});

describe('RoutingAgentService — nitpick-fixer intent classification', () => {
  const prompts = [
    'fix nitpicks',
    'run linter',
    'fix code style issues',
    'run ESLint',
    'run prettier',
    'DevMind: Fix Nitpicks',
    'fix all the style warnings',
    'auto-fix formatting',
    'clean up code style',
    'fix lint errors',
    'apply prettier formatting',
  ];

  for (const prompt of prompts) {
    it(`classifies "${prompt}" as nitpick-fixer`, async () => {
      const stub = sinon.stub().resolves(makeResponse('nitpick-fixer'));
      const agent = makeAgent(stub);
      const result = await agent.route({ input: prompt });
      expect(result.classification.route).to.equal('nitpick-fixer');
    });
  }
});

describe('RoutingAgentService — fallback handling', () => {
  it('returns unknown route for unrecognised label', async () => {
    const stub = sinon.stub().resolves(makeResponse('some-nonsense' as AgentRoute));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'completely unrelated request' });
    expect(result.classification.route).to.equal('unknown');
    expect(result.classification.isFallback).to.be.true;
  });

  it('display message includes fallback help text', async () => {
    const stub = sinon.stub().resolves(makeResponse('unknown'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'do something random' });
    expect(result.displayMessage).to.include("couldn't determine");
  });

  it('fallback message lists all four agents', async () => {
    const stub = sinon.stub().resolves(makeResponse('unknown'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'random input' });
    expect(result.displayMessage).to.include('Version Guard');
    expect(result.displayMessage).to.include('PR Summary');
    expect(result.displayMessage).to.include('Conflict Explainer');
    expect(result.displayMessage).to.include('Nitpick Fixer');
  });

  it('fallback message includes example commands', async () => {
    const stub = sinon.stub().resolves(makeResponse('unknown'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'random input' });
    expect(result.displayMessage).to.include('analyze this file');
    expect(result.displayMessage).to.include('summarize PR');
  });

  it('low confidence below threshold falls back to unknown', async () => {
    const stub = sinon.stub().resolves(makeResponse('pr-summary', 0.2));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'summarize PR #42' });
    expect(result.classification.route).to.equal('unknown');
  });

  it('respects custom confidenceThreshold', async () => {
    const stub = sinon.stub().resolves(makeResponse('pr-summary', 0.5));
    const agent = makeAgent(stub, undefined, { confidenceThreshold: 0.4 });
    const result = await agent.route({ input: 'summarize PR #42' });
    expect(result.classification.route).to.equal('pr-summary');
    expect(result.classification.isFallback).to.be.false;
  });
});

describe('RoutingAgentService — display message', () => {
  it('display message includes agent name for matched route', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.displayMessage).to.include('Version Guard');
  });

  it('display message includes the user input', async () => {
    const stub = sinon.stub().resolves(makeResponse('pr-summary'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'summarize PR #76' });
    expect(result.displayMessage).to.include('summarize PR #76');
  });

  it('display message says Routing to for matched routes', async () => {
    const stub = sinon.stub().resolves(makeResponse('conflict-explainer'));
    const agent = makeAgent(stub);
    const result = await agent.route({ input: 'explain this conflict' });
    expect(result.displayMessage).to.include('Routing to');
  });
});

describe('RoutingAgentService — classifier adapter', () => {
  it('calls classifierAdapter.complete once per route()', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard'));
    const agent = makeAgent(stub);
    await agent.route({ input: 'analyze this file' });
    expect(stub.calledOnce).to.be.true;
  });

  it('passes system prompt as first argument', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard'));
    const agent = makeAgent(stub);
    await agent.route({ input: 'analyze this file' });
    expect(stub.firstCall.args[0]).to.be.a('string');
    expect(stub.firstCall.args[0]).to.include('routing agent');
  });

  it('passes user prompt containing the input', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard'));
    const agent = makeAgent(stub);
    await agent.route({ input: 'analyze auth.ts' });
    expect(stub.firstCall.args[1]).to.include('analyze auth.ts');
  });

  it('passes file context in user prompt when provided', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard'));
    const agent = makeAgent(stub);
    await agent.route({ input: 'analyze this', fileContext: 'src/auth.ts' });
    expect(stub.firstCall.args[1]).to.include('src/auth.ts');
  });

  it('passes maxOutputTokens to adapter', async () => {
    const stub = sinon.stub().resolves(makeResponse('version-guard'));
    const agent = makeAgent(stub, undefined, { maxOutputTokens: 75 });
    await agent.route({ input: 'analyze this file' });
    expect(stub.firstCall.args[2]).to.equal(75);
  });

  it('throws CLASSIFICATION_FAILED when adapter throws', async () => {
    const stub = sinon.stub().rejects(new Error('Network error'));
    const agent = makeAgent(stub);
    try {
      await agent.route({ input: 'analyze this file' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RoutingAgentError).code).to.equal('CLASSIFICATION_FAILED');
    }
  });
});

describe('RoutingAgentService — _parseClassification()', () => {
  const agent = makeAgent();

  it('parses valid JSON response', () => {
    const result = agent._parseClassification(makeResponse('version-guard'));
    expect(result.route).to.equal('version-guard');
    expect(result.confidence).to.equal(0.95);
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n' + makeResponse('pr-summary') + '\n```';
    const result = agent._parseClassification(fenced);
    expect(result.route).to.equal('pr-summary');
  });

  it('strips plain code fences', () => {
    const fenced = '```\n' + makeResponse('nitpick-fixer') + '\n```';
    const result = agent._parseClassification(fenced);
    expect(result.route).to.equal('nitpick-fixer');
  });

  it('throws PARSE_FAILED for invalid JSON', () => {
    try {
      agent._parseClassification('not json');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as RoutingAgentError).code).to.equal('PARSE_FAILED');
    }
  });

  it('defaults route to unknown when missing', () => {
    const result = agent._parseClassification(JSON.stringify({ confidence: 0.9 }));
    expect(result.route).to.equal('unknown');
  });

  it('defaults confidence to 0 when missing', () => {
    const result = agent._parseClassification(JSON.stringify({ route: 'pr-summary' }));
    expect(result.confidence).to.equal(0);
  });

  it('clamps confidence to 0 when negative', () => {
    const result = agent._parseClassification(
      JSON.stringify({ route: 'pr-summary', confidence: -0.5 })
    );
    expect(result.confidence).to.equal(0);
  });

  it('clamps confidence to 1 when above 1', () => {
    const result = agent._parseClassification(
      JSON.stringify({ route: 'pr-summary', confidence: 1.5 })
    );
    expect(result.confidence).to.equal(1);
  });

  it('preserves rawLabel even when route resolves to unknown', async () => {
    const stub = sinon.stub().resolves(JSON.stringify({ route: 'some-nonsense', confidence: 0.9 }));
    const a = makeAgent(stub);
    const result = await a.route({ input: 'some input' });
    expect(result.classification.rawLabel).to.equal('some-nonsense');
    expect(result.classification.route).to.equal('unknown');
  });
});

describe('RoutingAgentService — telemetry logging', () => {
  it('calls loggingAdapter.log on successful route', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent(undefined, logStub);
    await agent.route({ input: 'analyze this file' });
    expect(logStub.calledOnce).to.be.true;
  });

  it('log entry has type routing-decision', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent(undefined, logStub);
    await agent.route({ input: 'analyze this file' });
    expect(logStub.firstCall.args[0].type).to.equal('routing-decision');
  });

  it('log entry includes input', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent(undefined, logStub);
    await agent.route({ input: 'analyze auth.ts' });
    expect(logStub.firstCall.args[0].input).to.equal('analyze auth.ts');
  });

  it('log entry includes route', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent(undefined, logStub);
    await agent.route({ input: 'analyze this file' });
    expect(logStub.firstCall.args[0].route).to.equal('version-guard');
  });

  it('sets telemetryId on response when logging succeeds', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent(undefined, logStub);
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.telemetryId).to.be.a('string');
  });

  it('does not throw when loggingAdapter.log fails', async () => {
    const logStub = sinon.stub().rejects(new Error('DB down'));
    const agent = makeAgent(undefined, logStub);
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.classification.route).to.equal('version-guard');
  });

  it('does not call loggingAdapter when enableLogging is false', async () => {
    const logStub = sinon.stub().resolves();
    const agent = makeAgent(undefined, logStub, { enableLogging: false });
    await agent.route({ input: 'analyze this file' });
    expect(logStub.called).to.be.false;
  });

  it('does not throw when no loggingAdapter provided', async () => {
    const agent = makeAgent(undefined, undefined, { enableLogging: true });
    const result = await agent.route({ input: 'analyze this file' });
    expect(result.classification.route).to.equal('version-guard');
  });
});

describe('RoutingAgentService — buildHelpMessage()', () => {
  const agent = makeAgent();

  it('returns a non-empty string', () => {
    expect(agent.buildHelpMessage()).to.be.a('string').and.not.equal('');
  });

  it('includes DevMind Chat header', () => {
    expect(agent.buildHelpMessage()).to.include('DevMind Chat');
  });

  it('includes all four agent names', () => {
    const msg = agent.buildHelpMessage();
    expect(msg).to.include('Version Guard');
    expect(msg).to.include('PR Summary');
    expect(msg).to.include('Conflict Explainer');
    expect(msg).to.include('Nitpick Fixer');
  });

  it('includes example commands for each agent', () => {
    const msg = agent.buildHelpMessage();
    expect(msg).to.include('analyze this file');
    expect(msg).to.include('summarize PR');
    expect(msg).to.include('explain this conflict');
    expect(msg).to.include('fix nitpicks');
  });

  it('does not call the classifier adapter', () => {
    const stub = sinon.stub();
    const a = makeAgent(stub);
    a.buildHelpMessage();
    expect(stub.called).to.be.false;
  });
});

describe('Routing constants', () => {
  it('AGENT_ROUTES contains all four routes', () => {
    expect(AGENT_ROUTES).to.include('version-guard');
    expect(AGENT_ROUTES).to.include('pr-summary');
    expect(AGENT_ROUTES).to.include('conflict-explainer');
    expect(AGENT_ROUTES).to.include('nitpick-fixer');
  });

  it('AGENT_ROUTES does not contain unknown', () => {
    expect(AGENT_ROUTES).to.not.include('unknown');
  });

  it('ROUTE_DISPLAY_NAMES has entries for all routes including unknown', () => {
    expect(ROUTE_DISPLAY_NAMES['version-guard']).to.equal('Version Guard');
    expect(ROUTE_DISPLAY_NAMES['pr-summary']).to.equal('PR Summary');
    expect(ROUTE_DISPLAY_NAMES['conflict-explainer']).to.equal('Conflict Explainer');
    expect(ROUTE_DISPLAY_NAMES['nitpick-fixer']).to.equal('Nitpick Fixer');
    expect(ROUTE_DISPLAY_NAMES['unknown']).to.equal('Unknown');
  });
});
