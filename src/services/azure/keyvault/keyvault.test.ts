// src/services/azure/keyvault.test.ts

import { expect } from 'chai';
import * as sinon from 'sinon';
import { KeyVaultService } from './keyvault.service';
import { SecretErrorCode, SecretNames } from './keyvault.types';

describe('KeyVaultService', () => {
  let kvService: KeyVaultService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Create service with local fallback enabled (no actual Key Vault)
    kvService = new KeyVaultService({
      useLocalFallback: true,
      enableCaching: true,
      cacheTtlSeconds: 60,
      localSecrets: {
        'github-token': 'test-github-token',
        'azure-openai-key': 'test-openai-key',
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const service = new KeyVaultService();
      expect(service).to.be.instanceOf(KeyVaultService);
    });

    it('should create instance with custom config', () => {
      const service = new KeyVaultService({
        enableCaching: false,
        cacheTtlSeconds: 120,
        useLocalFallback: false,
      });
      expect(service).to.be.instanceOf(KeyVaultService);
    });
  });

  describe('getSecret', () => {
    it('should get secret from local fallback', async () => {
      const result = await kvService.getSecret(SecretNames.GITHUB_TOKEN);

      expect(result.success).to.be.true;
      expect(result.value).to.equal('test-github-token');
      expect(result.source).to.equal('local');
    });

    it('should return cached secret on second call', async () => {
      // First call
      await kvService.getSecret(SecretNames.GITHUB_TOKEN);

      // Second call should be from cache
      const result = await kvService.getSecret(SecretNames.GITHUB_TOKEN);

      expect(result.success).to.be.true;
      expect(result.source).to.equal('cache');
    });

    it('should return NOT_FOUND for missing secret', async () => {
      const result = await kvService.getSecret('non-existent-secret');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SecretErrorCode.NOT_FOUND);
    });

    it('should reject invalid secret names', async () => {
      const result = await kvService.getSecret('invalid name with spaces');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SecretErrorCode.INVALID_SECRET_NAME);
    });

    it('should reject empty secret names', async () => {
      const result = await kvService.getSecret('');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SecretErrorCode.INVALID_SECRET_NAME);
    });

    it('should reject secret names longer than 127 characters', async () => {
      const longName = 'a'.repeat(128);
      const result = await kvService.getSecret(longName);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SecretErrorCode.INVALID_SECRET_NAME);
    });
  });

  describe('setSecret', () => {
    it('should set secret in local fallback', async () => {
      const result = await kvService.setSecret('new-secret', 'new-value');

      expect(result.success).to.be.true;
      expect(result.source).to.equal('local');

      // Verify it can be retrieved
      const getResult = await kvService.getSecret('new-secret');
      expect(getResult.success).to.be.true;
      expect(getResult.value).to.equal('new-value');
    });

    it('should update existing secret', async () => {
      await kvService.setSecret(SecretNames.GITHUB_TOKEN, 'updated-token');

      const result = await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      expect(result.success).to.be.true;
      expect(result.value).to.equal('updated-token');
    });

    it('should reject invalid secret names', async () => {
      const result = await kvService.setSecret('invalid name!', 'value');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SecretErrorCode.INVALID_SECRET_NAME);
    });
  });

  describe('deleteSecret', () => {
    it('should delete secret from local fallback', async () => {
      const deleteResult = await kvService.deleteSecret(SecretNames.GITHUB_TOKEN);
      expect(deleteResult.success).to.be.true;

      // Verify it's gone
      const getResult = await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      expect(getResult.success).to.be.false;
      expect(getResult.errorCode).to.equal(SecretErrorCode.NOT_FOUND);
    });

    it('should clear secret from cache when deleted', async () => {
      // Cache the secret
      await kvService.getSecret(SecretNames.GITHUB_TOKEN);

      // Delete it
      await kvService.deleteSecret(SecretNames.GITHUB_TOKEN);

      // Add it back
      await kvService.setSecret(SecretNames.GITHUB_TOKEN, 'new-value');

      // Should get new value, not cached old value
      const result = await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      expect(result.value).to.equal('new-value');
    });
  });

  describe('caching behavior', () => {
    it('should cache secrets', async () => {
      // First call - from local
      const result1 = await kvService.getSecret(SecretNames.AZURE_OPENAI_KEY);
      expect(result1.source).to.equal('local');

      // Second call - from cache
      const result2 = await kvService.getSecret(SecretNames.AZURE_OPENAI_KEY);
      expect(result2.source).to.equal('cache');
    });

    it('should not cache when caching is disabled', async () => {
      const noCacheService = new KeyVaultService({
        enableCaching: false,
        useLocalFallback: true,
        localSecrets: { 'test-secret': 'test-value' },
      });

      // First call
      const result1 = await noCacheService.getSecret('test-secret');
      expect(result1.source).to.equal('local');

      // Second call - still from local, not cache
      const result2 = await noCacheService.getSecret('test-secret');
      expect(result2.source).to.equal('local');
    });

    it('should clear cache', async () => {
      // Cache a secret
      await kvService.getSecret(SecretNames.GITHUB_TOKEN);

      // Clear cache
      kvService.clearCache();

      // Should fetch from local again
      const result = await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      expect(result.source).to.equal('local');
    });

    it('should clear specific secret from cache', async () => {
      // Cache multiple secrets
      await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      await kvService.getSecret(SecretNames.AZURE_OPENAI_KEY);

      // Clear only one
      kvService.clearSecretFromCache(SecretNames.GITHUB_TOKEN);

      // GitHub token should be from local
      const result1 = await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      expect(result1.source).to.equal('local');

      // OpenAI key should still be cached
      const result2 = await kvService.getSecret(SecretNames.AZURE_OPENAI_KEY);
      expect(result2.source).to.equal('cache');
    });
  });

  describe('setLocalSecrets', () => {
    it('should add local secrets', async () => {
      kvService.setLocalSecrets({
        'custom-secret': 'custom-value',
      });

      const result = await kvService.getSecret('custom-secret');
      expect(result.success).to.be.true;
      expect(result.value).to.equal('custom-value');
    });

    it('should merge with existing secrets', async () => {
      kvService.setLocalSecrets({
        'new-secret': 'new-value',
      });

      // Original secret should still exist
      const result1 = await kvService.getSecret(SecretNames.GITHUB_TOKEN);
      expect(result1.success).to.be.true;

      // New secret should exist
      const result2 = await kvService.getSecret('new-secret');
      expect(result2.success).to.be.true;
    });
  });

  describe('getStatus', () => {
    it('should return service status', async () => {
      const status = await kvService.getStatus();

      expect(status).to.have.property('isInitialized');
      expect(status).to.have.property('vaultUrl');
      expect(status).to.have.property('isAvailable');
      expect(status).to.have.property('cachedSecretCount');
      expect(status).to.have.property('useLocalFallback');
      expect(status.useLocalFallback).to.be.true;
    });
  });

  describe('environment variable fallback', () => {
    it('should fall back to environment variables', async () => {
      // Set environment variable
      process.env.CUSTOM_API_KEY = 'env-api-key';

      const service = new KeyVaultService({
        useLocalFallback: true,
        localSecrets: {},
      });

      const result = await service.getSecret('custom-api-key');

      expect(result.success).to.be.true;
      expect(result.value).to.equal('env-api-key');
      expect(result.source).to.equal('local');

      // Cleanup
      delete process.env.CUSTOM_API_KEY;
    });
  });
});
