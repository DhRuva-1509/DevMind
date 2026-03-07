/**
 * Foundry MCP Client Configuration
 */
export interface FoundryConfig {
  endpoint?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  projectName?: string;
  enableLogging?: boolean;
  requestTimeoutMs?: number;
  maxRetryAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  version?: string;
  description?: string;
  publisher?: string;
  modelType?: ModelType;
  capabilities?: ModelCapabilities;
  inputModalities?: string[];
  outputModalities?: string[];
  fineTuningSupported?: boolean;
  maxTokens?: number;
  contextWindow?: number;
  deploymentStatus?: DeploymentStatus;
  createdAt?: Date;
  updatedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Model types
 */
export type ModelType =
  | 'chat'
  | 'completion'
  | 'embedding'
  | 'image-generation'
  | 'audio'
  | 'vision'
  | 'multimodal'
  | 'custom';

/**
 * Model capabilities
 */
export interface ModelCapabilities {
  chat?: boolean;
  completion?: boolean;
  embedding?: boolean;
  imageGeneration?: boolean;
  imageAnalysis?: boolean;
  audioTranscription?: boolean;
  audioGeneration?: boolean;
  functionCalling?: boolean;
  jsonMode?: boolean;
  streaming?: boolean;
}

/**
 * Deployment status
 */
export type DeploymentStatus =
  | 'notDeployed'
  | 'deploying'
  | 'deployed'
  | 'failed'
  | 'deleting'
  | 'updating';

/**
 * Model deployment configuration
 */
export interface DeploymentConfig {
  modelId: string;
  deploymentName: string;
  sku?: DeploymentSku;
  capacity?: number;
  scaleSettings?: ScaleSettings;
  versionUpgradeOption?: VersionUpgradeOption;
  raiPolicyName?: string;
  metadata?: Record<string, string>;
}

/**
 * Deployment SKU
 */
export interface DeploymentSku {
  name: string;
  tier?: 'Standard' | 'Premium';
  capacity?: number;
}

/**
 * Scale settings
 */
export interface ScaleSettings {
  scaleType: 'Standard' | 'Manual';
  capacity?: number;
  minCapacity?: number;
  maxCapacity?: number;
}

/**
 * Version upgrade option
 */
export type VersionUpgradeOption =
  | 'OnceNewDefaultVersionAvailable'
  | 'OnceCurrentVersionExpired'
  | 'NoAutoUpgrade';

/**
 * Deployment information
 */
export interface DeploymentInfo {
  id: string;
  name: string;
  modelId: string;
  modelName?: string;
  status: DeploymentStatus;
  endpoint?: string;
  sku?: DeploymentSku;
  scaleSettings?: ScaleSettings;
  provisioningState?: string;
  createdAt?: Date;
  updatedAt?: Date;
  rateLimits?: RateLimits;
  metadata?: Record<string, unknown>;
}

/**
 * Rate limits
 */
export interface RateLimits {
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  requestsPerDay?: number;
  tokensPerDay?: number;
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  name: string;
  description?: string;
  instructions: string;
  model: string;
  tools?: AgentTool[];
  fileIds?: string[];
  metadata?: Record<string, string>;
}

/**
 * Agent tool types
 */
export interface AgentTool {
  type: AgentToolType;
  function?: AgentFunction;
}

/**
 * Agent tool type
 */
export type AgentToolType = 'code_interpreter' | 'file_search' | 'function';

/**
 * Agent function definition
 */
export interface AgentFunction {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Agent information
 */
export interface AgentInfo {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  model: string;
  tools: AgentTool[];
  fileIds: string[];
  createdAt?: Date;
  metadata?: Record<string, string>;
}

/**
 * Agent thread
 */
export interface AgentThread {
  id: string;
  createdAt?: Date;
  metadata?: Record<string, string>;
}

/**
 * Agent message
 */
export interface AgentMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  fileIds?: string[];
  createdAt?: Date;
  metadata?: Record<string, string>;
}

/**
 * Agent run
 */
export interface AgentRun {
  id: string;
  threadId: string;
  agentId: string;
  status: AgentRunStatus;
  instructions?: string;
  model?: string;
  tools?: AgentTool[];
  createdAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  lastError?: AgentError;
  usage?: AgentUsage;
}

/**
 * Agent run status
 */
export type AgentRunStatus =
  | 'queued'
  | 'in_progress'
  | 'requires_action'
  | 'cancelling'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'expired';

/**
 * Agent error
 */
export interface AgentError {
  code: string;
  message: string;
}

/**
 * Agent usage
 */
export interface AgentUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Evaluation configuration
 */
export interface EvaluationConfig {
  name: string;
  description?: string;
  datasetId?: string;
  datasetPath?: string;
  evaluators: EvaluatorConfig[];
  target?: EvaluationTarget;
  metadata?: Record<string, string>;
}

/**
 * Evaluator configuration
 */
export interface EvaluatorConfig {
  type: EvaluatorType;
  name?: string;
  threshold?: number;
  parameters?: Record<string, unknown>;
}

/**
 * Evaluator types
 */
export type EvaluatorType =
  | 'relevance'
  | 'groundedness'
  | 'coherence'
  | 'fluency'
  | 'similarity'
  | 'f1_score'
  | 'exact_match'
  | 'rouge'
  | 'bleu'
  | 'custom';

/**
 * Evaluation target
 */
export interface EvaluationTarget {
  deploymentName?: string;
  endpoint?: string;
  systemPrompt?: string;
}

/**
 * Evaluation result
 */
export interface EvaluationResult {
  id: string;
  name: string;
  status: EvaluationStatus;
  metrics: EvaluationMetrics;
  scores?: EvaluationScore[];
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Evaluation status
 */
export type EvaluationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Evaluation metrics
 */
export interface EvaluationMetrics {
  relevance?: number;
  groundedness?: number;
  coherence?: number;
  fluency?: number;
  similarity?: number;
  f1Score?: number;
  exactMatch?: number;
  rouge?: RougeScores;
  bleu?: number;
  custom?: Record<string, number>;
}

/**
 * ROUGE scores
 */
export interface RougeScores {
  rouge1?: number;
  rouge2?: number;
  rougeL?: number;
}

/**
 * Evaluation score
 */
export interface EvaluationScore {
  inputId: string;
  scores: Record<string, number>;
  metadata?: Record<string, unknown>;
}

/**
 * Connection health
 */
export interface ConnectionHealth {
  status: HealthStatus;
  latencyMs?: number;
  lastChecked: Date;
  endpoint: string;
  services: ServiceHealth[];
  error?: string;
}

/**
 * Health status
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/**
 * Service health
 */
export interface ServiceHealth {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
}

/**
 * Operation result
 */
export interface FoundryOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: FoundryErrorCode;
  requestId?: string;
}

/**
 * List result
 */
export interface FoundryListResult<T> {
  success: boolean;
  items: T[];
  nextPageToken?: string;
  totalCount?: number;
  error?: string;
  errorCode?: FoundryErrorCode;
}

/**
 * Error codes
 */
export enum FoundryErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  INVALID_INPUT = 'INVALID_INPUT',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  DEPLOYMENT_FAILED = 'DEPLOYMENT_FAILED',
  MODEL_NOT_SUPPORTED = 'MODEL_NOT_SUPPORTED',
  EVALUATION_FAILED = 'EVALUATION_FAILED',
  AGENT_ERROR = 'AGENT_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Service status
 */
export interface FoundryServiceStatus {
  isInitialized: boolean;
  endpoint: string;
  projectName: string;
  subscriptionId: string;
  resourceGroup: string;
  enableLogging: boolean;
}

/**
 * Predefined model catalog entries
 */
export const ModelCatalog = {
  GPT_4O: {
    id: 'gpt-4o',
    name: 'GPT-4o',
    publisher: 'OpenAI',
    modelType: 'multimodal' as ModelType,
  },

  GPT_4O_MINI: {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    publisher: 'OpenAI',
    modelType: 'multimodal' as ModelType,
  },

  GPT_4_TURBO: {
    id: 'gpt-4-turbo',
    name: 'GPT-4 Turbo',
    publisher: 'OpenAI',
    modelType: 'chat' as ModelType,
  },

  GPT_35_TURBO: {
    id: 'gpt-35-turbo',
    name: 'GPT-3.5 Turbo',
    publisher: 'OpenAI',
    modelType: 'chat' as ModelType,
  },

  TEXT_EMBEDDING_3_LARGE: {
    id: 'text-embedding-3-large',
    name: 'Text Embedding 3 Large',
    publisher: 'OpenAI',
    modelType: 'embedding' as ModelType,
  },

  TEXT_EMBEDDING_3_SMALL: {
    id: 'text-embedding-3-small',
    name: 'Text Embedding 3 Small',
    publisher: 'OpenAI',
    modelType: 'embedding' as ModelType,
  },

  LLAMA_3_70B: {
    id: 'meta-llama-3-70b-instruct',
    name: 'Llama 3 70B Instruct',
    publisher: 'Meta',
    modelType: 'chat' as ModelType,
  },

  MISTRAL_LARGE: {
    id: 'mistral-large',
    name: 'Mistral Large',
    publisher: 'Mistral AI',
    modelType: 'chat' as ModelType,
  },

  COHERE_COMMAND_R: {
    id: 'cohere-command-r-plus',
    name: 'Cohere Command R+',
    publisher: 'Cohere',
    modelType: 'chat' as ModelType,
  },

  PHI_3_MEDIUM: {
    id: 'phi-3-medium-128k-instruct',
    name: 'Phi-3 Medium 128K',
    publisher: 'Microsoft',
    modelType: 'chat' as ModelType,
  },
} as const;

/**
 * Predefined evaluator configurations
 */
export const EvaluatorPresets = {
  RAG_QUALITY: {
    evaluators: [
      { type: 'relevance' as EvaluatorType, threshold: 0.7 },
      { type: 'groundedness' as EvaluatorType, threshold: 0.8 },
      { type: 'coherence' as EvaluatorType, threshold: 0.7 },
    ],
  },

  CHAT_QUALITY: {
    evaluators: [
      { type: 'relevance' as EvaluatorType, threshold: 0.7 },
      { type: 'fluency' as EvaluatorType, threshold: 0.8 },
      { type: 'coherence' as EvaluatorType, threshold: 0.7 },
    ],
  },

  SUMMARIZATION: {
    evaluators: [
      { type: 'rouge' as EvaluatorType },
      { type: 'coherence' as EvaluatorType, threshold: 0.7 },
      { type: 'fluency' as EvaluatorType, threshold: 0.8 },
    ],
  },

  SIMILARITY: {
    evaluators: [
      { type: 'similarity' as EvaluatorType, threshold: 0.8 },
      { type: 'exact_match' as EvaluatorType },
      { type: 'f1_score' as EvaluatorType },
    ],
  },
} as const;
