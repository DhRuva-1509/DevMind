// src/services/azure/blob/blob.types.ts

/**
 * Azure Blob Storage Service Configuration
 */
export interface BlobStorageConfig {
  accountUrl?: string;
  defaultContainer?: string;
  enableLogging?: boolean;
  maxSingleUploadSize?: number;
  blockSize?: number;
  maxConcurrency?: number;
}

/**
 * Container configuration
 */
export interface ContainerOptions {
  publicAccess?: 'blob' | 'container' | 'none';
  metadata?: Record<string, string>;
}

/**
 * Blob upload options
 */
export interface BlobUploadOptions {
  contentType?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  cacheControl?: string;
  contentDisposition?: string;
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
  accessTier?: BlobAccessTier;
  overwrite?: boolean;
}

/**
 * Blob download options
 */
export interface BlobDownloadOptions {
  offset?: number;
  count?: number;
}

/**
 * Blob list options
 */
export interface BlobListOptions {
  prefix?: string;
  maxPageSize?: number; // Fixed: was missing semicolon
  includeMetadata?: boolean;
  includeTags?: boolean;
  includeDeleted?: boolean;
  includeSnapshots?: boolean;
  includeVersions?: boolean;
}

/**
 * SAS token options
 */
export interface SasTokenOptions {
  permissions: string;
  expiresInMinutes: number;
  startsOn?: Date;
  ipRange?: string;
  protocol?: 'https' | 'https,http';
  contentType?: string;
  contentDisposition?: string;
}

/**
 * Blob access tiers
 */
export type BlobAccessTier = 'Hot' | 'Cool' | 'Cold' | 'Archive';

/**
 * Blob info
 */
export interface BlobInfo {
  name: string;
  container: string;
  url: string;
  contentType?: string;
  contentLength?: number;
  lastModified?: Date;
  etag?: string;
  accessTier?: string;
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
  createdOn?: Date;
  blobType?: string;
}

/**
 * Container info
 */
export interface ContainerInfo {
  name: string;
  lastModified?: Date;
  etag?: string;
  publicAccess?: string;
  metadata?: Record<string, string>;
}

/**
 * Operation result
 */
export interface BlobOperationResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  errorCode?: BlobErrorCode;
}

/**
 * Upload result
 */
export interface BlobUploadResult {
  success: boolean;
  url?: string;
  etag?: string;
  contentMD5?: string;
  error?: string;
  errorCode?: BlobErrorCode;
}

/**
 * Download result
 */
export interface BlobDownloadResult {
  success: boolean;
  content?: Buffer;
  contentType?: string;
  contentLength?: number;
  metadata?: Record<string, string>;
  error?: string;
  errorCode?: BlobErrorCode;
}

/**
 * List result
 */
export interface BlobListResult {
  success: boolean;
  blobs: BlobInfo[];
  continuationToken?: string;
  error?: string;
  errorCode?: BlobErrorCode;
}

/**
 * SAS token result
 */
export interface SasTokenResult {
  success: boolean;
  token?: string;
  url?: string;
  expiresOn?: Date;
  error?: string;
  errorCode?: BlobErrorCode;
}

/**
 * Error codes
 */
export enum BlobErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  ALREADY_EXISTS = 'ALREADY_EXISTS',
  ACCESS_DENIED = 'ACCESS_DENIED',
  INVALID_INPUT = 'INVALID_INPUT',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Service status
 */
export interface BlobServiceStatus {
  isInitialized: boolean;
  accountUrl: string;
  defaultContainer: string;
  enableLogging: boolean;
}

/**
 * Predefined container configurations
 */
export const StorageContainers = {
  DOCUMENTATION: {
    name: 'documentation',
    publicAccess: 'none' as const,
  },

  UPLOADS: {
    name: 'uploads',
    publicAccess: 'none' as const,
  },

  CACHE: {
    name: 'cache',
    publicAccess: 'none' as const,
  },

  EMBEDDINGS: {
    name: 'embeddings',
    publicAccess: 'none' as const,
  },

  TEMP: {
    name: 'temp',
    publicAccess: 'none' as const,
  },
} as const;

/**
 * Content types for common file types
 */
export const ContentTypes = {
  PDF: 'application/pdf',
  JSON: 'application/json',
  HTML: 'text/html',
  TEXT: 'text/plain',
  MARKDOWN: 'text/markdown',
  CSV: 'text/csv',
  XML: 'application/xml',
  ZIP: 'application/zip',
  GZIP: 'application/gzip',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  BINARY: 'application/octet-stream',
} as const;
