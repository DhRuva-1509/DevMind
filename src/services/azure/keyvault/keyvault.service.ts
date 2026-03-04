// src/services/azure/keyvault.service.ts

import { SecretClient, KeyVaultSecret } from '@azure/keyvault-secrets';
import { TokenCredential } from '@azure/core-auth';
import { azureAuthService } from '../auth/auth.service';
import {
  KeyVaultConfig,
  CachedSecret,
  SecretResult,
  SecretErrorCode,
  SecretName,
} from './keyvault.types';

/**
 * Azure Key Vault Service
 *
 * Manages secrets securely using Azure Key Vault.
 * Supports caching and local fallback for development.
 *
 * @example
 * ```typescript
 * const kvService = new KeyVaultService({
 *   vaultUrl: 'https://kv-devmind-dev.vault.azure.net'
 * });
 * const result = await kvService.getSecret('github-token');
 * ```
 */
export class KeyVaultService {
  private client: SecretClient | null = null;
  private config: Required<KeyVaultConfig>;
  private secretCache: Map<string, CachedSecret>;
  private isInitialized: boolean = false;

  private static readonly DEFAULT_CONFIG: Required<KeyVaultConfig> = {
    vaultUrl: '',
    enableCaching: true,
    cacheTtlSeconds: 300, // 5 minutes
    useLocalFallback: true,
    localSecrets: {},
  };

  constructor(config: KeyVaultConfig = {}) {
    this.config = { ...KeyVaultService.DEFAULT_CONFIG, ...config };
    this.secretCache = new Map();

    // Try to get vault URL from environment if not provided
    if (!this.config.vaultUrl) {
      this.config.vaultUrl = process.env.AZURE_KEYVAULT_URL || '';
    }

    // Initialize client if vault URL is available
    if (this.config.vaultUrl) {
      this.initializeClient();
    }
  }

  /**
   * Initialize the Key Vault client
   */
  private initializeClient(): void {
    try {
      const credential: TokenCredential = azureAuthService.getCredential();
      this.client = new SecretClient(this.config.vaultUrl, credential);
      this.isInitialized = true;
    } catch {
      // Silently fail - will use local fallback
      this.isInitialized = false;
    }
  }

  /**
   * Get a secret by name
   */
  async getSecret(secretName: SecretName | string): Promise<SecretResult> {
    // Validate secret name
    if (!this.isValidSecretName(secretName)) {
      return {
        success: false,
        error: `Invalid secret name: ${secretName}. Names must be 1-127 characters, alphanumeric and hyphens only.`,
        errorCode: SecretErrorCode.INVALID_SECRET_NAME,
      };
    }

    // Check cache first
    if (this.config.enableCaching) {
      const cached = this.getFromCache(secretName);
      if (cached) {
        return {
          success: true,
          value: cached.value,
          source: 'cache',
        };
      }
    }

    // Try Key Vault
    if (this.client) {
      const result = await this.getFromKeyVault(secretName);
      if (result.success) {
        // Cache the secret
        if (this.config.enableCaching && result.value) {
          this.cacheSecret(secretName, result.value);
        }
        return result;
      }

      // If Key Vault failed and no fallback, return error
      if (!this.config.useLocalFallback) {
        return result;
      }
    }

    // Fallback to local secrets
    if (this.config.useLocalFallback) {
      const result = this.getFromLocal(secretName);

      // Cache the secret from local too
      if (result.success && this.config.enableCaching && result.value) {
        this.cacheSecret(secretName, result.value);
      }

      return result;
    }

    return {
      success: false,
      error: 'Key Vault not configured and local fallback disabled',
      errorCode: SecretErrorCode.NOT_CONFIGURED,
    };
  }

  /**
   * Set a secret
   */
  async setSecret(secretName: SecretName | string, value: string): Promise<SecretResult> {
    // Validate secret name
    if (!this.isValidSecretName(secretName)) {
      return {
        success: false,
        error: `Invalid secret name: ${secretName}`,
        errorCode: SecretErrorCode.INVALID_SECRET_NAME,
      };
    }

    // Set in Key Vault if available
    if (this.client) {
      try {
        await this.client.setSecret(secretName, value);

        // Update cache
        if (this.config.enableCaching) {
          this.cacheSecret(secretName, value);
        }

        return {
          success: true,
          source: 'keyvault',
        };
      } catch (error) {
        return this.handleKeyVaultError(error, secretName);
      }
    }

    // Fallback to local
    if (this.config.useLocalFallback) {
      this.config.localSecrets[secretName] = value;

      // Update cache
      if (this.config.enableCaching) {
        this.cacheSecret(secretName, value);
      }

      return {
        success: true,
        source: 'local',
      };
    }

    return {
      success: false,
      error: 'Key Vault not configured and local fallback disabled',
      errorCode: SecretErrorCode.NOT_CONFIGURED,
    };
  }

  /**
   * Delete a secret
   */
  async deleteSecret(secretName: SecretName | string): Promise<SecretResult> {
    // Validate secret name
    if (!this.isValidSecretName(secretName)) {
      return {
        success: false,
        error: `Invalid secret name: ${secretName}`,
        errorCode: SecretErrorCode.INVALID_SECRET_NAME,
      };
    }

    // Remove from cache
    this.secretCache.delete(secretName);

    // Delete from Key Vault if available
    if (this.client) {
      try {
        const poller = await this.client.beginDeleteSecret(secretName);
        await poller.pollUntilDone();

        return {
          success: true,
          source: 'keyvault',
        };
      } catch (error) {
        return this.handleKeyVaultError(error, secretName);
      }
    }

    // Fallback to local
    if (this.config.useLocalFallback) {
      delete this.config.localSecrets[secretName];

      return {
        success: true,
        source: 'local',
      };
    }

    return {
      success: false,
      error: 'Key Vault not configured and local fallback disabled',
      errorCode: SecretErrorCode.NOT_CONFIGURED,
    };
  }

  /**
   * Get secret from Key Vault
   */
  private async getFromKeyVault(secretName: string): Promise<SecretResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Key Vault client not initialized',
        errorCode: SecretErrorCode.NOT_CONFIGURED,
      };
    }

    try {
      const secret: KeyVaultSecret = await this.client.getSecret(secretName);

      if (!secret.value) {
        return {
          success: false,
          error: `Secret '${secretName}' has no value`,
          errorCode: SecretErrorCode.NOT_FOUND,
        };
      }

      return {
        success: true,
        value: secret.value,
        source: 'keyvault',
      };
    } catch (error) {
      return this.handleKeyVaultError(error, secretName);
    }
  }

  /**
   * Get secret from local configuration
   */
  private getFromLocal(secretName: string): SecretResult {
    const value = this.config.localSecrets[secretName];

    if (value === undefined) {
      // Also check environment variables
      const envKey = secretName.toUpperCase().replace(/-/g, '_');
      const envValue = process.env[envKey];

      if (envValue) {
        return {
          success: true,
          value: envValue,
          source: 'local',
        };
      }

      return {
        success: false,
        error: `Secret '${secretName}' not found in local settings or environment`,
        errorCode: SecretErrorCode.NOT_FOUND,
      };
    }

    return {
      success: true,
      value,
      source: 'local',
    };
  }

  /**
   * Handle Key Vault errors
   */
  private handleKeyVaultError(error: unknown, secretName: string): SecretResult {
    const err = error as Error & { code?: string; statusCode?: number };
    const message = err.message || 'Unknown error';
    const statusCode = err.statusCode;

    // Access denied
    if (statusCode === 403 || message.includes('Forbidden')) {
      return {
        success: false,
        error: `Access denied to secret '${secretName}'. Check Key Vault access policies.`,
        errorCode: SecretErrorCode.ACCESS_DENIED,
      };
    }

    // Not found
    if (statusCode === 404 || message.includes('NotFound')) {
      return {
        success: false,
        error: `Secret '${secretName}' not found in Key Vault`,
        errorCode: SecretErrorCode.NOT_FOUND,
      };
    }

    // Network error
    if (
      message.includes('ENOTFOUND') ||
      message.includes('ETIMEDOUT') ||
      message.includes('network')
    ) {
      return {
        success: false,
        error: `Network error accessing Key Vault: ${message}`,
        errorCode: SecretErrorCode.NETWORK_ERROR,
      };
    }

    // Vault unavailable
    if (statusCode === 503 || message.includes('unavailable')) {
      return {
        success: false,
        error: 'Key Vault service unavailable',
        errorCode: SecretErrorCode.VAULT_UNAVAILABLE,
      };
    }

    return {
      success: false,
      error: `Key Vault error: ${message}`,
      errorCode: SecretErrorCode.UNKNOWN_ERROR,
    };
  }

  /**
   * Validate secret name
   * Key Vault secret names must be 1-127 characters, alphanumeric and hyphens
   */
  private isValidSecretName(name: string): boolean {
    if (!name || name.length > 127) {
      return false;
    }
    return /^[a-zA-Z0-9-]+$/.test(name);
  }

  /**
   * Get secret from cache if valid
   */
  private getFromCache(secretName: string): CachedSecret | null {
    const cached = this.secretCache.get(secretName);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    const expiresAt = cached.cachedAt + cached.ttlMs;

    if (now >= expiresAt) {
      this.secretCache.delete(secretName);
      return null;
    }

    return cached;
  }

  /**
   * Cache a secret
   */
  private cacheSecret(secretName: string, value: string): void {
    this.secretCache.set(secretName, {
      value,
      cachedAt: Date.now(),
      ttlMs: this.config.cacheTtlSeconds * 1000,
    });
  }

  /**
   * Clear the secret cache
   */
  clearCache(): void {
    this.secretCache.clear();
  }

  /**
   * Clear a specific secret from cache
   */
  clearSecretFromCache(secretName: string): void {
    this.secretCache.delete(secretName);
  }

  /**
   * Check if Key Vault is configured and accessible
   */
  async isAvailable(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      // Try to list secrets (limited to 1) to verify access
      const iterator = this.client.listPropertiesOfSecrets();
      await iterator.next();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get service status
   */
  async getStatus(): Promise<{
    isInitialized: boolean;
    vaultUrl: string;
    isAvailable: boolean;
    cachedSecretCount: number;
    useLocalFallback: boolean;
  }> {
    const isAvailable = await this.isAvailable();

    return {
      isInitialized: this.isInitialized,
      vaultUrl: this.config.vaultUrl,
      isAvailable,
      cachedSecretCount: this.secretCache.size,
      useLocalFallback: this.config.useLocalFallback,
    };
  }

  /**
   * Set local secrets (for development)
   */
  setLocalSecrets(secrets: Record<string, string>): void {
    this.config.localSecrets = { ...this.config.localSecrets, ...secrets };
  }
}

// Export singleton instance (will use environment variable for vault URL)
export const keyVaultService = new KeyVaultService();
