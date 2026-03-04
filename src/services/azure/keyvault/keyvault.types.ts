/**
 * Configuration for Azure Key Vault
 */

export interface KeyVaultConfig {
  // Key Vault URL
  vaultUrl?: string;

  // Enable secret caching
  enableCaching?: boolean;

  // Cache TTL in seconds
  cacheTtlSeconds?: number;

  // Use local settings as fallback when Key Vault is not available
  useLocalFallback?: boolean;

  // Local secrets for development
  localSecrets?: Record<string, string>;
}

/**
 * Cached secret with metadata
 */
export interface CachedSecret {
  value: string;
  cachedAt: number;
  ttlMs: number;
}

/**
 * Result of the secret operation
 */
export interface SecretResult {
  success: boolean;
  value?: string;
  error?: string;
  errorCode?: SecretErrorCode;
  source?: 'local' | 'keyvault' | 'cache';
}

/**
 * Secret Error Codes
 */
export enum SecretErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  ACCESS_DENIED = 'ACCESS_DENIED',
  VAULT_UNAVAILABLE = 'VAULT_UNAVAILABLE',
  INVALID_SECRET_NAME = 'INVALID_SECRET_NAME',
  NETWORK_ERROR = 'NETWORK_ERROR',
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Well-known secret names used in the application
 */
export const SecretNames = {
  //Github Personal Access Token
  GITHUB_TOKEN: 'github-token',

  //Azure OpenAI API Key
  AZURE_OPENAI_KEY: 'azure-openai-key',

  //Azure OpenAI endpoint URL
  AZURE_OPENAI_ENDPOINT: 'azure-openai-endpoint',

  //Azure AI Search API Key
  AZURE_SEARCH_KEY: 'azure-search-key',

  //Azure AI Search Endpoint
  AZURE_SEARCH_ENDPOINT: 'azure-search-endpoint',

  //Cosmos DB Connection String
  COSMOS_DB_CONNECTION: 'cosmos-db-connection',

  //Application Insights Connection String
  APP_INSIGHTS_CONNECTION: 'app-insights-connection',
} as const;

export type SecretName = (typeof SecretNames)[keyof typeof SecretNames];
