import { expect } from 'chai';
import * as sinon from 'sinon';
import { AzureAuthService } from './auth.service';
import { AzureScopes, AuthErrorCode } from '../auth/auth.types';

describe('AzureAuthService', () => {
  let authService: AzureAuthService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    authService = new AzureAuthService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      expect(authService).to.be.instanceOf(AzureAuthService);
    });

    it('should create instance with custom config', () => {
      const customService = new AzureAuthService({
        tenantId: 'test-tenant',
        clientId: 'test-client',
        enabledCaching: false,
        refreshThresholdMinutes: 10,
      });
      expect(customService).to.be.instanceOf(AzureAuthService);
    });
  });

  describe('getCredential', () => {
    it('should return a TokenCredential', () => {
      const credential = authService.getCredential();
      expect(credential).to.have.property('getToken');
    });
  });

  describe('getToken', () => {
    it('should return success with valid token', async () => {
      const mockToken = {
        token: 'mock-access-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      // Stub the credential's getToken method
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').resolves(mockToken);

      const result = await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.true;
      expect(result.accessToken).to.equal('mock-access-token');
      expect(result.expiresOn).to.be.instanceOf(Date);
    });

    it('should return cached token on second call', async () => {
      const mockToken = {
        token: 'mock-access-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = authService.getCredential();
      const getTokenStub = sandbox.stub(credential, 'getToken').resolves(mockToken);

      // First call
      await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      // Second call - should use cache
      const result = await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.true;
      expect(getTokenStub.calledOnce).to.be.true; // Only called once due to caching
    });

    it('should handle authentication error', async () => {
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').rejects(new Error('Not logged in. Run az login'));

      const result = await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(AuthErrorCode.NOT_LOGGED_IN);
      expect(result.error).to.include('az login');
    });

    it('should handle network error', async () => {
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').rejects(new Error('Network error'));

      const result = await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(AuthErrorCode.NETWORK_ERROR);
    });

    it('should handle token expired error', async () => {
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').rejects(new Error('Token expired'));

      const result = await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(AuthErrorCode.TOKEN_EXPIRED);
    });

    it('should handle unknown error', async () => {
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').rejects(new Error('Something went wrong'));

      const result = await authService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(AuthErrorCode.UNKNOWN_ERROR);
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when authenticated', async () => {
      const mockToken = {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').resolves(mockToken);

      const isAuth = await authService.isAuthenticated();

      expect(isAuth).to.be.true;
    });

    it('should return false when not authenticated', async () => {
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').rejects(new Error('Not logged in'));

      const isAuth = await authService.isAuthenticated();

      expect(isAuth).to.be.false;
    });
  });

  describe('initialize', () => {
    it('should initialize successfully with valid credentials', async () => {
      const mockToken = {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').resolves(mockToken);

      const result = await authService.initialize();

      expect(result.success).to.be.true;
      expect(authService.isInitialized).to.be.true;
    });

    it('should fail initialization with invalid credentials', async () => {
      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').rejects(new Error('Not logged in'));

      const result = await authService.initialize();

      expect(result.success).to.be.false;
      expect(authService.isInitialized).to.be.false;
    });
  });

  describe('clearCache', () => {
    it('should clear all cached tokens', async () => {
      const mockToken = {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = authService.getCredential();
      const getTokenStub = sandbox.stub(credential, 'getToken').resolves(mockToken);

      // Cache a token
      await authService.getToken(AzureScopes.COGNITIVE_SERVICES);
      expect(getTokenStub.calledOnce).to.be.true;

      // Clear cache
      authService.clearCache();

      // Next call should fetch new token
      await authService.getToken(AzureScopes.COGNITIVE_SERVICES);
      expect(getTokenStub.calledTwice).to.be.true;
    });
  });

  describe('getAuthStatus', () => {
    it('should return auth status info', async () => {
      const mockToken = {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = authService.getCredential();
      sandbox.stub(credential, 'getToken').resolves(mockToken);

      const status = await authService.getAuthStatus();

      expect(status.isAuthenticated).to.be.true;
      expect(status.credentialType).to.equal('DefaultAzureCredential');
      expect(status.cachedTokenCount).to.be.a('number');
    });
  });

  describe('caching behavior', () => {
    it('should not cache when caching is disabled', async () => {
      const noCacheService = new AzureAuthService({ enabledCaching: false });
      const mockToken = {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = noCacheService.getCredential();
      const getTokenStub = sandbox.stub(credential, 'getToken').resolves(mockToken);

      await noCacheService.getToken(AzureScopes.COGNITIVE_SERVICES);
      await noCacheService.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(getTokenStub.calledTwice).to.be.true;
    });

    it('should refresh token before expiry based on threshold', async () => {
      const service = new AzureAuthService({ refreshThresholdMinutes: 10 });

      // Token expires in 5 minutes (less than 10 minute threshold)
      const almostExpiredToken = {
        token: 'almost-expired',
        expiresOnTimestamp: Date.now() + 5 * 60 * 1000,
      };
      const freshToken = {
        token: 'fresh-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = service.getCredential();
      const getTokenStub = sandbox.stub(credential, 'getToken');

      getTokenStub.onFirstCall().resolves(almostExpiredToken);
      getTokenStub.onSecondCall().resolves(freshToken);

      // First call
      await service.getToken(AzureScopes.COGNITIVE_SERVICES);

      // Second call - should fetch new token since cached one is within threshold
      const result = await service.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(getTokenStub.calledTwice).to.be.true;
      expect(result.accessToken).to.equal('fresh-token');
    });
  });

  describe('retry behavior', () => {
    it('should retry on transient errors', async () => {
      const service = new AzureAuthService({
        maxRetryAttempts: 3,
        retryDelayMs: 10, // Short delay for tests
      });

      const mockToken = {
        token: 'mock-token',
        expiresOnTimestamp: Date.now() + 3600000,
      };

      const credential = service.getCredential();
      const getTokenStub = sandbox.stub(credential, 'getToken');

      // Fail twice, succeed on third attempt
      getTokenStub.onFirstCall().rejects(new Error('Temporary error'));
      getTokenStub.onSecondCall().rejects(new Error('Temporary error'));
      getTokenStub.onThirdCall().resolves(mockToken);

      const result = await service.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.true;
      expect(getTokenStub.calledThrice).to.be.true;
    });

    it('should not retry on non-retryable errors', async () => {
      const service = new AzureAuthService({
        maxRetryAttempts: 3,
        retryDelayMs: 10,
      });

      const credential = service.getCredential();
      const getTokenStub = sandbox.stub(credential, 'getToken');

      // Non-retryable error
      getTokenStub.rejects(new Error('Not logged in'));

      const result = await service.getToken(AzureScopes.COGNITIVE_SERVICES);

      expect(result.success).to.be.false;
      expect(getTokenStub.calledOnce).to.be.true; // Only one attempt
    });
  });
});
