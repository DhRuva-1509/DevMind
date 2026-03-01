// src/services/azure/openai.service.ts

import OpenAI, { AzureOpenAI } from 'openai';
import { azureAuthService } from './auth.service';
import {
  OpenAIConfig,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResult,
  EmbeddingOptions,
  EmbeddingResult,
  StreamingChunk,
  TokenUsage,
  CostEstimate,
  OpenAIErrorCode,
  RequestLog,
  ModelDeployments,
  ModelDeployment,
  ModelPricing,
  ModelContextWindows,
} from './openai.types';

/**
 * Azure OpenAI Service
 *
 * Provides chat completions, embeddings, and token management.
 * Supports streaming, rate limiting, retry logic, and model fallback.
 */
export class AzureOpenAIService {
  private client: AzureOpenAI | null = null;
  private config: Required<OpenAIConfig>;
  private requestLogs: RequestLog[] = [];
  private _isInitialized: boolean = false;

  /** Model fallback chain */
  private static readonly FALLBACK_CHAIN: ModelDeployment[] = [
    ModelDeployments.GPT_4O,
    ModelDeployments.GPT_4_TURBO,
    ModelDeployments.GPT_35_TURBO,
  ];

  private static readonly DEFAULT_CONFIG: Required<OpenAIConfig> = {
    endpoint: '',
    apiVersion: '2024-08-01-preview',
    enableLogging: true,
    enableTokenCounting: true,
    maxRetries: 3,
    retryDelayMs: 1000,
    timeoutMs: 60000,
  };

  constructor(config: OpenAIConfig = {}) {
    this.config = { ...AzureOpenAIService.DEFAULT_CONFIG, ...config };

    // Try to get endpoint from environment if not provided
    if (!this.config.endpoint) {
      this.config.endpoint = process.env.AZURE_OPENAI_ENDPOINT || '';
    }

    // Initialize client if endpoint is available
    if (this.config.endpoint) {
      this.initializeClient();
    }
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Initialize the OpenAI client
   */
  private initializeClient(): void {
    try {
      const credential = azureAuthService.getCredential();

      this.client = new AzureOpenAI({
        endpoint: this.config.endpoint,
        apiVersion: this.config.apiVersion,
        azureADTokenProvider: async () => {
          const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
          return token?.token || '';
        },
      });

      this._isInitialized = true;
    } catch {
      this._isInitialized = false;
    }
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<ChatCompletionResult> {
    const model = options.model || ModelDeployments.GPT_4O;
    const enableFallback = options.enableFallback ?? true;

    // Get models to try (with fallback chain if enabled)
    const modelsToTry = enableFallback ? this.getFallbackChain(model) : [model];

    let lastError: ChatCompletionResult | null = null;

    for (const currentModel of modelsToTry) {
      const result = await this.chatWithRetry(messages, currentModel, options);

      if (result.success) {
        return result;
      }

      // Don't fallback for certain errors
      if (
        result.errorCode === OpenAIErrorCode.CONTENT_FILTERED ||
        result.errorCode === OpenAIErrorCode.AUTHENTICATION_ERROR
      ) {
        return result;
      }

      lastError = result;
    }

    return (
      lastError || {
        success: false,
        error: 'All models failed',
        errorCode: OpenAIErrorCode.UNKNOWN_ERROR,
      }
    );
  }

  /**
   * Chat with retry logic
   */
  private async chatWithRetry(
    messages: ChatMessage[],
    model: ModelDeployment,
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.executeChatRequest(messages, model, options);

        // Log the request
        if (this.config.enableLogging && result.usage) {
          this.logRequest({
            timestamp: new Date(),
            model,
            operations: 'chat',
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completeTokens,
            durationMs: Date.now() - startTime,
            success: true,
            cost: result.cost?.totalCost,
          });
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        const errorCode = this.getErrorCode(error);

        // Don't retry for non-retryable errors
        if (!this.isRetryableError(errorCode)) {
          break;
        }

        // Wait before retry with exponential backoff
        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
          await this.delay(delay);
        }
      }
    }

    const errorCode = this.getErrorCode(lastError);
    const errorMessage = this.getErrorMessage(lastError, errorCode);

    // Log failed request
    if (this.config.enableLogging) {
      this.logRequest({
        timestamp: new Date(),
        model,
        operations: 'chat',
        inputTokens: this.countTokens(messages.map((m) => m.content).join(' '), model),
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        success: false,
        error: errorMessage,
      });
    }

    return {
      success: false,
      error: errorMessage,
      errorCode,
    };
  }

  /**
   * Execute the chat request
   */
  private async executeChatRequest(
    messages: ChatMessage[],
    model: ModelDeployment,
    options: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'OpenAI client not initialized. Set AZURE_OPENAI_ENDPOINT.',
        errorCode: OpenAIErrorCode.INVALID_REQUEST,
      };
    }

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
    }));

    const response = await this.client.chat.completions.create({
      model,
      messages: chatMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stop: options.stop,
      user: options.user,
    });

    const choice = response.choices[0];
    const content = choice?.message?.content || '';

    const usage: TokenUsage = {
      promptTokens: response.usage?.prompt_tokens || 0,
      completeTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    };

    const cost = this.calculateCost(model, usage);

    return {
      success: true,
      content,
      model: response.model,
      finishReason: choice?.finish_reason || undefined,
      usage,
      cost,
    };
  }

  /**
   * Stream a chat completion
   */
  async *chatStream(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<StreamingChunk, ChatCompletionResult, unknown> {
    const model = options.model || ModelDeployments.GPT_4O;

    if (!this.client) {
      return {
        success: false,
        error: 'OpenAI client not initialized',
        errorCode: OpenAIErrorCode.INVALID_REQUEST,
      };
    }

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      name: m.name,
    }));

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: chatMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: options.topP,
        frequency_penalty: options.frequencyPenalty,
        presence_penalty: options.presencePenalty,
        stop: options.stop,
        user: options.user,
        stream: true,
      });

      let fullContent = '';
      let finishReason: string | undefined;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          fullContent += choice.delta.content;
          yield {
            content: choice.delta.content,
            model: chunk.model,
          };
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }

      // Estimate tokens for streaming
      const inputTokens = this.countTokens(messages.map((m) => m.content).join(' '), model);
      const outputTokens = this.countTokens(fullContent, model);

      const usage: TokenUsage = {
        promptTokens: inputTokens,
        completeTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      };

      const cost = this.calculateCost(model, usage);

      return {
        success: true,
        content: fullContent,
        model,
        finishReason,
        usage,
        cost,
      };
    } catch (error) {
      const errorCode = this.getErrorCode(error);
      return {
        success: false,
        error: this.getErrorMessage(error, errorCode),
        errorCode,
      };
    }
  }

  /**
   * Generate embeddings for text
   */
  async embed(input: string | string[], options: EmbeddingOptions = {}): Promise<EmbeddingResult> {
    const model = options.model || ModelDeployments.EMBEDDING_3_LARGE;
    const startTime = Date.now();

    if (!this.client) {
      return {
        success: false,
        error: 'OpenAI client not initialized',
        errorCode: OpenAIErrorCode.INVALID_REQUEST,
      };
    }

    const inputs = Array.isArray(input) ? input : [input];

    try {
      const response = await this.client.embeddings.create({
        model,
        input: inputs,
        dimensions: options.dimension,
        user: options.user,
      });

      const embeddings = response.data.map((d) => d.embedding);

      const usage: TokenUsage = {
        promptTokens: response.usage?.prompt_tokens || 0,
        completeTokens: 0,
        totalTokens: response.usage?.total_tokens || 0,
      };

      const cost = this.calculateCost(model, usage);

      // Log the request
      if (this.config.enableLogging) {
        this.logRequest({
          timestamp: new Date(),
          model,
          operations: 'embedding',
          inputTokens: usage.promptTokens,
          outputTokens: 0,
          durationMs: Date.now() - startTime,
          success: true,
          cost: cost.totalCost,
        });
      }

      return {
        success: true,
        embedding: embeddings.length === 1 ? embeddings[0] : undefined,
        embeddings: embeddings.length > 1 ? embeddings : undefined,
        model: response.model,
        usage,
        cost,
      };
    } catch (error) {
      const errorCode = this.getErrorCode(error);
      const errorMessage = this.getErrorMessage(error, errorCode);

      // Log failed request
      if (this.config.enableLogging) {
        this.logRequest({
          timestamp: new Date(),
          model,
          operations: 'embedding',
          inputTokens: this.countTokens(inputs.join(' '), model),
          outputTokens: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: errorMessage,
        });
      }

      return {
        success: false,
        error: errorMessage,
        errorCode,
      };
    }
  }

  /**
   * Count tokens in text (simple estimation)
   */
  countTokens(text: string, _model: ModelDeployment = ModelDeployments.GPT_4O): number {
    if (!this.config.enableTokenCounting || !text) {
      return 0;
    }

    // Simple estimation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate cost for a request
   */
  estimateCost(
    inputText: string,
    estimatedOutputTokens: number,
    model: ModelDeployment = ModelDeployments.GPT_4O
  ): CostEstimate {
    const inputTokens = this.countTokens(inputText, model);

    return this.calculateCost(model, {
      promptTokens: inputTokens,
      completeTokens: estimatedOutputTokens,
      totalTokens: inputTokens + estimatedOutputTokens,
    });
  }

  /**
   * Calculate cost from token usage
   */
  private calculateCost(model: string, usage: TokenUsage): CostEstimate {
    const pricing = ModelPricing[model] || { input: 0, output: 0 };

    const inputCost = (usage.promptTokens / 1000) * pricing.input;
    const outputCost = (usage.completeTokens / 1000) * pricing.output;

    return {
      inputCost,
      outputCost,
      totalCost: inputCost + outputCost,
      currency: 'USD',
    };
  }

  /**
   * Check if text fits within model context
   */
  fitsInContext(
    text: string,
    model: ModelDeployment = ModelDeployments.GPT_4O,
    reserveTokens: number = 1000
  ): boolean {
    const tokens = this.countTokens(text, model);
    const contextWindow = ModelContextWindows[model] || 4096;
    return tokens <= contextWindow - reserveTokens;
  }

  /**
   * Get the fallback chain starting from a model
   */
  private getFallbackChain(startModel: ModelDeployment): ModelDeployment[] {
    const chain = AzureOpenAIService.FALLBACK_CHAIN;
    const startIndex = chain.indexOf(startModel);

    if (startIndex === -1) {
      return [startModel, ...chain];
    }

    return chain.slice(startIndex);
  }

  /**
   * Get error code from error
   */
  private getErrorCode(error: unknown): OpenAIErrorCode {
    const err = error as Error & {
      code?: string;
      status?: number;
      statusCode?: number;
    };
    const message = err?.message?.toLowerCase() || '';
    const status = err?.status || err?.statusCode;

    if (status === 429 || message.includes('rate limit')) {
      return OpenAIErrorCode.RATE_LIMITED;
    }

    if (message.includes('context length') || message.includes('maximum context')) {
      return OpenAIErrorCode.CONTEXT_LENGTH_EXCEEDED;
    }

    if (message.includes('content filter') || message.includes('content_filter')) {
      return OpenAIErrorCode.CONTENT_FILTERED;
    }

    if (status === 401 || status === 403 || message.includes('unauthorized')) {
      return OpenAIErrorCode.AUTHENTICATION_ERROR;
    }

    if (status === 404 || message.includes('not found') || message.includes('does not exist')) {
      return OpenAIErrorCode.MODEL_NOT_FOUND;
    }

    if (status === 503 || message.includes('unavailable')) {
      return OpenAIErrorCode.SERVICE_UNAVAILABLE;
    }

    if (message.includes('timeout') || message.includes('etimedout')) {
      return OpenAIErrorCode.TIMEOUT;
    }

    if (status === 400 || message.includes('invalid')) {
      return OpenAIErrorCode.INVALID_REQUEST;
    }

    return OpenAIErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: unknown, errorCode: OpenAIErrorCode): string {
    const err = error as Error;
    const originalMessage = err?.message || 'Unknown error';

    switch (errorCode) {
      case OpenAIErrorCode.RATE_LIMITED:
        return 'Rate limited. Please wait and try again.';
      case OpenAIErrorCode.CONTEXT_LENGTH_EXCEEDED:
        return 'Input is too long for the model context window.';
      case OpenAIErrorCode.CONTENT_FILTERED:
        return 'Content was filtered by Azure content safety policies.';
      case OpenAIErrorCode.AUTHENTICATION_ERROR:
        return 'Authentication failed. Check Azure credentials.';
      case OpenAIErrorCode.MODEL_NOT_FOUND:
        return 'Model deployment not found. Check deployment name.';
      case OpenAIErrorCode.SERVICE_UNAVAILABLE:
        return 'Azure OpenAI service is temporarily unavailable.';
      case OpenAIErrorCode.TIMEOUT:
        return 'Request timed out. Try again or reduce input size.';
      case OpenAIErrorCode.INVALID_REQUEST:
        return `Invalid request: ${originalMessage}`;
      default:
        return `OpenAI error: ${originalMessage}`;
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(errorCode: OpenAIErrorCode): boolean {
    return [
      OpenAIErrorCode.RATE_LIMITED,
      OpenAIErrorCode.SERVICE_UNAVAILABLE,
      OpenAIErrorCode.TIMEOUT,
    ].includes(errorCode);
  }

  /**
   * Log a request
   */
  private logRequest(log: RequestLog): void {
    this.requestLogs.push(log);

    // Keep only last 1000 logs
    if (this.requestLogs.length > 1000) {
      this.requestLogs = this.requestLogs.slice(-1000);
    }
  }

  /**
   * Get request logs
   */
  getRequestLogs(): RequestLog[] {
    return [...this.requestLogs];
  }

  /**
   * Get usage statistics
   */
  getUsageStats(): {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    averageLatencyMs: number;
  } {
    const logs = this.requestLogs;

    const successful = logs.filter((l) => l.success);
    const failed = logs.filter((l) => !l.success);

    return {
      totalRequests: logs.length,
      successfulRequests: successful.length,
      failedRequests: failed.length,
      totalInputTokens: logs.reduce((sum, l) => sum + l.inputTokens, 0),
      totalOutputTokens: logs.reduce((sum, l) => sum + l.outputTokens, 0),
      totalCost: logs.reduce((sum, l) => sum + (l.cost || 0), 0),
      averageLatencyMs:
        logs.length > 0 ? logs.reduce((sum, l) => sum + l.durationMs, 0) / logs.length : 0,
    };
  }

  /**
   * Clear request logs
   */
  clearLogs(): void {
    this.requestLogs = [];
  }

  /**
   * Get service status
   */
  getStatus(): {
    isInitialized: boolean;
    endpoint: string;
    enableLogging: boolean;
    enableTokenCounting: boolean;
    requestCount: number;
  } {
    return {
      isInitialized: this._isInitialized,
      endpoint: this.config.endpoint,
      enableLogging: this.config.enableLogging,
      enableTokenCounting: this.config.enableTokenCounting,
      requestCount: this.requestLogs.length,
    };
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const azureOpenAIService = new AzureOpenAIService();
