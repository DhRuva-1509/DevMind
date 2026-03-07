import { expect } from 'chai';
import { FoundryMCPClient } from './foundry.service';
import { FoundryErrorCode, ModelCatalog, EvaluatorPresets } from './foundry.types';

describe('FoundryMCPClient', () => {
  let foundryClient: FoundryMCPClient;

  beforeEach(() => {
    foundryClient = new FoundryMCPClient({
      endpoint: '',
      subscriptionId: '',
      resourceGroup: '',
      projectName: 'test-project',
      enableLogging: true,
    });
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const client = new FoundryMCPClient();
      expect(client).to.be.instanceOf(FoundryMCPClient);
    });

    it('should create instance with custom config', () => {
      const client = new FoundryMCPClient({
        endpoint: 'https://test.api.azureml.ms',
        subscriptionId: 'test-sub',
        resourceGroup: 'test-rg',
        projectName: 'test-project',
        enableLogging: false,
      });
      expect(client).to.be.instanceOf(FoundryMCPClient);
    });

    it('should not be initialized without endpoint', () => {
      const client = new FoundryMCPClient({ endpoint: '' });
      expect(client.isInitialized).to.be.false;
    });

    it('should use default project name when not provided', () => {
      const client = new FoundryMCPClient({ endpoint: '' });
      const status = client.getStatus();
      expect(status.projectName).to.equal('');
    });

    it('should use custom project name when provided', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        projectName: 'my-project',
      });
      const status = client.getStatus();
      expect(status.projectName).to.equal('my-project');
    });

    it('should accept request timeout config', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        requestTimeoutMs: 60000,
      });
      expect(client).to.be.instanceOf(FoundryMCPClient);
    });

    it('should accept retry config', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        maxRetryAttempts: 5,
        retryDelayMs: 2000,
      });
      expect(client).to.be.instanceOf(FoundryMCPClient);
    });
  });

  describe('getStatus', () => {
    it('should return service status object', () => {
      const status = foundryClient.getStatus();
      expect(status).to.have.property('isInitialized');
      expect(status).to.have.property('endpoint');
      expect(status).to.have.property('projectName');
      expect(status).to.have.property('subscriptionId');
      expect(status).to.have.property('resourceGroup');
      expect(status).to.have.property('enableLogging');
    });

    it('should show correct project name', () => {
      const status = foundryClient.getStatus();
      expect(status.projectName).to.equal('test-project');
    });

    it('should show logging enabled', () => {
      const status = foundryClient.getStatus();
      expect(status.enableLogging).to.be.true;
    });

    it('should show not initialized when no endpoint', () => {
      const status = foundryClient.getStatus();
      expect(status.isInitialized).to.be.false;
    });

    it('should allow disabling logging', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        enableLogging: false,
      });
      const status = client.getStatus();
      expect(status.enableLogging).to.be.false;
    });
  });

  describe('listModels', () => {
    it('should return error when client not initialized', async () => {
      const result = await foundryClient.listModels();
      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept publisher filter', async () => {
      const result = await foundryClient.listModels({ publisher: 'OpenAI' });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept modelType filter', async () => {
      const result = await foundryClient.listModels({ modelType: 'chat' });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept pagination options', async () => {
      const result = await foundryClient.listModels({
        pageSize: 10,
        pageToken: 'token123',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('getModel', () => {
    it('should return error for empty model ID', async () => {
      const result = await foundryClient.getModel('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.getModel('gpt-4o');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('searchModels', () => {
    it('should return error for empty query', async () => {
      const result = await foundryClient.searchModels('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.searchModels('gpt');
      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept search options', async () => {
      const result = await foundryClient.searchModels('llama', {
        publisher: 'Meta',
        modelType: 'chat',
        limit: 5,
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('createDeployment', () => {
    it('should return error for missing model ID', async () => {
      const result = await foundryClient.createDeployment({
        modelId: '',
        deploymentName: 'test-deployment',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for missing deployment name', async () => {
      const result = await foundryClient.createDeployment({
        modelId: 'gpt-4o',
        deploymentName: '',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.createDeployment({
        modelId: 'gpt-4o',
        deploymentName: 'test-deployment',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept deployment with SKU', async () => {
      const result = await foundryClient.createDeployment({
        modelId: 'gpt-4o',
        deploymentName: 'test-deployment',
        sku: { name: 'Standard', tier: 'Standard', capacity: 1 },
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept deployment with scale settings', async () => {
      const result = await foundryClient.createDeployment({
        modelId: 'gpt-4o',
        deploymentName: 'test-deployment',
        scaleSettings: { scaleType: 'Standard', capacity: 1 },
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('getDeployment', () => {
    it('should return error for empty deployment name', async () => {
      const result = await foundryClient.getDeployment('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.getDeployment('test-deployment');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('listDeployments', () => {
    it('should return error when client not initialized', async () => {
      const result = await foundryClient.listDeployments();
      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept status filter', async () => {
      const result = await foundryClient.listDeployments({ status: 'deployed' });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept pagination options', async () => {
      const result = await foundryClient.listDeployments({
        pageSize: 10,
        pageToken: 'token123',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('updateDeployment', () => {
    it('should return error for empty deployment name', async () => {
      const result = await foundryClient.updateDeployment('', { capacity: 2 });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.updateDeployment('test-deployment', {
        capacity: 2,
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('deleteDeployment', () => {
    it('should return error for empty deployment name', async () => {
      const result = await foundryClient.deleteDeployment('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.deleteDeployment('test-deployment');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('createAgent', () => {
    it('should return error for missing name', async () => {
      const result = await foundryClient.createAgent({
        name: '',
        instructions: 'You are a helpful assistant',
        model: 'gpt-4o',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for missing instructions', async () => {
      const result = await foundryClient.createAgent({
        name: 'test-agent',
        instructions: '',
        model: 'gpt-4o',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for missing model', async () => {
      const result = await foundryClient.createAgent({
        name: 'test-agent',
        instructions: 'You are a helpful assistant',
        model: '',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.createAgent({
        name: 'test-agent',
        instructions: 'You are a helpful assistant',
        model: 'gpt-4o',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept agent with tools', async () => {
      const result = await foundryClient.createAgent({
        name: 'test-agent',
        instructions: 'You are a helpful assistant',
        model: 'gpt-4o',
        tools: [{ type: 'code_interpreter' }, { type: 'file_search' }],
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('getAgent', () => {
    it('should return error for empty agent ID', async () => {
      const result = await foundryClient.getAgent('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.getAgent('agent-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('listAgents', () => {
    it('should return error when client not initialized', async () => {
      const result = await foundryClient.listAgents();
      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept pagination options', async () => {
      const result = await foundryClient.listAgents({
        pageSize: 10,
        pageToken: 'token123',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('updateAgent', () => {
    it('should return error for empty agent ID', async () => {
      const result = await foundryClient.updateAgent('', {
        instructions: 'Updated',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.updateAgent('agent-123', {
        instructions: 'Updated instructions',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('deleteAgent', () => {
    it('should return error for empty agent ID', async () => {
      const result = await foundryClient.deleteAgent('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.deleteAgent('agent-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('createThread', () => {
    it('should return error when client not initialized', async () => {
      const result = await foundryClient.createThread();
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept metadata', async () => {
      const result = await foundryClient.createThread({ key: 'value' });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('getThread', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.getThread('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.getThread('thread-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('deleteThread', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.deleteThread('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.deleteThread('thread-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('addMessage', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.addMessage('', 'Hello');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for empty content', async () => {
      const result = await foundryClient.addMessage('thread-123', '');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.addMessage('thread-123', 'Hello, world!');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept assistant role', async () => {
      const result = await foundryClient.addMessage('thread-123', 'Hello', 'assistant');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept file IDs', async () => {
      const result = await foundryClient.addMessage('thread-123', 'Hello', 'user', [
        'file-1',
        'file-2',
      ]);
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('listMessages', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.listMessages('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.listMessages('thread-123');
      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept list options', async () => {
      const result = await foundryClient.listMessages('thread-123', {
        limit: 10,
        order: 'desc',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('runAgent', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.runAgent('', 'agent-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for empty agent ID', async () => {
      const result = await foundryClient.runAgent('thread-123', '');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.runAgent('thread-123', 'agent-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept custom instructions', async () => {
      const result = await foundryClient.runAgent(
        'thread-123',
        'agent-123',
        'Focus on technical details'
      );
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('getRunStatus', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.getRunStatus('', 'run-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for empty run ID', async () => {
      const result = await foundryClient.getRunStatus('thread-123', '');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.getRunStatus('thread-123', 'run-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('cancelRun', () => {
    it('should return error for empty thread ID', async () => {
      const result = await foundryClient.cancelRun('', 'run-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for empty run ID', async () => {
      const result = await foundryClient.cancelRun('thread-123', '');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.cancelRun('thread-123', 'run-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('createEvaluation', () => {
    it('should return error for missing name', async () => {
      const result = await foundryClient.createEvaluation({
        name: '',
        evaluators: [{ type: 'relevance' }],
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error for empty evaluators', async () => {
      const result = await foundryClient.createEvaluation({
        name: 'test-eval',
        evaluators: [],
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.createEvaluation({
        name: 'test-eval',
        evaluators: [{ type: 'relevance' }],
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept evaluation with dataset', async () => {
      const result = await foundryClient.createEvaluation({
        name: 'test-eval',
        evaluators: [{ type: 'relevance' }],
        datasetId: 'dataset-123',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept evaluation with target', async () => {
      const result = await foundryClient.createEvaluation({
        name: 'test-eval',
        evaluators: [{ type: 'relevance' }],
        target: { deploymentName: 'gpt-4o-deployment' },
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('getEvaluation', () => {
    it('should return error for empty evaluation ID', async () => {
      const result = await foundryClient.getEvaluation('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.getEvaluation('eval-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('listEvaluations', () => {
    it('should return error when client not initialized', async () => {
      const result = await foundryClient.listEvaluations();
      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept status filter', async () => {
      const result = await foundryClient.listEvaluations({
        status: 'completed',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept pagination options', async () => {
      const result = await foundryClient.listEvaluations({
        pageSize: 10,
        pageToken: 'token123',
      });
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('cancelEvaluation', () => {
    it('should return error for empty evaluation ID', async () => {
      const result = await foundryClient.cancelEvaluation('');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.INVALID_INPUT);
    });

    it('should return error when client not initialized', async () => {
      const result = await foundryClient.cancelEvaluation('eval-123');
      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(FoundryErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('checkHealth', () => {
    it('should return unhealthy when client not initialized', async () => {
      const health = await foundryClient.checkHealth();
      expect(health.status).to.equal('unhealthy');
      expect(health).to.have.property('lastChecked');
      expect(health).to.have.property('endpoint');
      expect(health.error).to.equal('Foundry client not initialized');
    });

    it('should include services array', async () => {
      const health = await foundryClient.checkHealth();
      expect(health.services).to.be.an('array');
    });

    it('should set lastHealthCheck after checkHealth', async () => {
      await foundryClient.checkHealth();
      const lastHealth = foundryClient.getLastHealthCheck();
      expect(lastHealth).to.not.be.null;
    });
  });

  describe('getLastHealthCheck', () => {
    it('should return null initially', () => {
      const lastHealth = foundryClient.getLastHealthCheck();
      expect(lastHealth).to.be.null;
    });

    it('should return last health check after checkHealth', async () => {
      await foundryClient.checkHealth();
      const lastHealth = foundryClient.getLastHealthCheck();
      expect(lastHealth).to.not.be.null;
      expect(lastHealth).to.have.property('status');
    });

    it('should have status property', async () => {
      await foundryClient.checkHealth();
      const lastHealth = foundryClient.getLastHealthCheck();
      expect(lastHealth?.status).to.equal('unhealthy');
    });

    it('should have lastChecked property', async () => {
      await foundryClient.checkHealth();
      const lastHealth = foundryClient.getLastHealthCheck();
      expect(lastHealth?.lastChecked).to.be.instanceOf(Date);
    });
  });

  describe('ModelCatalog', () => {
    it('should have GPT_4O', () => {
      expect(ModelCatalog.GPT_4O).to.exist;
      expect(ModelCatalog.GPT_4O.id).to.equal('gpt-4o');
      expect(ModelCatalog.GPT_4O.publisher).to.equal('OpenAI');
    });

    it('should have GPT_4O_MINI', () => {
      expect(ModelCatalog.GPT_4O_MINI).to.exist;
      expect(ModelCatalog.GPT_4O_MINI.id).to.equal('gpt-4o-mini');
    });

    it('should have GPT_4_TURBO', () => {
      expect(ModelCatalog.GPT_4_TURBO).to.exist;
      expect(ModelCatalog.GPT_4_TURBO.id).to.equal('gpt-4-turbo');
    });

    it('should have GPT_35_TURBO', () => {
      expect(ModelCatalog.GPT_35_TURBO).to.exist;
      expect(ModelCatalog.GPT_35_TURBO.id).to.equal('gpt-35-turbo');
    });

    it('should have TEXT_EMBEDDING_3_LARGE', () => {
      expect(ModelCatalog.TEXT_EMBEDDING_3_LARGE).to.exist;
      expect(ModelCatalog.TEXT_EMBEDDING_3_LARGE.id).to.equal('text-embedding-3-large');
      expect(ModelCatalog.TEXT_EMBEDDING_3_LARGE.modelType).to.equal('embedding');
    });

    it('should have TEXT_EMBEDDING_3_SMALL', () => {
      expect(ModelCatalog.TEXT_EMBEDDING_3_SMALL).to.exist;
      expect(ModelCatalog.TEXT_EMBEDDING_3_SMALL.id).to.equal('text-embedding-3-small');
    });

    it('should have LLAMA_3_70B', () => {
      expect(ModelCatalog.LLAMA_3_70B).to.exist;
      expect(ModelCatalog.LLAMA_3_70B.publisher).to.equal('Meta');
    });

    it('should have MISTRAL_LARGE', () => {
      expect(ModelCatalog.MISTRAL_LARGE).to.exist;
      expect(ModelCatalog.MISTRAL_LARGE.publisher).to.equal('Mistral AI');
    });

    it('should have COHERE_COMMAND_R', () => {
      expect(ModelCatalog.COHERE_COMMAND_R).to.exist;
      expect(ModelCatalog.COHERE_COMMAND_R.publisher).to.equal('Cohere');
    });

    it('should have PHI_3_MEDIUM', () => {
      expect(ModelCatalog.PHI_3_MEDIUM).to.exist;
      expect(ModelCatalog.PHI_3_MEDIUM.publisher).to.equal('Microsoft');
    });
  });

  describe('EvaluatorPresets', () => {
    it('should have RAG_QUALITY preset', () => {
      expect(EvaluatorPresets.RAG_QUALITY).to.exist;
      expect(EvaluatorPresets.RAG_QUALITY.evaluators).to.be.an('array');
      expect(EvaluatorPresets.RAG_QUALITY.evaluators.length).to.equal(3);
    });

    it('should have CHAT_QUALITY preset', () => {
      expect(EvaluatorPresets.CHAT_QUALITY).to.exist;
      expect(EvaluatorPresets.CHAT_QUALITY.evaluators).to.be.an('array');
    });

    it('should have SUMMARIZATION preset', () => {
      expect(EvaluatorPresets.SUMMARIZATION).to.exist;
      expect(EvaluatorPresets.SUMMARIZATION.evaluators).to.be.an('array');
    });

    it('should have SIMILARITY preset', () => {
      expect(EvaluatorPresets.SIMILARITY).to.exist;
      expect(EvaluatorPresets.SIMILARITY.evaluators).to.be.an('array');
    });

    it('RAG_QUALITY should include relevance evaluator', () => {
      const relevance = EvaluatorPresets.RAG_QUALITY.evaluators.find((e) => e.type === 'relevance');
      expect(relevance).to.exist;
      expect(relevance?.threshold).to.equal(0.7);
    });

    it('RAG_QUALITY should include groundedness evaluator', () => {
      const groundedness = EvaluatorPresets.RAG_QUALITY.evaluators.find(
        (e) => e.type === 'groundedness'
      );
      expect(groundedness).to.exist;
      expect(groundedness?.threshold).to.equal(0.8);
    });

    it('RAG_QUALITY should include coherence evaluator', () => {
      const coherence = EvaluatorPresets.RAG_QUALITY.evaluators.find((e) => e.type === 'coherence');
      expect(coherence).to.exist;
      expect(coherence?.threshold).to.equal(0.7);
    });
  });

  describe('FoundryErrorCode', () => {
    it('should have NOT_FOUND', () => {
      expect(FoundryErrorCode.NOT_FOUND).to.equal('NOT_FOUND');
    });

    it('should have ALREADY_EXISTS', () => {
      expect(FoundryErrorCode.ALREADY_EXISTS).to.equal('ALREADY_EXISTS');
    });

    it('should have INVALID_INPUT', () => {
      expect(FoundryErrorCode.INVALID_INPUT).to.equal('INVALID_INPUT');
    });

    it('should have AUTHENTICATION_ERROR', () => {
      expect(FoundryErrorCode.AUTHENTICATION_ERROR).to.equal('AUTHENTICATION_ERROR');
    });

    it('should have AUTHORIZATION_ERROR', () => {
      expect(FoundryErrorCode.AUTHORIZATION_ERROR).to.equal('AUTHORIZATION_ERROR');
    });

    it('should have QUOTA_EXCEEDED', () => {
      expect(FoundryErrorCode.QUOTA_EXCEEDED).to.equal('QUOTA_EXCEEDED');
    });

    it('should have RATE_LIMITED', () => {
      expect(FoundryErrorCode.RATE_LIMITED).to.equal('RATE_LIMITED');
    });

    it('should have SERVICE_UNAVAILABLE', () => {
      expect(FoundryErrorCode.SERVICE_UNAVAILABLE).to.equal('SERVICE_UNAVAILABLE');
    });

    it('should have TIMEOUT', () => {
      expect(FoundryErrorCode.TIMEOUT).to.equal('TIMEOUT');
    });

    it('should have DEPLOYMENT_FAILED', () => {
      expect(FoundryErrorCode.DEPLOYMENT_FAILED).to.equal('DEPLOYMENT_FAILED');
    });

    it('should have MODEL_NOT_SUPPORTED', () => {
      expect(FoundryErrorCode.MODEL_NOT_SUPPORTED).to.equal('MODEL_NOT_SUPPORTED');
    });

    it('should have EVALUATION_FAILED', () => {
      expect(FoundryErrorCode.EVALUATION_FAILED).to.equal('EVALUATION_FAILED');
    });

    it('should have AGENT_ERROR', () => {
      expect(FoundryErrorCode.AGENT_ERROR).to.equal('AGENT_ERROR');
    });

    it('should have NETWORK_ERROR', () => {
      expect(FoundryErrorCode.NETWORK_ERROR).to.equal('NETWORK_ERROR');
    });

    it('should have UNKNOWN_ERROR', () => {
      expect(FoundryErrorCode.UNKNOWN_ERROR).to.equal('UNKNOWN_ERROR');
    });
  });

  describe('configuration', () => {
    it('should use default endpoint from environment', () => {
      const originalEnv = process.env.AZURE_FOUNDRY_ENDPOINT;
      process.env.AZURE_FOUNDRY_ENDPOINT = '';
      const client = new FoundryMCPClient();
      const status = client.getStatus();
      expect(status.endpoint).to.equal('');
      process.env.AZURE_FOUNDRY_ENDPOINT = originalEnv;
    });

    it('should use custom endpoint when provided', () => {
      const client = new FoundryMCPClient({
        endpoint: 'https://custom.api.azureml.ms',
      });
      const status = client.getStatus();
      expect(status.endpoint).to.equal('https://custom.api.azureml.ms');
    });

    it('should allow custom subscription ID', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        subscriptionId: 'custom-sub-id',
      });
      const status = client.getStatus();
      expect(status.subscriptionId).to.equal('custom-sub-id');
    });

    it('should allow custom resource group', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        resourceGroup: 'custom-rg',
      });
      const status = client.getStatus();
      expect(status.resourceGroup).to.equal('custom-rg');
    });

    it('should allow disabling logging', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        enableLogging: false,
      });
      const status = client.getStatus();
      expect(status.enableLogging).to.be.false;
    });

    it('should allow enabling logging', () => {
      const client = new FoundryMCPClient({
        endpoint: '',
        enableLogging: true,
      });
      const status = client.getStatus();
      expect(status.enableLogging).to.be.true;
    });
  });
});
