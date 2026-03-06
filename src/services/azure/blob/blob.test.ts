// src/services/azure/blob/blob.test.ts

import { expect } from 'chai';
import * as sinon from 'sinon';
import { Readable } from 'stream';
import { BlobStorageService } from './blob.service';
import { BlobErrorCode, StorageContainers, ContentTypes } from './blob.types';

describe('BlobStorageService', () => {
  let blobService: BlobStorageService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    blobService = new BlobStorageService({
      accountUrl: '',
      defaultContainer: 'test-container',
      enableLogging: true,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const service = new BlobStorageService();
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should create instance with custom config', () => {
      const service = new BlobStorageService({
        accountUrl: 'https://teststorage.blob.core.windows.net',
        defaultContainer: 'custom-container',
        enableLogging: false,
        maxConcurrency: 8,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should not be initialized without account URL', () => {
      const service = new BlobStorageService({ accountUrl: '' });
      expect(service.isInitialized).to.be.false;
    });

    it('should use default container when not provided', () => {
      const service = new BlobStorageService({ accountUrl: '' });
      const status = service.getStatus();
      expect(status.defaultContainer).to.equal('documentation');
    });

    it('should use custom container when provided', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        defaultContainer: 'my-container',
      });
      const status = service.getStatus();
      expect(status.defaultContainer).to.equal('my-container');
    });

    it('should accept max single upload size config', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        maxSingleUploadSize: 512 * 1024 * 1024,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should accept block size config', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        blockSize: 8 * 1024 * 1024,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should accept max concurrency config', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        maxConcurrency: 8,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should accept all config options together', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        defaultContainer: 'custom',
        enableLogging: true,
        maxSingleUploadSize: 100 * 1024 * 1024,
        blockSize: 8 * 1024 * 1024,
        maxConcurrency: 8,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });
  });

  describe('getStatus', () => {
    it('should return service status object', () => {
      const status = blobService.getStatus();

      expect(status).to.have.property('isInitialized');
      expect(status).to.have.property('accountUrl');
      expect(status).to.have.property('defaultContainer');
      expect(status).to.have.property('enableLogging');
    });

    it('should show correct default container', () => {
      const status = blobService.getStatus();
      expect(status.defaultContainer).to.equal('test-container');
    });

    it('should show logging enabled', () => {
      const status = blobService.getStatus();
      expect(status.enableLogging).to.be.true;
    });

    it('should show not initialized when no account URL', () => {
      const status = blobService.getStatus();
      expect(status.isInitialized).to.be.false;
    });

    it('should show empty account URL when not set', () => {
      const status = blobService.getStatus();
      expect(status.accountUrl).to.equal('');
    });

    it('should allow disabling logging', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        enableLogging: false,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.false;
    });
  });

  describe('createContainer', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.createContainer('new-container');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
      expect(result.error).to.equal('Blob service not initialized');
    });

    it('should accept container options with blob public access', async () => {
      const result = await blobService.createContainer('new-container', {
        publicAccess: 'blob',
      });

      expect(result.success).to.be.false;
    });

    it('should accept container options with container public access', async () => {
      const result = await blobService.createContainer('new-container', {
        publicAccess: 'container',
      });

      expect(result.success).to.be.false;
    });

    it('should accept container options with no public access', async () => {
      const result = await blobService.createContainer('new-container', {
        publicAccess: 'none',
      });

      expect(result.success).to.be.false;
    });

    it('should accept container options with metadata', async () => {
      const result = await blobService.createContainer('new-container', {
        metadata: { purpose: 'testing', owner: 'devmind' },
      });

      expect(result.success).to.be.false;
    });

    it('should accept container options with all options', async () => {
      const result = await blobService.createContainer('new-container', {
        publicAccess: 'none',
        metadata: { key: 'value' },
      });

      expect(result.success).to.be.false;
    });
  });

  describe('deleteContainer', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.deleteContainer('test-container');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept any container name', async () => {
      const result = await blobService.deleteContainer('any-container');

      expect(result.success).to.be.false;
    });
  });

  describe('containerExists', () => {
    it('should return false when service not initialized', async () => {
      const exists = await blobService.containerExists('test-container');
      expect(exists).to.be.false;
    });

    it('should handle any container name', async () => {
      const exists = await blobService.containerExists('non-existent');
      expect(exists).to.be.false;
    });
  });

  describe('listContainers', () => {
    it('should return empty array when service not initialized', async () => {
      const containers = await blobService.listContainers();
      expect(containers).to.be.an('array').that.is.empty;
    });
  });

  describe('getContainerProperties', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.getContainerProperties('test-container');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept any container name', async () => {
      const result = await blobService.getContainerProperties('any-container');

      expect(result.success).to.be.false;
    });
  });

  describe('setContainerMetadata', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.setContainerMetadata('test-container', {
        key: 'value',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept multiple metadata entries', async () => {
      const result = await blobService.setContainerMetadata('test-container', {
        key1: 'value1',
        key2: 'value2',
        key3: 'value3',
      });

      expect(result.success).to.be.false;
    });
  });

  describe('uploadBlob', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.uploadBlob('test.txt', Buffer.from('Hello World'));

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
      expect(result.error).to.equal('Blob service not initialized');
    });

    it('should accept string content', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello World');

      expect(result.success).to.be.false;
    });

    it('should accept buffer content', async () => {
      const result = await blobService.uploadBlob(
        'test.bin',
        Buffer.from([0x00, 0x01, 0x02, 0x03])
      );

      expect(result.success).to.be.false;
    });

    it('should accept empty string content', async () => {
      const result = await blobService.uploadBlob('empty.txt', '');

      expect(result.success).to.be.false;
    });

    it('should accept empty buffer content', async () => {
      const result = await blobService.uploadBlob('empty.bin', Buffer.alloc(0));

      expect(result.success).to.be.false;
    });

    it('should accept upload options with content type', async () => {
      const result = await blobService.uploadBlob('test.json', '{"key": "value"}', {
        contentType: 'application/json',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with content encoding', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        contentEncoding: 'gzip',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with content language', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        contentLanguage: 'en-US',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with cache control', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        cacheControl: 'max-age=3600',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with content disposition', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        contentDisposition: 'attachment; filename="download.txt"',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with metadata', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        metadata: { author: 'test', version: '1.0' },
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with tags', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        tags: { category: 'docs', priority: 'high' },
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with Hot access tier', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        accessTier: 'Hot',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with Cool access tier', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        accessTier: 'Cool',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with Cold access tier', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        accessTier: 'Cold',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with Archive access tier', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        accessTier: 'Archive',
      });

      expect(result.success).to.be.false;
    });

    it('should accept upload options with overwrite flag', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        overwrite: true,
      });

      expect(result.success).to.be.false;
    });

    it('should accept all upload options together', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {
        contentType: 'text/plain',
        contentEncoding: 'utf-8',
        contentLanguage: 'en',
        cacheControl: 'no-cache',
        contentDisposition: 'inline',
        metadata: { key: 'value' },
        tags: { tag: 'value' },
        accessTier: 'Hot',
        overwrite: true,
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.uploadBlob('test.txt', 'Hello', {}, 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('uploadStream', () => {
    it('should return error when service not initialized', async () => {
      const stream = Readable.from(['Hello', 'World']);

      const result = await blobService.uploadStream('test.txt', stream, 10);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept stream with content type option', async () => {
      const stream = Readable.from(['Hello']);

      const result = await blobService.uploadStream('test.txt', stream, 5, {
        contentType: 'text/plain',
      });

      expect(result.success).to.be.false;
    });

    it('should accept stream with metadata option', async () => {
      const stream = Readable.from(['data']);

      const result = await blobService.uploadStream('test.txt', stream, 4, {
        metadata: { source: 'stream' },
      });

      expect(result.success).to.be.false;
    });

    it('should accept stream with custom container', async () => {
      const stream = Readable.from(['test']);

      const result = await blobService.uploadStream('test.txt', stream, 4, {}, 'other-container');

      expect(result.success).to.be.false;
    });

    it('should accept stream with all options', async () => {
      const stream = Readable.from(['test']);

      const result = await blobService.uploadStream('test.txt', stream, 4, {
        contentType: 'text/plain',
        metadata: { key: 'value' },
        tags: { tag: 'value' },
        accessTier: 'Cool',
      });

      expect(result.success).to.be.false;
    });
  });

  describe('downloadBlob', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.downloadBlob('test.txt');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept download options with offset', async () => {
      const result = await blobService.downloadBlob('test.txt', {
        offset: 100,
      });

      expect(result.success).to.be.false;
    });

    it('should accept download options with count', async () => {
      const result = await blobService.downloadBlob('test.txt', {
        count: 1024,
      });

      expect(result.success).to.be.false;
    });

    it('should accept download options with offset and count', async () => {
      const result = await blobService.downloadBlob('test.txt', {
        offset: 100,
        count: 500,
      });

      expect(result.success).to.be.false;
    });

    it('should accept zero offset', async () => {
      const result = await blobService.downloadBlob('test.txt', {
        offset: 0,
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.downloadBlob('test.txt', {}, 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('downloadStream', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.downloadStream('test.txt');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept download options with offset', async () => {
      const result = await blobService.downloadStream('test.txt', {
        offset: 0,
      });

      expect(result.success).to.be.false;
    });

    it('should accept download options with count', async () => {
      const result = await blobService.downloadStream('test.txt', {
        count: 1024,
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.downloadStream('test.txt', {}, 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('deleteBlob', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.deleteBlob('test.txt');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept any blob name', async () => {
      const result = await blobService.deleteBlob('any-blob.txt');

      expect(result.success).to.be.false;
    });

    it('should accept blob name with path', async () => {
      const result = await blobService.deleteBlob('folder/subfolder/file.txt');

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.deleteBlob('test.txt', 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('blobExists', () => {
    it('should return false when service not initialized', async () => {
      const exists = await blobService.blobExists('test.txt');
      expect(exists).to.be.false;
    });

    it('should handle any blob name', async () => {
      const exists = await blobService.blobExists('non-existent.txt');
      expect(exists).to.be.false;
    });

    it('should accept custom container name', async () => {
      const exists = await blobService.blobExists('test.txt', 'other-container');
      expect(exists).to.be.false;
    });
  });

  describe('getBlobProperties', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.getBlobProperties('test.txt');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept any blob name', async () => {
      const result = await blobService.getBlobProperties('any-blob.txt');

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.getBlobProperties('test.txt', 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('setBlobMetadata', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.setBlobMetadata('test.txt', {
        key: 'value',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept single metadata entry', async () => {
      const result = await blobService.setBlobMetadata('test.txt', {
        author: 'test',
      });

      expect(result.success).to.be.false;
    });

    it('should accept multiple metadata entries', async () => {
      const result = await blobService.setBlobMetadata('test.txt', {
        author: 'test',
        version: '1.0',
        category: 'docs',
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.setBlobMetadata(
        'test.txt',
        { key: 'value' },
        'other-container'
      );

      expect(result.success).to.be.false;
    });
  });

  describe('setBlobTags', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.setBlobTags('test.txt', {
        category: 'docs',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept single tag', async () => {
      const result = await blobService.setBlobTags('test.txt', {
        priority: 'high',
      });

      expect(result.success).to.be.false;
    });

    it('should accept multiple tags', async () => {
      const result = await blobService.setBlobTags('test.txt', {
        category: 'docs',
        priority: 'high',
        status: 'active',
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.setBlobTags('test.txt', { key: 'value' }, 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('getBlobTags', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.getBlobTags('test.txt');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept custom container name', async () => {
      const result = await blobService.getBlobTags('test.txt', 'other-container');

      expect(result.success).to.be.false;
    });
  });

  describe('setBlobAccessTier', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.setBlobAccessTier('test.txt', 'Cool');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept Hot tier', async () => {
      const result = await blobService.setBlobAccessTier('test.txt', 'Hot');
      expect(result.success).to.be.false;
    });

    it('should accept Cool tier', async () => {
      const result = await blobService.setBlobAccessTier('test.txt', 'Cool');
      expect(result.success).to.be.false;
    });

    it('should accept Cold tier', async () => {
      const result = await blobService.setBlobAccessTier('test.txt', 'Cold');
      expect(result.success).to.be.false;
    });

    it('should accept Archive tier', async () => {
      const result = await blobService.setBlobAccessTier('test.txt', 'Archive');
      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.setBlobAccessTier('test.txt', 'Cool', 'other-container');
      expect(result.success).to.be.false;
    });
  });

  describe('copyBlob', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.copyBlob('source.txt', 'dest.txt');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept same container copy', async () => {
      const result = await blobService.copyBlob('source.txt', 'dest.txt');

      expect(result.success).to.be.false;
    });

    it('should accept cross container copy', async () => {
      const result = await blobService.copyBlob(
        'source.txt',
        'dest.txt',
        'source-container',
        'dest-container'
      );

      expect(result.success).to.be.false;
    });

    it('should accept source container only', async () => {
      const result = await blobService.copyBlob('source.txt', 'dest.txt', 'source-container');

      expect(result.success).to.be.false;
    });
  });

  describe('listBlobs', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.listBlobs();

      expect(result.success).to.be.false;
      expect(result.blobs).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept prefix option', async () => {
      const result = await blobService.listBlobs({ prefix: 'docs/' });
      expect(result.success).to.be.false;
    });

    it('should accept maxPageSize option', async () => {
      const result = await blobService.listBlobs({ maxPageSize: 50 });
      expect(result.success).to.be.false;
    });

    it('should accept includeMetadata option', async () => {
      const result = await blobService.listBlobs({ includeMetadata: true });
      expect(result.success).to.be.false;
    });

    it('should accept includeTags option', async () => {
      const result = await blobService.listBlobs({ includeTags: true });
      expect(result.success).to.be.false;
    });

    it('should accept includeDeleted option', async () => {
      const result = await blobService.listBlobs({ includeDeleted: true });
      expect(result.success).to.be.false;
    });

    it('should accept includeSnapshots option', async () => {
      const result = await blobService.listBlobs({ includeSnapshots: true });
      expect(result.success).to.be.false;
    });

    it('should accept includeVersions option', async () => {
      const result = await blobService.listBlobs({ includeVersions: true });
      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.listBlobs({}, 'other-container');
      expect(result.success).to.be.false;
    });

    it('should accept all options together', async () => {
      const result = await blobService.listBlobs({
        prefix: 'docs/',
        maxPageSize: 100,
        includeMetadata: true,
        includeTags: true,
        includeDeleted: false,
        includeSnapshots: false,
        includeVersions: false,
      });
      expect(result.success).to.be.false;
    });
  });

  describe('listAllBlobs', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.listAllBlobs();

      expect(result.success).to.be.false;
      expect(result.blobs).to.be.an('array').that.is.empty;
    });

    it('should accept prefix option', async () => {
      const result = await blobService.listAllBlobs({ prefix: 'docs/' });
      expect(result.success).to.be.false;
    });

    it('should accept includeMetadata option', async () => {
      const result = await blobService.listAllBlobs({ includeMetadata: true });
      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.listAllBlobs({}, 'other-container');
      expect(result.success).to.be.false;
    });
  });

  describe('generateSasToken', () => {
    it('should return error when service not initialized', () => {
      const result = blobService.generateSasToken('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });
  });

  describe('generateUserDelegationSas', () => {
    it('should return error when service not initialized', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(BlobErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept read permission', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
      });
      expect(result.success).to.be.false;
    });

    it('should accept write permission', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'w',
        expiresInMinutes: 30,
      });
      expect(result.success).to.be.false;
    });

    it('should accept delete permission', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'd',
        expiresInMinutes: 30,
      });
      expect(result.success).to.be.false;
    });

    it('should accept multiple permissions', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'rwd',
        expiresInMinutes: 120,
      });
      expect(result.success).to.be.false;
    });

    it('should accept custom start time', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
        startsOn: new Date(),
      });
      expect(result.success).to.be.false;
    });

    it('should accept https protocol', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
        protocol: 'https',
      });
      expect(result.success).to.be.false;
    });

    it('should accept https,http protocol', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
        protocol: 'https,http',
      });
      expect(result.success).to.be.false;
    });

    it('should accept content type override', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
        contentType: 'application/pdf',
      });
      expect(result.success).to.be.false;
    });

    it('should accept content disposition override', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
        contentDisposition: 'attachment; filename="download.txt"',
      });
      expect(result.success).to.be.false;
    });

    it('should accept IP range', async () => {
      const result = await blobService.generateUserDelegationSas('test.txt', {
        permissions: 'r',
        expiresInMinutes: 60,
        ipRange: '192.168.1.1',
      });
      expect(result.success).to.be.false;
    });

    it('should accept custom container name', async () => {
      const result = await blobService.generateUserDelegationSas(
        'test.txt',
        {
          permissions: 'r',
          expiresInMinutes: 60,
        },
        'other-container'
      );
      expect(result.success).to.be.false;
    });
  });

  // ============================================================
  // UTILITY METHODS TESTS
  // ============================================================

  describe('getBlobUrl', () => {
    it('should return null when service not initialized', () => {
      const url = blobService.getBlobUrl('test.txt');
      expect(url).to.be.null;
    });

    it('should accept custom container', () => {
      const url = blobService.getBlobUrl('test.txt', 'other-container');
      expect(url).to.be.null;
    });
  });

  describe('getContainerUrl', () => {
    it('should return null when service not initialized', () => {
      const url = blobService.getContainerUrl();
      expect(url).to.be.null;
    });

    it('should accept custom container', () => {
      const url = blobService.getContainerUrl('other-container');
      expect(url).to.be.null;
    });
  });

  describe('StorageContainers', () => {
    describe('DOCUMENTATION', () => {
      it('should have correct name', () => {
        expect(StorageContainers.DOCUMENTATION.name).to.equal('documentation');
      });

      it('should have no public access', () => {
        expect(StorageContainers.DOCUMENTATION.publicAccess).to.equal('none');
      });
    });

    describe('UPLOADS', () => {
      it('should have correct name', () => {
        expect(StorageContainers.UPLOADS.name).to.equal('uploads');
      });

      it('should have no public access', () => {
        expect(StorageContainers.UPLOADS.publicAccess).to.equal('none');
      });
    });

    describe('CACHE', () => {
      it('should have correct name', () => {
        expect(StorageContainers.CACHE.name).to.equal('cache');
      });

      it('should have no public access', () => {
        expect(StorageContainers.CACHE.publicAccess).to.equal('none');
      });
    });

    describe('EMBEDDINGS', () => {
      it('should have correct name', () => {
        expect(StorageContainers.EMBEDDINGS.name).to.equal('embeddings');
      });

      it('should have no public access', () => {
        expect(StorageContainers.EMBEDDINGS.publicAccess).to.equal('none');
      });
    });

    describe('TEMP', () => {
      it('should have correct name', () => {
        expect(StorageContainers.TEMP.name).to.equal('temp');
      });

      it('should have no public access', () => {
        expect(StorageContainers.TEMP.publicAccess).to.equal('none');
      });
    });
  });

  describe('ContentTypes', () => {
    it('should have PDF content type', () => {
      expect(ContentTypes.PDF).to.equal('application/pdf');
    });

    it('should have JSON content type', () => {
      expect(ContentTypes.JSON).to.equal('application/json');
    });

    it('should have HTML content type', () => {
      expect(ContentTypes.HTML).to.equal('text/html');
    });

    it('should have TEXT content type', () => {
      expect(ContentTypes.TEXT).to.equal('text/plain');
    });

    it('should have MARKDOWN content type', () => {
      expect(ContentTypes.MARKDOWN).to.equal('text/markdown');
    });

    it('should have CSV content type', () => {
      expect(ContentTypes.CSV).to.equal('text/csv');
    });

    it('should have XML content type', () => {
      expect(ContentTypes.XML).to.equal('application/xml');
    });

    it('should have ZIP content type', () => {
      expect(ContentTypes.ZIP).to.equal('application/zip');
    });

    it('should have GZIP content type', () => {
      expect(ContentTypes.GZIP).to.equal('application/gzip');
    });

    it('should have PNG content type', () => {
      expect(ContentTypes.PNG).to.equal('image/png');
    });

    it('should have JPEG content type', () => {
      expect(ContentTypes.JPEG).to.equal('image/jpeg');
    });

    it('should have BINARY content type', () => {
      expect(ContentTypes.BINARY).to.equal('application/octet-stream');
    });
  });

  describe('BlobErrorCode', () => {
    it('should have NOT_FOUND', () => {
      expect(BlobErrorCode.NOT_FOUND).to.equal('NOT_FOUND');
    });

    it('should have ALREADY_EXISTS', () => {
      expect(BlobErrorCode.ALREADY_EXISTS).to.equal('ALREADY_EXISTS');
    });

    it('should have ACCESS_DENIED', () => {
      expect(BlobErrorCode.ACCESS_DENIED).to.equal('ACCESS_DENIED');
    });

    it('should have INVALID_INPUT', () => {
      expect(BlobErrorCode.INVALID_INPUT).to.equal('INVALID_INPUT');
    });

    it('should have QUOTA_EXCEEDED', () => {
      expect(BlobErrorCode.QUOTA_EXCEEDED).to.equal('QUOTA_EXCEEDED');
    });

    it('should have SERVICE_UNAVAILABLE', () => {
      expect(BlobErrorCode.SERVICE_UNAVAILABLE).to.equal('SERVICE_UNAVAILABLE');
    });

    it('should have TIMEOUT', () => {
      expect(BlobErrorCode.TIMEOUT).to.equal('TIMEOUT');
    });

    it('should have AUTHENTICATION_ERROR', () => {
      expect(BlobErrorCode.AUTHENTICATION_ERROR).to.equal('AUTHENTICATION_ERROR');
    });

    it('should have NETWORK_ERROR', () => {
      expect(BlobErrorCode.NETWORK_ERROR).to.equal('NETWORK_ERROR');
    });

    it('should have UNKNOWN_ERROR', () => {
      expect(BlobErrorCode.UNKNOWN_ERROR).to.equal('UNKNOWN_ERROR');
    });
  });

  describe('configuration', () => {
    it('should use default account URL from environment', () => {
      const originalEnv = process.env.AZURE_STORAGE_ACCOUNT_URL;
      process.env.AZURE_STORAGE_ACCOUNT_URL = '';

      const service = new BlobStorageService();
      const status = service.getStatus();
      expect(status.accountUrl).to.equal('');

      process.env.AZURE_STORAGE_ACCOUNT_URL = originalEnv;
    });

    it('should use custom account URL when provided', () => {
      const service = new BlobStorageService({
        accountUrl: 'https://custom.blob.core.windows.net',
      });
      const status = service.getStatus();
      expect(status.accountUrl).to.equal('https://custom.blob.core.windows.net');
    });

    it('should allow custom max single upload size', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        maxSingleUploadSize: 100 * 1024 * 1024,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should allow custom block size', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        blockSize: 8 * 1024 * 1024,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should allow custom max concurrency', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        maxConcurrency: 8,
      });
      expect(service).to.be.instanceOf(BlobStorageService);
    });

    it('should allow disabling logging', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        enableLogging: false,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.false;
    });

    it('should allow enabling logging', () => {
      const service = new BlobStorageService({
        accountUrl: '',
        enableLogging: true,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.true;
    });
  });
});
