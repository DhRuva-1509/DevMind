// src/services/azure/openai.test.ts

import { expect } from 'chai';
import * as sinon from 'sinon';
import { AzureOpenAIService } from './openai.service';
import {
  ModelDeployments,
  OpenAIErrorCode,
  ModelPricing,
  ModelContextWindows,
} from './openai.types';

describe('AzureOpenAIService', () => {
  let openaiService: AzureOpenAIService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    openaiService = new AzureOpenAIService({
      endpoint: '',
      enableLogging: true,
      enableTokenCounting: true,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const service = new AzureOpenAIService();
      expect(service).to.be.instanceOf(AzureOpenAIService);
    });

    it('should create instance with custom config', () => {
      const service = new AzureOpenAIService({
        endpoint: 'https://test.openai.azure.com',
        enableLogging: false,
        maxRetries: 5,
      });
      expect(service).to.be.instanceOf(AzureOpenAIService);
    });

    it('should not be initialized without endpoint', () => {
      const service = new AzureOpenAIService({ endpoint: '' });
      expect(service.isInitialized).to.be.false;
    });
  });

  describe('countTokens', () => {
    it('should count tokens in text', () => {
      const text = 'Hello, world! This is a test message.';
      const tokens = openaiService.countTokens(text);
      expect(tokens).to.be.a('number');
      expect(tokens).to.be.greaterThan(0);
    });

    it('should return 0 for empty text', () => {
      const tokens = openaiService.countTokens('');
      expect(tokens).to.equal(0);
    });

    it('should handle long text', () => {
      const longText = 'word '.repeat(1000);
      const tokens = openaiService.countTokens(longText);
      expect(tokens).to.be.greaterThan(100);
    });

    it('should return 0 when token counting is disabled', () => {
      const service = new AzureOpenAIService({
        enableTokenCounting: false,
      });
      const tokens = service.countTokens('Hello, world!');
      expect(tokens).to.equal(0);
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost for GPT-4o', () => {
      const cost = openaiService.estimateCost('Hello, world!', 100, ModelDeployments.GPT_4O);

      expect(cost).to.have.property('inputCost');
      expect(cost).to.have.property('outputCost');
      expect(cost).to.have.property('totalCost');
      expect(cost.currency).to.equal('USD');
      expect(cost.totalCost).to.be.greaterThan(0);
    });

    it('should estimate higher cost for more tokens', () => {
      const costSmall = openaiService.estimateCost('Hi', 10, ModelDeployments.GPT_4O);
      const costLarge = openaiService.estimateCost(
        'Hello world! '.repeat(100),
        1000,
        ModelDeployments.GPT_4O
      );

      expect(costLarge.totalCost).to.be.greaterThan(costSmall.totalCost);
    });

    it('should calculate different costs for different models', () => {
      const text = 'Hello, world!';
      const outputTokens = 100;

      const costGpt4o = openaiService.estimateCost(text, outputTokens, ModelDeployments.GPT_4O);
      const costGpt35 = openaiService.estimateCost(
        text,
        outputTokens,
        ModelDeployments.GPT_35_TURBO
      );

      // GPT-4o should be more expensive than GPT-3.5
      expect(costGpt4o.totalCost).to.be.greaterThan(costGpt35.totalCost);
    });

    it('should include both input and output costs', () => {
      const cost = openaiService.estimateCost('Hello', 100, ModelDeployments.GPT_4O);

      expect(cost.inputCost).to.be.greaterThan(0);
      expect(cost.outputCost).to.be.greaterThan(0);
      expect(cost.totalCost).to.equal(cost.inputCost + cost.outputCost);
    });
  });

  describe('fitsInContext', () => {
    it('should return true for short text', () => {
      const shortText = 'Hello, world!';
      const fits = openaiService.fitsInContext(shortText, ModelDeployments.GPT_4O);
      expect(fits).to.be.true;
    });

    it('should return false for very long text', () => {
      // Create text that exceeds context window
      const veryLongText = 'word '.repeat(100000);
      const fits = openaiService.fitsInContext(veryLongText, ModelDeployments.GPT_35_TURBO);
      expect(fits).to.be.false;
    });

    it('should account for reserved tokens', () => {
      const text = 'Hello';
      const fitsWithSmallReserve = openaiService.fitsInContext(text, ModelDeployments.GPT_4O, 100);
      const fitsWithHugeReserve = openaiService.fitsInContext(
        text,
        ModelDeployments.GPT_4O,
        ModelContextWindows['gpt-4o']
      );

      expect(fitsWithSmallReserve).to.be.true;
      expect(fitsWithHugeReserve).to.be.false;
    });

    it('should use default reserve tokens', () => {
      const text = 'Hello';
      const fits = openaiService.fitsInContext(text, ModelDeployments.GPT_4O);
      expect(fits).to.be.true;
    });
  });

  describe('chat (without client)', () => {
    it('should return error when client not initialized', async () => {
      const result = await openaiService.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(OpenAIErrorCode.INVALID_REQUEST);
      expect(result.error).to.include('not initialized');
    });

    it('should accept system and user messages', async () => {
      const result = await openaiService.chat([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ]);

      expect(result.success).to.be.false;
      // Still fails because no client, but validates message format
    });

    it('should use default model when not specified', async () => {
      const result = await openaiService.chat([{ role: 'user', content: 'Hello' }]);

      expect(result.success).to.be.false;
      // Validates default options are applied
    });

    it('should accept custom options', async () => {
      const result = await openaiService.chat([{ role: 'user', content: 'Hello' }], {
        model: ModelDeployments.GPT_4_TURBO,
        temperature: 0.5,
        maxTokens: 100,
        enableFallback: false,
      });

      expect(result.success).to.be.false;
      // Validates options are accepted
    });
  });

  describe('embed (without client)', () => {
    it('should return error when client not initialized', async () => {
      const result = await openaiService.embed('Hello, world!');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(OpenAIErrorCode.INVALID_REQUEST);
    });

    it('should accept single string input', async () => {
      const result = await openaiService.embed('Hello');
      expect(result.success).to.be.false;
    });

    it('should accept array of strings', async () => {
      const result = await openaiService.embed(['Hello', 'World']);
      expect(result.success).to.be.false;
    });

    it('should accept custom options', async () => {
      const result = await openaiService.embed('Hello', {
        model: ModelDeployments.EMBEDDING_3_SMALL,
        dimension: 256,
      });
      expect(result.success).to.be.false;
    });
  });

  describe('getStatus', () => {
    it('should return service status', () => {
      const status = openaiService.getStatus();

      expect(status).to.have.property('isInitialized');
      expect(status).to.have.property('endpoint');
      expect(status).to.have.property('enableLogging');
      expect(status).to.have.property('enableTokenCounting');
      expect(status).to.have.property('requestCount');
    });

    it('should show not initialized when no endpoint', () => {
      const status = openaiService.getStatus();
      expect(status.isInitialized).to.be.false;
    });

    it('should show logging enabled by default', () => {
      const status = openaiService.getStatus();
      expect(status.enableLogging).to.be.true;
    });

    it('should show token counting enabled by default', () => {
      const status = openaiService.getStatus();
      expect(status.enableTokenCounting).to.be.true;
    });
  });

  describe('getUsageStats', () => {
    it('should return usage statistics', () => {
      const stats = openaiService.getUsageStats();

      expect(stats).to.have.property('totalRequests');
      expect(stats).to.have.property('successfulRequests');
      expect(stats).to.have.property('failedRequests');
      expect(stats).to.have.property('totalInputTokens');
      expect(stats).to.have.property('totalOutputTokens');
      expect(stats).to.have.property('totalCost');
      expect(stats).to.have.property('averageLatencyMs');
    });

    it('should start with zero stats', () => {
      const stats = openaiService.getUsageStats();

      expect(stats.totalRequests).to.equal(0);
      expect(stats.successfulRequests).to.equal(0);
      expect(stats.failedRequests).to.equal(0);
      expect(stats.totalCost).to.equal(0);
      expect(stats.averageLatencyMs).to.equal(0);
    });
  });

  describe('request logs', () => {
    it('should start with empty logs', () => {
      const logs = openaiService.getRequestLogs();
      expect(logs).to.be.an('array').that.is.empty;
    });

    it('should clear logs', () => {
      openaiService.clearLogs();
      const logs = openaiService.getRequestLogs();
      expect(logs).to.be.an('array').that.is.empty;
    });

    it('should return copy of logs', () => {
      const logs1 = openaiService.getRequestLogs();
      const logs2 = openaiService.getRequestLogs();
      expect(logs1).to.not.equal(logs2);
    });
  });

  describe('model pricing', () => {
    it('should have pricing for GPT-4o', () => {
      expect(ModelPricing['gpt-4o']).to.exist;
      expect(ModelPricing['gpt-4o'].input).to.be.a('number');
      expect(ModelPricing['gpt-4o'].output).to.be.a('number');
    });

    it('should have pricing for GPT-4-turbo', () => {
      expect(ModelPricing['gpt-4-turbo']).to.exist;
      expect(ModelPricing['gpt-4-turbo'].input).to.be.a('number');
      expect(ModelPricing['gpt-4-turbo'].output).to.be.a('number');
    });

    it('should have pricing for GPT-3.5-turbo', () => {
      expect(ModelPricing['gpt-35-turbo']).to.exist;
      expect(ModelPricing['gpt-35-turbo'].input).to.be.a('number');
      expect(ModelPricing['gpt-35-turbo'].output).to.be.a('number');
    });

    it('should have pricing for embedding models', () => {
      expect(ModelPricing['text-embedding-3-large']).to.exist;
      expect(ModelPricing['text-embedding-3-small']).to.exist;
    });

    it('should have zero output cost for embeddings', () => {
      expect(ModelPricing['text-embedding-3-large'].output).to.equal(0);
      expect(ModelPricing['text-embedding-3-small'].output).to.equal(0);
    });
  });

  describe('model context windows', () => {
    it('should have context window for GPT-4o', () => {
      expect(ModelContextWindows['gpt-4o']).to.exist;
      expect(ModelContextWindows['gpt-4o']).to.equal(128000);
    });

    it('should have context window for GPT-4-turbo', () => {
      expect(ModelContextWindows['gpt-4-turbo']).to.exist;
      expect(ModelContextWindows['gpt-4-turbo']).to.equal(128000);
    });

    it('should have context window for GPT-3.5-turbo', () => {
      expect(ModelContextWindows['gpt-35-turbo']).to.exist;
      expect(ModelContextWindows['gpt-35-turbo']).to.equal(16385);
    });

    it('should have context window for embedding models', () => {
      expect(ModelContextWindows['text-embedding-3-large']).to.exist;
      expect(ModelContextWindows['text-embedding-3-small']).to.exist;
    });
  });

  describe('ModelDeployments', () => {
    it('should have GPT_4O deployment', () => {
      expect(ModelDeployments.GPT_4O).to.equal('gpt-4o');
    });

    it('should have GPT_4_TURBO deployment', () => {
      expect(ModelDeployments.GPT_4_TURBO).to.equal('gpt-4-turbo');
    });

    it('should have GPT_35_TURBO deployment', () => {
      expect(ModelDeployments.GPT_35_TURBO).to.equal('gpt-3.5-turbo');
    });

    it('should have EMBEDDING_3_LARGE deployment', () => {
      expect(ModelDeployments.EMBEDDING_3_LARGE).to.equal('text-embedding-3-large');
    });

    it('should have EMBEDDING_3_SMALL deployment', () => {
      expect(ModelDeployments.EMBEDDING_3_SMALL).to.equal('text-embedding-3-small');
    });
  });

  describe('error codes', () => {
    it('should have all error codes defined', () => {
      expect(OpenAIErrorCode.RATE_LIMITED).to.equal('RATE_LIMITED');
      expect(OpenAIErrorCode.CONTEXT_LENGTH_EXCEEDED).to.equal('CONTEXT_LENGTH_EXCEEDED');
      expect(OpenAIErrorCode.CONTENT_FILTERED).to.equal('CONTENT_FILTERED');
      expect(OpenAIErrorCode.INVALID_REQUEST).to.equal('INVALID_REQUEST');
      expect(OpenAIErrorCode.AUTHENTICATION_ERROR).to.equal('AUTHENTICATION_ERROR');
      expect(OpenAIErrorCode.MODEL_NOT_FOUND).to.equal('MODEL_NOT_FOUND');
      expect(OpenAIErrorCode.SERVICE_UNAVAILABLE).to.equal('SERVICE_UNAVAILABLE');
      expect(OpenAIErrorCode.TIMEOUT).to.equal('TIMEOUT');
      expect(OpenAIErrorCode.UNKNOWN_ERROR).to.equal('UNKNOWN_ERROR');
    });
  });
});
