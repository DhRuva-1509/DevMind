import {
  BlobServiceClient,
  ContainerClient,
  BlockBlobClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  SASProtocol,
} from '@azure/storage-blob';
import { TokenCredential } from '@azure/core-auth';
import { azureAuthService } from '../auth/auth.service';
import {
  BlobStorageConfig,
  ContainerOptions,
  BlobUploadOptions,
  BlobDownloadOptions,
  BlobListOptions,
  SasTokenOptions,
  BlobInfo,
  ContainerInfo,
  BlobOperationResult,
  BlobUploadResult,
  BlobDownloadResult,
  BlobListResult,
  SasTokenResult,
  BlobErrorCode,
  BlobServiceStatus,
} from './blob.types';
import { Readable } from 'stream';

/**
 * Azure Blob Storage Service
 */
export class BlobStorageService {
  private client: BlobServiceClient | null = null;
  private containerClients: Map<string, ContainerClient> = new Map();
  private config: Required<BlobStorageConfig>;
  private _isInitialized: boolean = false;

  private static readonly DEFAULT_CONFIG: Required<BlobStorageConfig> = {
    accountUrl: '',
    defaultContainer: 'documentation',
    enableLogging: true,
    maxSingleUploadSize: 256 * 1024 * 1024, // 256MB
    blockSize: 4 * 1024 * 1024, // 4MB
    maxConcurrency: 4,
  };

  constructor(config: BlobStorageConfig = {}) {
    this.config = { ...BlobStorageService.DEFAULT_CONFIG, ...config };

    if (!this.config.accountUrl) {
      this.config.accountUrl = process.env.AZURE_STORAGE_ACCOUNT_URL || '';
    }

    if (this.config.accountUrl) {
      this.initializeClient();
    }
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  private initializeClient(): void {
    try {
      const credential: TokenCredential = azureAuthService.getCredential();

      this.client = new BlobServiceClient(this.config.accountUrl, credential);
      this._isInitialized = true;
    } catch {
      this._isInitialized = false;
    }
  }

  private getContainerClient(containerName?: string): ContainerClient | null {
    const container = containerName || this.config.defaultContainer;

    if (!this.client) {
      return null;
    }

    if (this.containerClients.has(container)) {
      return this.containerClients.get(container)!;
    }

    const containerClient = this.client.getContainerClient(container);
    this.containerClients.set(container, containerClient);
    return containerClient;
  }

  private getBlobClient(blobName: string, containerName?: string): BlockBlobClient | null {
    const containerClient = this.getContainerClient(containerName);
    if (!containerClient) {
      return null;
    }
    return containerClient.getBlockBlobClient(blobName);
  }

  /**
   * Create a container
   */
  async createContainer(
    containerName: string,
    options: ContainerOptions = {}
  ): Promise<BlobOperationResult<ContainerInfo>> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const response = await containerClient.createIfNotExists({
        access: options.publicAccess === 'none' ? undefined : options.publicAccess,
        metadata: options.metadata,
      });

      return {
        success: true,
        data: {
          name: containerName,
          etag: response.etag,
          lastModified: response.lastModified,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Delete a container
   */
  async deleteContainer(containerName: string): Promise<BlobOperationResult> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await containerClient.deleteIfExists();
      this.containerClients.delete(containerName);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Check if container exists
   */
  async containerExists(containerName: string): Promise<boolean> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return false;
    }

    try {
      return await containerClient.exists();
    } catch {
      return false;
    }
  }

  /**
   * List all containers
   */
  async listContainers(): Promise<ContainerInfo[]> {
    if (!this.client) {
      return [];
    }

    try {
      const containers: ContainerInfo[] = [];

      for await (const container of this.client.listContainers()) {
        containers.push({
          name: container.name,
          lastModified: container.properties.lastModified,
          etag: container.properties.etag,
          publicAccess: container.properties.publicAccess,
          metadata: container.metadata,
        });
      }

      return containers;
    } catch {
      return [];
    }
  }

  /**
   * Get container properties
   */
  async getContainerProperties(containerName: string): Promise<BlobOperationResult<ContainerInfo>> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const properties = await containerClient.getProperties();

      return {
        success: true,
        data: {
          name: containerName,
          lastModified: properties.lastModified,
          etag: properties.etag,
          publicAccess: properties.blobPublicAccess,
          metadata: properties.metadata,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Set container metadata
   */
  async setContainerMetadata(
    containerName: string,
    metadata: Record<string, string>
  ): Promise<BlobOperationResult> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await containerClient.setMetadata(metadata);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }
  /**
   * Upload a blob from buffer
   */
  async uploadBlob(
    blobName: string,
    content: Buffer | string,
    options: BlobUploadOptions = {},
    containerName?: string
  ): Promise<BlobUploadResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const buffer = typeof content === 'string' ? Buffer.from(content) : content;

      const response = await blobClient.uploadData(buffer, {
        blobHTTPHeaders: {
          blobContentType: options.contentType,
          blobContentEncoding: options.contentEncoding,
          blobContentLanguage: options.contentLanguage,
          blobCacheControl: options.cacheControl,
          blobContentDisposition: options.contentDisposition,
        },
        metadata: options.metadata,
        tags: options.tags,
        tier: options.accessTier,
      });

      return {
        success: true,
        url: blobClient.url,
        etag: response.etag,
        contentMD5: response.contentMD5
          ? Buffer.from(response.contentMD5).toString('base64')
          : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Upload a blob from stream
   */
  async uploadStream(
    blobName: string,
    stream: Readable,
    contentLength: number,
    options: BlobUploadOptions = {},
    containerName?: string
  ): Promise<BlobUploadResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const response = await blobClient.uploadStream(
        stream,
        this.config.blockSize,
        this.config.maxConcurrency,
        {
          blobHTTPHeaders: {
            blobContentType: options.contentType,
            blobContentEncoding: options.contentEncoding,
            blobContentLanguage: options.contentLanguage,
            blobCacheControl: options.cacheControl,
            blobContentDisposition: options.contentDisposition,
          },
          metadata: options.metadata,
          tags: options.tags,
          tier: options.accessTier,
        }
      );

      return {
        success: true,
        url: blobClient.url,
        etag: response.etag,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Download a blob to buffer
   */
  async downloadBlob(
    blobName: string,
    options: BlobDownloadOptions = {},
    containerName?: string
  ): Promise<BlobDownloadResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const response = await blobClient.download(options.offset, options.count);

      const chunks: Buffer[] = [];
      if (response.readableStreamBody) {
        for await (const chunk of response.readableStreamBody) {
          chunks.push(Buffer.from(chunk));
        }
      }

      return {
        success: true,
        content: Buffer.concat(chunks),
        contentType: response.contentType,
        contentLength: response.contentLength,
        metadata: response.metadata,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Download blob to stream
   */
  async downloadStream(
    blobName: string,
    options: BlobDownloadOptions = {},
    containerName?: string
  ): Promise<BlobOperationResult<NodeJS.ReadableStream>> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const response = await blobClient.download(options.offset, options.count);

      if (!response.readableStreamBody) {
        return {
          success: false,
          error: 'No readable stream available',
          errorCode: BlobErrorCode.UNKNOWN_ERROR,
        };
      }

      return {
        success: true,
        data: response.readableStreamBody,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Delete a blob
   */
  async deleteBlob(blobName: string, containerName?: string): Promise<BlobOperationResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await blobClient.deleteIfExists();

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Check if blob exists
   */
  async blobExists(blobName: string, containerName?: string): Promise<boolean> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return false;
    }

    try {
      return await blobClient.exists();
    } catch {
      return false;
    }
  }

  /**
   * Get blob properties
   */
  async getBlobProperties(
    blobName: string,
    containerName?: string
  ): Promise<BlobOperationResult<BlobInfo>> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const properties = await blobClient.getProperties();

      return {
        success: true,
        data: {
          name: blobName,
          container: containerName || this.config.defaultContainer,
          url: blobClient.url,
          contentType: properties.contentType,
          contentLength: properties.contentLength,
          lastModified: properties.lastModified,
          etag: properties.etag,
          accessTier: properties.accessTier,
          metadata: properties.metadata,
          createdOn: properties.createdOn,
          blobType: properties.blobType,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Set blob metadata
   */
  async setBlobMetadata(
    blobName: string,
    metadata: Record<string, string>,
    containerName?: string
  ): Promise<BlobOperationResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await blobClient.setMetadata(metadata);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Set blob tags
   */
  async setBlobTags(
    blobName: string,
    tags: Record<string, string>,
    containerName?: string
  ): Promise<BlobOperationResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await blobClient.setTags(tags);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Get blob tags
   */
  async getBlobTags(
    blobName: string,
    containerName?: string
  ): Promise<BlobOperationResult<Record<string, string>>> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const response = await blobClient.getTags();

      return {
        success: true,
        data: response.tags,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Set blob access tier
   */
  async setBlobAccessTier(
    blobName: string,
    tier: 'Hot' | 'Cool' | 'Cold' | 'Archive',
    containerName?: string
  ): Promise<BlobOperationResult> {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await blobClient.setAccessTier(tier);

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Copy blob
   */
  async copyBlob(
    sourceBlobName: string,
    destBlobName: string,
    sourceContainer?: string,
    destContainer?: string
  ): Promise<BlobOperationResult<BlobInfo>> {
    const sourceClient = this.getBlobClient(sourceBlobName, sourceContainer);
    const destClient = this.getBlobClient(destBlobName, destContainer);

    if (!sourceClient || !destClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const copyResponse = await destClient.beginCopyFromURL(sourceClient.url);
      const result = await copyResponse.pollUntilDone();

      return {
        success: true,
        data: {
          name: destBlobName,
          container: destContainer || this.config.defaultContainer,
          url: destClient.url,
          etag: result.etag,
          lastModified: result.lastModified,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * List blobs in a container
   */
  async listBlobs(options: BlobListOptions = {}, containerName?: string): Promise<BlobListResult> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return {
        success: false,
        blobs: [],
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const blobs: BlobInfo[] = [];
      const listOptions = {
        prefix: options.prefix,
        includeMetadata: options.includeMetadata,
        includeTags: options.includeTags,
        includeDeleted: options.includeDeleted,
        includeSnapshots: options.includeSnapshots,
        includeVersions: options.includeVersions,
      };

      const iterator = containerClient
        .listBlobsFlat(listOptions)
        .byPage({ maxPageSize: options.maxPageSize || 100 });

      const page = await iterator.next();

      if (!page.done && page.value.segment.blobItems) {
        for (const blob of page.value.segment.blobItems) {
          blobs.push({
            name: blob.name,
            container: containerName || this.config.defaultContainer,
            url: `${containerClient.url}/${blob.name}`,
            contentType: blob.properties.contentType,
            contentLength: blob.properties.contentLength,
            lastModified: blob.properties.lastModified,
            etag: blob.properties.etag,
            accessTier: blob.properties.accessTier,
            metadata: blob.metadata,
            createdOn: blob.properties.createdOn,
            blobType: blob.properties.blobType,
          });
        }
      }

      return {
        success: true,
        blobs,
        continuationToken: page.value.continuationToken,
      };
    } catch (error) {
      return {
        success: false,
        blobs: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * List all blobs (handles pagination)
   */
  async listAllBlobs(
    options: BlobListOptions = {},
    containerName?: string
  ): Promise<BlobListResult> {
    const containerClient = this.getContainerClient(containerName);

    if (!containerClient) {
      return {
        success: false,
        blobs: [],
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const blobs: BlobInfo[] = [];
      const listOptions = {
        prefix: options.prefix,
        includeMetadata: options.includeMetadata,
        includeTags: options.includeTags,
        includeDeleted: options.includeDeleted,
        includeSnapshots: options.includeSnapshots,
        includeVersions: options.includeVersions,
      };

      for await (const blob of containerClient.listBlobsFlat(listOptions)) {
        blobs.push({
          name: blob.name,
          container: containerName || this.config.defaultContainer,
          url: `${containerClient.url}/${blob.name}`,
          contentType: blob.properties.contentType,
          contentLength: blob.properties.contentLength,
          lastModified: blob.properties.lastModified,
          etag: blob.properties.etag,
          accessTier: blob.properties.accessTier,
          metadata: blob.metadata,
          createdOn: blob.properties.createdOn,
          blobType: blob.properties.blobType,
        });
      }

      return {
        success: true,
        blobs,
      };
    } catch (error) {
      return {
        success: false,
        blobs: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Generate SAS token for a blob
   */
  generateSasToken(
    blobName: string,
    _options: SasTokenOptions,
    containerName?: string
  ): SasTokenResult {
    const blobClient = this.getBlobClient(blobName, containerName);

    if (!blobClient) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    return {
      success: false,
      error:
        'SAS token generation requires account key or user delegation. Use generateUserDelegationSas for AAD auth.',
      errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
    };
  }

  /**
   * Generate user delegation SAS token
   */
  async generateUserDelegationSas(
    blobName: string,
    options: SasTokenOptions,
    containerName?: string
  ): Promise<SasTokenResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Blob service not initialized',
        errorCode: BlobErrorCode.AUTHENTICATION_ERROR,
      };
    }

    const container = containerName || this.config.defaultContainer;
    const startsOn = options.startsOn || new Date();
    const expiresOn = new Date(startsOn.getTime() + options.expiresInMinutes * 60 * 1000);

    try {
      // Get user delegation key
      const userDelegationKey = await this.client.getUserDelegationKey(startsOn, expiresOn);

      const permissions = BlobSASPermissions.parse(options.permissions);

      const sasParams = generateBlobSASQueryParameters(
        {
          containerName: container,
          blobName,
          permissions,
          startsOn,
          expiresOn,
          ipRange: options.ipRange ? { start: options.ipRange } : undefined,
          protocol: options.protocol === 'https' ? SASProtocol.Https : SASProtocol.HttpsAndHttp,
          contentType: options.contentType,
          contentDisposition: options.contentDisposition,
        },
        userDelegationKey,
        this.getAccountName()
      );

      const blobClient = this.getBlobClient(blobName, containerName);
      const sasUrl = `${blobClient?.url}?${sasParams.toString()}`;

      return {
        success: true,
        token: sasParams.toString(),
        url: sasUrl,
        expiresOn,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  /**
   * Get account name from URL
   */
  private getAccountName(): string {
    try {
      const url = new URL(this.config.accountUrl);
      return url.hostname.split('.')[0];
    } catch {
      return '';
    }
  }
  /**
   * Get blob URL
   */
  getBlobUrl(blobName: string, containerName?: string): string | null {
    const blobClient = this.getBlobClient(blobName, containerName);
    return blobClient?.url || null;
  }

  /**
   * Get container URL
   */
  getContainerUrl(containerName?: string): string | null {
    const containerClient = this.getContainerClient(containerName);
    return containerClient?.url || null;
  }

  private getErrorCode(error: unknown): BlobErrorCode {
    const err = error as Error & { statusCode?: number; code?: string };
    const statusCode = err?.statusCode;
    const code = err?.code;

    if (statusCode === 404 || code === 'BlobNotFound' || code === 'ContainerNotFound') {
      return BlobErrorCode.NOT_FOUND;
    }

    if (statusCode === 409 || code === 'ContainerAlreadyExists' || code === 'BlobAlreadyExists') {
      return BlobErrorCode.ALREADY_EXISTS;
    }

    if (statusCode === 403 || code === 'AuthorizationFailure') {
      return BlobErrorCode.ACCESS_DENIED;
    }

    if (statusCode === 401) {
      return BlobErrorCode.AUTHENTICATION_ERROR;
    }

    if (statusCode === 400) {
      return BlobErrorCode.INVALID_INPUT;
    }

    if (statusCode === 503) {
      return BlobErrorCode.SERVICE_UNAVAILABLE;
    }

    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
      return BlobErrorCode.TIMEOUT;
    }

    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
      return BlobErrorCode.NETWORK_ERROR;
    }

    return BlobErrorCode.UNKNOWN_ERROR;
  }

  private getErrorMessage(error: unknown): string {
    const err = error as Error;
    return err?.message || 'Unknown error occurred';
  }

  getStatus(): BlobServiceStatus {
    return {
      isInitialized: this._isInitialized,
      accountUrl: this.config.accountUrl,
      defaultContainer: this.config.defaultContainer,
      enableLogging: this.config.enableLogging,
    };
  }
}

// Export singleton instance
export const blobStorageService = new BlobStorageService();
