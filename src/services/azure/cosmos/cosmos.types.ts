// src/services/azure/cosmos/cosmos.types.ts

/**
 * Azure Cosmos DB Service Configuration
 */
export interface CosmosConfig {
  endpoint?: string;
  databaseName?: string;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  enableLogging?: boolean;
  maxRetryAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Container configuration
 */
export interface ContainerConfig {
  name: string;
  partitionKeyPath: string;
  defaultTtl?: number;
  uniqueKeyPaths?: string[];
  throughput?: number;
}

/**
 * Base entity with required fields
 */
export interface BaseEntity {
  id: string;
  partitionKey: string;
  createdAt?: string;
  updatedAt?: string;
  ttl?: number;
}

/**
 * Telemetry entity
 */
export interface TelemetryEntity extends BaseEntity {
  eventType: TelemetryEventType;
  eventName: string;
  userId?: string;
  sessionId?: string;
  properties?: Record<string, unknown>;
  metrics?: Record<string, number>;
  timestamp: string;
  source?: string;
  environment?: string;
}

/**
 * Telemetry event types
 */
export type TelemetryEventType =
  | 'api_call'
  | 'user_action'
  | 'error'
  | 'performance'
  | 'usage'
  | 'cost'
  | 'custom';

/**
 * User session entity
 */
export interface SessionEntity extends BaseEntity {
  userId: string;
  startedAt: string;
  endedAt?: string;
  status: SessionStatus;
  userAgent?: string;
  ipHash?: string;
  metadata?: Record<string, unknown>;
  requestCount?: number;
  lastActivityAt?: string;
}

/**
 * Session status
 */
export type SessionStatus = 'active' | 'idle' | 'expired' | 'terminated';

/**
 * Tribal knowledge entity
 */
export interface TribalKnowledgeEntity extends BaseEntity {
  content: string;
  contentVector?: number[];
  sourceType: TribalKnowledgeSource;
  sourceRef?: string;
  repository?: string;
  author?: string;
  tags?: string[];
  filePaths?: string[];
  confidence?: number;
  verified?: boolean;
  usageCount?: number;
}

/**
 * Tribal knowledge source types
 */
export type TribalKnowledgeSource =
  | 'pr_comment'
  | 'pr_review'
  | 'commit_message'
  | 'code_comment'
  | 'documentation'
  | 'slack'
  | 'manual';

/**
 * Query options
 */
export interface QueryOptions {
  maxItems?: number;
  continuationToken?: string;
  partitionKey?: string;
  enableCrossPartition?: boolean;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

/**
 * Query result
 */
export interface QueryResult<T> {
  success: boolean;
  items: T[];
  count?: number;
  continuationToken?: string;
  requestCharge?: number;
  error?: string;
  errorCode?: CosmosErrorCode;
}

/**
 * Operation result
 */
export interface OperationResult<T = unknown> {
  success: boolean;
  data?: T;
  requestCharge?: number;
  error?: string;
  errorCode?: CosmosErrorCode;
}

/**
 * Bulk operation item
 */
export interface BulkOperationItem<T extends BaseEntity> {
  operationType: 'create' | 'upsert' | 'replace' | 'delete' | 'read';
  item?: T;
  id?: string;
  partitionKey: string;
}

/**
 * Bulk operation result
 */
export interface BulkOperationResult {
  success: boolean;
  successCount: number;
  failedCount: number;
  totalRequestCharge?: number;
  errors?: BulkOperationError[];
}

/**
 * Bulk operation error
 */
export interface BulkOperationError {
  index: number;
  id?: string;
  errorMessage: string;
  statusCode?: number;
}

/**
 * Query builder interface
 */
export interface QueryBuilder {
  select(fields: string[]): QueryBuilder;
  where(field: string, operator: QueryOperator, value: unknown): QueryBuilder;
  and(field: string, operator: QueryOperator, value: unknown): QueryBuilder;
  or(field: string, operator: QueryOperator, value: unknown): QueryBuilder;
  orderBy(field: string, direction?: 'ASC' | 'DESC'): QueryBuilder;
  limit(count: number): QueryBuilder;
  offset(count: number): QueryBuilder;
  build(): { query: string; parameters: QueryParameter[] };
}

/**
 * Query operators
 */
export type QueryOperator =
  | '='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'CONTAINS'
  | 'STARTSWITH'
  | 'ENDSWITH'
  | 'ARRAY_CONTAINS'
  | 'IN'
  | 'NOT IN'
  | 'IS_NULL'
  | 'IS_NOT_NULL';

/**
 * Query parameter
 */
export interface QueryParameter {
  name: string;
  value: unknown;
}

/**
 * Error codes
 */
export enum CosmosErrorCode {
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  INVALID_INPUT = 'INVALID_INPUT',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  FORBIDDEN = 'FORBIDDEN',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Service status
 */
export interface CosmosServiceStatus {
  isInitialized: boolean;
  endpoint: string;
  databaseName: string;
  containers: string[];
  enableLogging: boolean;
}

/**
 * Predefined container configurations
 */
export const ContainerConfigs = {
  TELEMETRY: {
    name: 'telemetry',
    partitionKeyPath: '/partitionKey',
    defaultTtl: 60 * 60 * 24 * 90, // 90 days
  } as ContainerConfig,

  SESSIONS: {
    name: 'sessions',
    partitionKeyPath: '/userId',
    defaultTtl: 60 * 60 * 24 * 7, // 7 days
  } as ContainerConfig,

  TRIBAL_KNOWLEDGE: {
    name: 'tribal-knowledge',
    partitionKeyPath: '/repository',
    defaultTtl: -1, // No expiration
  } as ContainerConfig,

  USER_PREFERENCES: {
    name: 'user-preferences',
    partitionKeyPath: '/userId',
    defaultTtl: -1, // No expiration
  } as ContainerConfig,

  COST_TRACKING: {
    name: 'cost-tracking',
    partitionKeyPath: '/partitionKey',
    defaultTtl: 60 * 60 * 24 * 365, // 1 year
  } as ContainerConfig,
} as const;
