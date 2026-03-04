import {
  DefaultAzureCredential,
  AzureCliCredential,
  ManagedIdentityCredential,
  ChainedTokenCredential,
  CredentialUnavailableError,
} from '@azure/identity';
import { AccessToken, TokenCredential } from '@azure/core-auth';
import {
  AzureAuthConfig,
  CachedToken,
  AuthResult,
  AuthErrorCode,
  AzureScope,
  AzureScopes,
} from '../auth/auth.types';

/**
 * Azure Authentication Service
 * Handles authentication to Azure services using DefaultAzureCredential.
 * Supports both development (Azure CLI) and production (Managed Identity).
 */
export class AzureAuthService {
  private credential: TokenCredential;
  private config: Required<AzureAuthConfig>;
  private tokenCache: Map<string, CachedToken>;
  private _isInitialized: boolean = false;

  private static readonly DEFAULT_CONFIG: Required<AzureAuthConfig> = {
    tenantId: '',
    clientId: '',
    enabledCaching: true,
    refreshThresholdMinutes: 5,
    maxRetryAttempts: 3,
    retryDelayMs: 1000,
  };

  constructor(config: AzureAuthConfig = {}) {
    this.config = { ...AzureAuthService.DEFAULT_CONFIG, ...config };
    this.tokenCache = new Map();
    this.credential = this.createCredential();
  }

  /**
   * Check if the auth service has been initialized
   */
  get isInitialized(): boolean {
    return this._isInitialized;
  }

  /**
   * Creates appropriate credential based on environment
   */
  private createCredential(): TokenCredential {
    const credentialOptions: { tenantId?: string } = {};

    if (this.config.tenantId) {
      credentialOptions.tenantId = this.config.tenantId;
    }

    return new DefaultAzureCredential(credentialOptions);
  }

  /**
   * Creates a custom credential chain for more control
   */
  private createCustomCredential(): TokenCredential {
    const credentials: TokenCredential[] = [];

    // 1. Try Managed Identity first (production)
    if (this.config.clientId) {
      credentials.push(
        new ManagedIdentityCredential({
          clientId: this.config.clientId,
        })
      );
    } else {
      credentials.push(new ManagedIdentityCredential());
    }

    // 2. Fall back to Azure CLI (development)
    credentials.push(new AzureCliCredential());

    return new ChainedTokenCredential(...credentials);
  }

  /**
   * Initialize the auth service and verify credentials
   */
  async initialize(): Promise<AuthResult> {
    try {
      const result = await this.getToken(AzureScopes.ARM);

      if (result.success) {
        this._isInitialized = true;
      }

      return result;
    } catch (error) {
      return this.handleAuthError(error);
    }
  }

  /**
   * Get an access token for the specified scope
   */
  async getToken(scope: AzureScope | string): Promise<AuthResult> {
    const scopes = [scope];
    const cacheKey = this.getCacheKey(scopes);

    if (this.config.enabledCaching) {
      const cachedToken = this.getFromCache(cacheKey);
      if (cachedToken) {
        return {
          success: true,
          accessToken: cachedToken.token.token,
          expiresOn: cachedToken.token.expiresOnTimestamp
            ? new Date(cachedToken.token.expiresOnTimestamp)
            : undefined,
        };
      }
    }
    return this.getTokenWithRetry(scopes, cacheKey);
  }

  /**
   * Get token with retry logic
   */
  private async getTokenWithRetry(scopes: string[], cacheKey: string): Promise<AuthResult> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetryAttempts; attempt++) {
      try {
        const token = await this.credential.getToken(scopes);

        if (!token) {
          throw new Error('No token returned from credential');
        }

        if (this.config.enabledCaching) {
          this.cacheToken(cacheKey, token, scopes);
        }

        return {
          success: true,
          accessToken: token.token,
          expiresOn: token.expiresOnTimestamp ? new Date(token.expiresOnTimestamp) : undefined,
        };
      } catch (error) {
        lastError = error as Error;

        if (this.isNonRetryableError(error)) {
          break;
        }

        // Wait before retry
        if (attempt < this.config.maxRetryAttempts) {
          await this.delay(this.config.retryDelayMs * attempt);
        }
      }
    }
    return this.handleAuthError(lastError);
  }

  /**
   * Check if error is non-retryable
   */
  private isNonRetryableError(error: unknown): boolean {
    if (error instanceof CredentialUnavailableError) {
      return true;
    }

    const message = (error as Error)?.message?.toLowerCase() || '';
    return (
      message.includes('not logged in') ||
      message.includes('invalid tenant') ||
      message.includes('invalid client')
    );
  }

  /**
   * Get the underlying TokenCredential for use with Azure SDK clients
   */
  getCredential(): TokenCredential {
    return this.credential;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const result = await this.getToken(AzureScopes.ARM);
    return result.success;
  }

  /**
   * Clear the token cache
   */
  clearCache(): void {
    this.tokenCache.clear();
  }

  /**
   * Get Cache Key for scopes
   */
  private getCacheKey(scopes: string[]): string {
    return scopes.sort().join('|');
  }

  /**
   * Get token from cache if valid
   */
  private getFromCache(cacheKey: string): CachedToken | null {
    const cached = this.tokenCache.get(cacheKey);

    if (!cached) {
      return null;
    }

    const expiresOn = cached.token.expiresOnTimestamp;
    if (!expiresOn) {
      return null;
    }

    const thresholdMs = this.config.refreshThresholdMinutes * 60 * 1000;
    const now = Date.now();
    const expiresWithThreshold = expiresOn - thresholdMs;

    if (now >= expiresWithThreshold) {
      this.tokenCache.delete(cacheKey);
      return null;
    }

    return cached;
  }

  /**
   * Cache a token
   */
  private cacheToken(cacheKey: string, token: AccessToken, scopes: string[]): void {
    this.tokenCache.set(cacheKey, {
      token,
      scopes,
      cachedAt: Date.now(),
    });
  }

  /**
   * Handle authentication errors
   */
  private handleAuthError(error: unknown): AuthResult {
    const errorMessage = (error as Error)?.message || 'Unknown error';
    const errorCode = this.getErrorCode(error);

    return {
      success: false,
      error: this.getReadableErrorMessage(errorCode, errorMessage),
      errorCode,
    };
  }

  /**
   * Map error to error code
   */
  private getErrorCode(error: unknown): AuthErrorCode {
    if (error instanceof CredentialUnavailableError) {
      return AuthErrorCode.CREDENTIAL_UNAVAILABLE;
    }

    const message = (error as Error)?.message?.toLowerCase() || '';

    if (message.includes('not logged in') || message.includes('az login')) {
      return AuthErrorCode.NOT_LOGGED_IN;
    }

    if (message.includes('expired')) {
      return AuthErrorCode.TOKEN_EXPIRED;
    }

    if (message.includes('scope') || message.includes('permission')) {
      return AuthErrorCode.INVALID_SCOPE;
    }

    if (message.includes('network') || message.includes('fetch')) {
      return AuthErrorCode.NETWORK_ERROR;
    }

    return AuthErrorCode.UNKNOWN_ERROR;
  }

  /**
   * Get user-friendly error message
   */
  private getReadableErrorMessage(errorCode: AuthErrorCode, originalMessage: string): string {
    switch (errorCode) {
      case AuthErrorCode.NOT_LOGGED_IN:
        return 'Not logged in to Azure. Please run "az login" to authenticate.';
      case AuthErrorCode.CREDENTIAL_UNAVAILABLE:
        return 'No Azure credentials available. Please run "az login" or ensure Managed Identity is configured.';
      case AuthErrorCode.TOKEN_EXPIRED:
        return 'Access token expired. Please try again.';
      case AuthErrorCode.INVALID_SCOPE:
        return 'Invalid scope or insufficient permissions for the requested Azure resource.';
      case AuthErrorCode.NETWORK_ERROR:
        return 'Network error while authenticating to Azure. Please check your internet connection.';
      default:
        return `Authentication failed: ${originalMessage}`;
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get authentication status info (for debugging/UI)
   */
  async getAuthStatus(): Promise<{
    isAuthenticated: boolean;
    credentialType: string;
    cachedTokenCount: number;
  }> {
    const isAuthenticated = await this.isAuthenticated();

    return {
      isAuthenticated,
      credentialType: this.credential.constructor.name,
      cachedTokenCount: this.tokenCache.size,
    };
  }
}

export const azureAuthService = new AzureAuthService();
