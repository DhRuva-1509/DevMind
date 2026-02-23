import { AccessToken } from '@azure/core-auth';

/*
Configuration for Azure Authentication Service
*/

export interface AzureAuthConfig {
  tenantId?: string;
  clientId?: string;
  enabledCaching?: boolean;
  refreshThresholdMinutes?: number;
  maxRetryAttempts?: number;
  retryDelayMs?: number;
}

/*
 Cached Tokens with metadata
 */
export interface CachedToken {
  token: AccessToken;
  scopes: string[];
  cachedAt: number;
}

/*
Authentication Result
*/
export interface AuthResult {
  success: boolean;
  accessToken?: string;
  expiresOn?: Date;
  error?: string;
  errorCode?: AuthErrorCode;
}

/*
Authentication error codes 
*/
export enum AuthErrorCode {
  NOT_LOGGED_IN = 'NOT_LOGGED_IN',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  INVALID_SCOPE = 'INVALID_SCOPE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  CREDENTIAL_UNAVAILABLE = 'CREDENTIAL_UNAVAILABLE',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/*
AZURE SERVICES SCOPES
*/
export const AzureScopes = {
  ARM: 'https://management.azure.com/.default',
  KEY_VAULT: 'https://vault.azure.net/.default',
  STORAGE: 'https://storage.azure.com/.default',
  COSMOS_DB: 'https://cosmos.azure.com/.default',
  COGNITIVE_SERVICES: 'https://cognitiveservices.azure.com/.default',
  GRAPH: 'https://graph.microsoft.com/.default',
} as const;

export type AzureScope = (typeof AzureScopes)[keyof typeof AzureScopes];
