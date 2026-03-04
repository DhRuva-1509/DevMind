/**
 * Azure OpenAI Service Configuration
 */
export interface OpenAIConfig {
  //Azure OpenAI endpoint
  endpoint?: string;

  //API version
  apiVersion?: string;

  //Enable request/response logging
  enableLogging?: boolean;

  //Enable token counting
  enableTokenCounting?: boolean;

  //Max retries for rate limiting
  maxRetries?: number;

  //Base delay for retry backoff
  retryDelayMs?: number;

  //Request timeout (ms)
  timeoutMs?: number;
}

/**
 * Available model deployment
 */
export const ModelDeployments = {
  GPT_4O: 'gpt-4o',
  GPT_4_TURBO: 'gpt-4-turbo',
  GPT_35_TURBO: 'gpt-3.5-turbo',
  EMBEDDING_3_LARGE: 'text-embedding-3-large',
  EMBEDDING_3_SMALL: 'text-embedding-3-small',
} as const;

export type ModelDeployment = (typeof ModelDeployments)[keyof typeof ModelDeployments];

/**
 * Model Pricing per 1K tokens
 */
export const ModelPricing: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4-turbo': { input: 0.01, output: 0.03 },
  'gpt-35-turbo': { input: 0.0005, output: 0.0015 },
  'text-embedding-3-large': { input: 0.00013, output: 0 },
  'text-embedding-3-small': { input: 0.00002, output: 0 },
};

/**
 * Model context window sizes
 */
export const ModelContextWindows: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4-turbo': 128000,
  'gpt-35-turbo': 16385,
  'text-embedding-3-large': 8191,
  'text-embedding-3-small': 8191,
};

/**
 * Chat message role
 */
export type ChatRole = 'system' | 'user' | 'assistant';

/**
 * Chat message
 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

/**
 * Chat completion request
 */
export interface ChatCompletionOptions {
  model?: ModelDeployment;

  //Sampling temperature
  temperature?: number;

  //Max tokens in response
  maxTokens?: number;

  //Top-p sampling
  topP?: number;

  //Frequency penalty
  frequencyPenalty?: number;

  //Presence penalty
  presencePenalty?: number;

  //Stop sequences
  stop?: string[];

  //Enable Streaming responses
  stream?: boolean;

  //Enable model fallback on failure
  enableFallback?: boolean;

  //User identifier for tracking
  user?: string;
}

/**
 * Chat completion result
 */
export interface ChatCompletionResult {
  success: boolean;
  content?: string;
  model?: string;
  finishReason?: string;
  usage?: TokenUsage;
  cost?: CostEstimate;
  error?: string;
  errorCode?: OpenAIErrorCode;
}

/**
 * Streaming chunk
 */
export interface StreamingChunk {
  content: string;
  finishReason?: string;
  model?: string;
}

/**
 * Embedding options
 */
export interface EmbeddingOptions {
  model?: ModelDeployment;
  dimension?: number;
  user?: string;
}

/**
 * Embedding result
 */
export interface EmbeddingResult {
  success: boolean;
  embedding?: number[];
  embeddings?: number[][];
  model?: string;
  usage?: TokenUsage;
  cost?: CostEstimate;
  error?: string;
  errorCode?: OpenAIErrorCode;
}

/**
 * Token usage details
 */
export interface TokenUsage {
  promptTokens: number;
  completeTokens: number;
  totalTokens: number;
}

/**
 * Cost estimate
 */
export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: string;
}

/**
 * Error codes
 */
export enum OpenAIErrorCode {
  RATE_LIMITED = 'RATE_LIMITED',
  CONTEXT_LENGTH_EXCEEDED = 'CONTEXT_LENGTH_EXCEEDED',
  CONTENT_FILTERED = 'CONTENT_FILTERED',
  INVALID_REQUEST = 'INVALID_REQUEST',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Request log entry
 */
export interface RequestLog {
  timestamp: Date;
  model: string;
  operations: 'chat' | 'embedding';
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  success: boolean;
  error?: string;
  cost?: number;
}
