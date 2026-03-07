import { TokenCredential } from '@azure/core-auth';
import { azureAuthService } from '../auth/auth.service';
import {
  FoundryConfig,
  ModelInfo,
  DeploymentConfig,
  DeploymentInfo,
  AgentConfig,
  AgentInfo,
  AgentThread,
  AgentMessage,
  AgentRun,
  EvaluationConfig,
  EvaluationResult,
  ConnectionHealth,
  HealthStatus,
  ServiceHealth,
  FoundryOperationResult,
  FoundryListResult,
  FoundryErrorCode,
  FoundryServiceStatus,
} from './foundry.types';

export class FoundryMCPClient {
  private credential: TokenCredential | null = null;
  private config: Required<FoundryConfig>;
  private _isInitialized: boolean = false;
  private lastHealthCheck: ConnectionHealth | null = null;

  private static readonly DEFAULT_CONFIG: Required<FoundryConfig> = {
    endpoint: '',
    subscriptionId: '',
    resourceGroup: '',
    projectName: '',
    enableLogging: true,
    requestTimeoutMs: 30000,
    maxRetryAttempts: 3,
    retryDelayMs: 1000,
  };

  constructor(config: FoundryConfig = {}) {
    this.config = { ...FoundryMCPClient.DEFAULT_CONFIG, ...config };

    if (!this.config.endpoint) {
      this.config.endpoint = process.env.AZURE_FOUNDRY_ENDPOINT || '';
    }

    if (!this.config.subscriptionId) {
      this.config.subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || '';
    }

    if (!this.config.resourceGroup) {
      this.config.resourceGroup = process.env.AZURE_RESOURCE_GROUP || '';
    }

    if (!this.config.projectName) {
      this.config.projectName = process.env.AZURE_FOUNDRY_PROJECT || '';
    }

    if (this.config.endpoint) {
      this.initializeClient();
    }
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  private initializeClient(): void {
    try {
      this.credential = azureAuthService.getCredential();
      this._isInitialized = true;
    } catch {
      this._isInitialized = false;
    }
  }

  private getErrorCode(error: unknown): FoundryErrorCode {
    const err = error as Error & { statusCode?: number; code?: string };
    const statusCode = err?.statusCode;
    const code = err?.code;

    if (statusCode === 404) return FoundryErrorCode.NOT_FOUND;
    if (statusCode === 409) return FoundryErrorCode.ALREADY_EXISTS;
    if (statusCode === 400) return FoundryErrorCode.INVALID_INPUT;
    if (statusCode === 401) return FoundryErrorCode.AUTHENTICATION_ERROR;
    if (statusCode === 403) return FoundryErrorCode.AUTHORIZATION_ERROR;
    if (statusCode === 429) return FoundryErrorCode.RATE_LIMITED;
    if (statusCode === 503) return FoundryErrorCode.SERVICE_UNAVAILABLE;
    if (code === 'ETIMEDOUT') return FoundryErrorCode.TIMEOUT;
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
      return FoundryErrorCode.NETWORK_ERROR;
    }

    return FoundryErrorCode.UNKNOWN_ERROR;
  }

  private getErrorMessage(error: unknown): string {
    const err = error as Error;
    return err?.message || 'Unknown error occurred';
  }

  async listModels(
    _options: {
      publisher?: string;
      modelType?: string;
      pageSize?: number;
      pageToken?: string;
    } = {}
  ): Promise<FoundryListResult<ModelInfo>> {
    if (!this._isInitialized) {
      return {
        success: false,
        items: [],
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: true,
        items: [],
        totalCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async getModel(modelId: string): Promise<FoundryOperationResult<ModelInfo>> {
    if (!modelId) {
      return {
        success: false,
        error: 'Model ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Model '${modelId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async searchModels(
    query: string,
    _options: {
      publisher?: string;
      modelType?: string;
      limit?: number;
    } = {}
  ): Promise<FoundryListResult<ModelInfo>> {
    if (!query) {
      return {
        success: false,
        items: [],
        error: 'Search query is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        items: [],
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: true,
        items: [],
        totalCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async createDeployment(
    config: DeploymentConfig
  ): Promise<FoundryOperationResult<DeploymentInfo>> {
    if (!config.modelId || !config.deploymentName) {
      return {
        success: false,
        error: 'Model ID and deployment name are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: 'Deployment creation requires active Azure connection',
        errorCode: FoundryErrorCode.SERVICE_UNAVAILABLE,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async getDeployment(deploymentName: string): Promise<FoundryOperationResult<DeploymentInfo>> {
    if (!deploymentName) {
      return {
        success: false,
        error: 'Deployment name is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Deployment '${deploymentName}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async listDeployments(
    _options: {
      status?: string;
      pageSize?: number;
      pageToken?: string;
    } = {}
  ): Promise<FoundryListResult<DeploymentInfo>> {
    if (!this._isInitialized) {
      return {
        success: false,
        items: [],
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: true,
        items: [],
        totalCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async updateDeployment(
    deploymentName: string,
    _updates: Partial<DeploymentConfig>
  ): Promise<FoundryOperationResult<DeploymentInfo>> {
    if (!deploymentName) {
      return {
        success: false,
        error: 'Deployment name is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Deployment '${deploymentName}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async deleteDeployment(deploymentName: string): Promise<FoundryOperationResult> {
    if (!deploymentName) {
      return {
        success: false,
        error: 'Deployment name is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Deployment '${deploymentName}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async createAgent(config: AgentConfig): Promise<FoundryOperationResult<AgentInfo>> {
    if (!config.name || !config.instructions || !config.model) {
      return {
        success: false,
        error: 'Agent name, instructions, and model are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: 'Agent creation requires active Azure connection',
        errorCode: FoundryErrorCode.SERVICE_UNAVAILABLE,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async getAgent(agentId: string): Promise<FoundryOperationResult<AgentInfo>> {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Agent '${agentId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async listAgents(
    _options: {
      pageSize?: number;
      pageToken?: string;
    } = {}
  ): Promise<FoundryListResult<AgentInfo>> {
    if (!this._isInitialized) {
      return {
        success: false,
        items: [],
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: true,
        items: [],
        totalCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async updateAgent(
    agentId: string,
    _updates: Partial<AgentConfig>
  ): Promise<FoundryOperationResult<AgentInfo>> {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Agent '${agentId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async deleteAgent(agentId: string): Promise<FoundryOperationResult> {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Agent '${agentId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async createThread(
    _metadata?: Record<string, string>
  ): Promise<FoundryOperationResult<AgentThread>> {
    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: 'Thread creation requires active Azure connection',
        errorCode: FoundryErrorCode.SERVICE_UNAVAILABLE,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async getThread(threadId: string): Promise<FoundryOperationResult<AgentThread>> {
    if (!threadId) {
      return {
        success: false,
        error: 'Thread ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Thread '${threadId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async deleteThread(threadId: string): Promise<FoundryOperationResult> {
    if (!threadId) {
      return {
        success: false,
        error: 'Thread ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Thread '${threadId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async addMessage(
    threadId: string,
    content: string,
    _role: 'user' | 'assistant' = 'user',
    _fileIds?: string[]
  ): Promise<FoundryOperationResult<AgentMessage>> {
    if (!threadId || !content) {
      return {
        success: false,
        error: 'Thread ID and content are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: 'Message creation requires active Azure connection',
        errorCode: FoundryErrorCode.SERVICE_UNAVAILABLE,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async listMessages(
    threadId: string,
    _options: {
      limit?: number;
      order?: 'asc' | 'desc';
    } = {}
  ): Promise<FoundryListResult<AgentMessage>> {
    if (!threadId) {
      return {
        success: false,
        items: [],
        error: 'Thread ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        items: [],
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: true,
        items: [],
        totalCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async runAgent(
    threadId: string,
    agentId: string,
    _instructions?: string
  ): Promise<FoundryOperationResult<AgentRun>> {
    if (!threadId || !agentId) {
      return {
        success: false,
        error: 'Thread ID and agent ID are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: 'Agent run requires active Azure connection',
        errorCode: FoundryErrorCode.SERVICE_UNAVAILABLE,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async getRunStatus(threadId: string, runId: string): Promise<FoundryOperationResult<AgentRun>> {
    if (!threadId || !runId) {
      return {
        success: false,
        error: 'Thread ID and run ID are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Run '${runId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async cancelRun(threadId: string, runId: string): Promise<FoundryOperationResult<AgentRun>> {
    if (!threadId || !runId) {
      return {
        success: false,
        error: 'Thread ID and run ID are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Run '${runId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async createEvaluation(
    config: EvaluationConfig
  ): Promise<FoundryOperationResult<EvaluationResult>> {
    if (!config.name || !config.evaluators || config.evaluators.length === 0) {
      return {
        success: false,
        error: 'Evaluation name and at least one evaluator are required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: 'Evaluation creation requires active Azure connection',
        errorCode: FoundryErrorCode.SERVICE_UNAVAILABLE,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async getEvaluation(evaluationId: string): Promise<FoundryOperationResult<EvaluationResult>> {
    if (!evaluationId) {
      return {
        success: false,
        error: 'Evaluation ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Evaluation '${evaluationId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async listEvaluations(
    _options: {
      status?: string;
      pageSize?: number;
      pageToken?: string;
    } = {}
  ): Promise<FoundryListResult<EvaluationResult>> {
    if (!this._isInitialized) {
      return {
        success: false,
        items: [],
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: true,
        items: [],
        totalCount: 0,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async cancelEvaluation(evaluationId: string): Promise<FoundryOperationResult> {
    if (!evaluationId) {
      return {
        success: false,
        error: 'Evaluation ID is required',
        errorCode: FoundryErrorCode.INVALID_INPUT,
      };
    }

    if (!this._isInitialized) {
      return {
        success: false,
        error: 'Foundry client not initialized',
        errorCode: FoundryErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      return {
        success: false,
        error: `Evaluation '${evaluationId}' not found`,
        errorCode: FoundryErrorCode.NOT_FOUND,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async checkHealth(): Promise<ConnectionHealth> {
    const startTime = Date.now();

    if (!this._isInitialized) {
      const health: ConnectionHealth = {
        status: 'unhealthy',
        lastChecked: new Date(),
        endpoint: this.config.endpoint,
        services: [],
        error: 'Foundry client not initialized',
      };
      this.lastHealthCheck = health;
      return health;
    }

    const services: ServiceHealth[] = [];

    const modelServiceHealth = await this.checkServiceHealth('Model Catalog', () =>
      this.listModels({ pageSize: 1 })
    );
    services.push(modelServiceHealth);

    const deploymentServiceHealth = await this.checkServiceHealth('Deployments', () =>
      this.listDeployments({ pageSize: 1 })
    );
    services.push(deploymentServiceHealth);

    const agentServiceHealth = await this.checkServiceHealth('Agents', () =>
      this.listAgents({ pageSize: 1 })
    );
    services.push(agentServiceHealth);

    const evalServiceHealth = await this.checkServiceHealth('Evaluations', () =>
      this.listEvaluations({ pageSize: 1 })
    );
    services.push(evalServiceHealth);

    const unhealthyCount = services.filter((s) => s.status === 'unhealthy').length;
    const degradedCount = services.filter((s) => s.status === 'degraded').length;

    let status: HealthStatus = 'healthy';
    if (unhealthyCount === services.length) {
      status = 'unhealthy';
    } else if (unhealthyCount > 0 || degradedCount > 0) {
      status = 'degraded';
    }

    const health: ConnectionHealth = {
      status,
      latencyMs: Date.now() - startTime,
      lastChecked: new Date(),
      endpoint: this.config.endpoint,
      services,
    };

    this.lastHealthCheck = health;
    return health;
  }

  private async checkServiceHealth(
    name: string,
    checkFn: () => Promise<{ success: boolean; error?: string }>
  ): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      const result = await checkFn();
      return {
        name,
        status: result.success ? 'healthy' : 'degraded',
        latencyMs: Date.now() - startTime,
        error: result.error,
      };
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        latencyMs: Date.now() - startTime,
        error: this.getErrorMessage(error),
      };
    }
  }

  getLastHealthCheck(): ConnectionHealth | null {
    return this.lastHealthCheck;
  }

  getStatus(): FoundryServiceStatus {
    return {
      isInitialized: this._isInitialized,
      endpoint: this.config.endpoint,
      projectName: this.config.projectName,
      subscriptionId: this.config.subscriptionId,
      resourceGroup: this.config.resourceGroup,
      enableLogging: this.config.enableLogging,
    };
  }
}

export const foundryMCPClient = new FoundryMCPClient();
