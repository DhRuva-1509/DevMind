// src/services/azure/cosmos/cosmos.service.ts

import {
  CosmosClient,
  Database,
  Container,
  SqlQuerySpec,
  BulkOperationType,
  OperationInput,
  PatchOperation,
  JSONObject,
} from '@azure/cosmos';
import { TokenCredential } from '@azure/core-auth';
import { azureAuthService } from '../auth/auth.service';
import {
  CosmosConfig,
  ContainerConfig,
  BaseEntity,
  QueryOptions,
  QueryResult,
  OperationResult,
  BulkOperationItem,
  BulkOperationResult,
  CosmosErrorCode,
  CosmosServiceStatus,
  QueryBuilder,
  QueryOperator,
  QueryParameter,
} from './cosmos.types';

/**
 * Azure Cosmos DB Service
 */
export class CosmosDBService {
  private client: CosmosClient | null = null;
  private database: Database | null = null;
  private containers: Map<string, Container> = new Map();
  private config: Required<CosmosConfig>;
  private _isInitialized: boolean = false;

  private static readonly DEFAULT_CONFIG: Required<CosmosConfig> = {
    endpoint: '',
    databaseName: 'devmind',
    connectionTimeoutMs: 10000,
    requestTimeoutMs: 30000,
    enableLogging: true,
    maxRetryAttempts: 3,
    retryDelayMs: 1000,
  };

  constructor(config: CosmosConfig = {}) {
    this.config = { ...CosmosDBService.DEFAULT_CONFIG, ...config };

    if (!this.config.endpoint) {
      this.config.endpoint = process.env.AZURE_COSMOS_ENDPOINT || '';
    }

    if (this.config.endpoint) {
      this.initializeClient();
    }
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  private initializeClient(): void {
    try {
      const credential: TokenCredential = azureAuthService.getCredential();

      this.client = new CosmosClient({
        endpoint: this.config.endpoint,
        aadCredentials: credential,
      });

      this.database = this.client.database(this.config.databaseName);
      this._isInitialized = true;
    } catch {
      this._isInitialized = false;
    }
  }

  private getContainer(containerName: string): Container | null {
    if (!this.database) {
      return null;
    }

    if (this.containers.has(containerName)) {
      return this.containers.get(containerName)!;
    }

    const container = this.database.container(containerName);
    this.containers.set(containerName, container);
    return container;
  }

  // ============================================================
  // DATABASE & CONTAINER MANAGEMENT
  // ============================================================

  async createDatabase(): Promise<OperationResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Cosmos client not initialized',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const { database } = await this.client.databases.createIfNotExists({
        id: this.config.databaseName,
      });

      this.database = database;

      return {
        success: true,
        data: { databaseId: database.id },
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async createContainer(config: ContainerConfig): Promise<OperationResult> {
    if (!this.database) {
      return {
        success: false,
        error: 'Database not initialized',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const containerDefinition: {
        id: string;
        partitionKey: { paths: string[] };
        defaultTtl?: number;
        uniqueKeyPolicy?: { uniqueKeys: { paths: string[] }[] };
      } = {
        id: config.name,
        partitionKey: {
          paths: [config.partitionKeyPath],
        },
      };

      if (config.defaultTtl !== undefined && config.defaultTtl !== -1) {
        containerDefinition.defaultTtl = config.defaultTtl;
      }

      if (config.uniqueKeyPaths && config.uniqueKeyPaths.length > 0) {
        containerDefinition.uniqueKeyPolicy = {
          uniqueKeys: config.uniqueKeyPaths.map((path) => ({
            paths: [path],
          })),
        };
      }

      const { container } = await this.database.containers.createIfNotExists(containerDefinition);

      this.containers.set(config.name, container);

      return {
        success: true,
        data: { containerId: container.id },
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async deleteContainer(containerName: string): Promise<OperationResult> {
    if (!this.database) {
      return {
        success: false,
        error: 'Database not initialized',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      await this.database.container(containerName).delete();
      this.containers.delete(containerName);

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

  async listContainers(): Promise<string[]> {
    if (!this.database) {
      return [];
    }

    try {
      const { resources } = await this.database.containers.readAll().fetchAll();
      return resources.map((c) => c.id);
    } catch {
      return [];
    }
  }

  // ============================================================
  // CRUD OPERATIONS
  // ============================================================

  async create<T extends BaseEntity>(containerName: string, item: T): Promise<OperationResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const timestamp = new Date().toISOString();
      const itemWithTimestamps = {
        ...item,
        createdAt: item.createdAt || timestamp,
        updatedAt: timestamp,
      };

      const { resource, requestCharge } = await container.items.create(itemWithTimestamps);

      return {
        success: true,
        data: resource as unknown as T,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async read<T extends BaseEntity>(
    containerName: string,
    id: string,
    partitionKey: string
  ): Promise<OperationResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const { resource, requestCharge } = await container.item(id, partitionKey).read();

      if (!resource) {
        return {
          success: false,
          error: `Item with id '${id}' not found`,
          errorCode: CosmosErrorCode.NOT_FOUND,
        };
      }

      return {
        success: true,
        data: resource as unknown as T,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async update<T extends BaseEntity>(containerName: string, item: T): Promise<OperationResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const itemWithTimestamp = {
        ...item,
        updatedAt: new Date().toISOString(),
      };

      const { resource, requestCharge } = await container
        .item(item.id, item.partitionKey)
        .replace(itemWithTimestamp);

      return {
        success: true,
        data: resource as unknown as T,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async upsert<T extends BaseEntity>(containerName: string, item: T): Promise<OperationResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const timestamp = new Date().toISOString();
      const itemWithTimestamps = {
        ...item,
        createdAt: item.createdAt || timestamp,
        updatedAt: timestamp,
      };

      const { resource, requestCharge } = await container.items.upsert(itemWithTimestamps);

      return {
        success: true,
        data: resource as unknown as T,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async delete(containerName: string, id: string, partitionKey: string): Promise<OperationResult> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const { requestCharge } = await container.item(id, partitionKey).delete();

      return {
        success: true,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async patch<T extends BaseEntity>(
    containerName: string,
    id: string,
    partitionKey: string,
    operations: Array<{
      op: 'add' | 'set' | 'replace' | 'remove' | 'incr';
      path: string;
      value?: unknown;
    }>
  ): Promise<OperationResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const patchOperations: PatchOperation[] = [
        ...operations.map((op) => {
          if (op.op === 'remove') {
            return { op: op.op, path: op.path } as PatchOperation;
          }
          return {
            op: op.op,
            path: op.path,
            value: op.value,
          } as PatchOperation;
        }),
        { op: 'set', path: '/updatedAt', value: new Date().toISOString() },
      ];

      const { resource, requestCharge } = await container
        .item(id, partitionKey)
        .patch(patchOperations);

      return {
        success: true,
        data: resource as unknown as T,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  // ============================================================
  // QUERY OPERATIONS
  // ============================================================

  async query<T extends BaseEntity>(
    containerName: string,
    querySpec: SqlQuerySpec,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        items: [],
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const queryIterator = container.items.query(querySpec, {
        maxItemCount: options.maxItems || 100,
        continuationToken: options.continuationToken,
        partitionKey: options.partitionKey,
      });

      const { resources, continuationToken, requestCharge } = await queryIterator.fetchNext();

      return {
        success: true,
        items: (resources || []) as unknown as T[],
        continuationToken,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async queryAll<T extends BaseEntity>(
    containerName: string,
    querySpec: SqlQuerySpec,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        items: [],
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const { resources, requestCharge } = await container.items
        .query(querySpec, {
          partitionKey: options.partitionKey,
        })
        .fetchAll();

      return {
        success: true,
        items: (resources || []) as unknown as T[],
        count: resources?.length || 0,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        items: [],
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  async findBy<T extends BaseEntity>(
    containerName: string,
    field: string,
    value: string | number | boolean,
    options: QueryOptions = {}
  ): Promise<QueryResult<T>> {
    const querySpec: SqlQuerySpec = {
      query: `SELECT * FROM c WHERE c.${field} = @value`,
      parameters: [{ name: '@value', value }],
    };

    return this.query<T>(containerName, querySpec, options);
  }

  async count(
    containerName: string,
    querySpec?: SqlQuerySpec,
    options: QueryOptions = {}
  ): Promise<OperationResult<number>> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        error: 'Container not available',
        errorCode: CosmosErrorCode.AUTHENTICATION_ERROR,
      };
    }

    try {
      const countQuery: SqlQuerySpec = querySpec
        ? {
            query: `SELECT VALUE COUNT(1) FROM c WHERE ${querySpec.query.replace(/SELECT.*FROM\s+c\s+WHERE\s+/i, '')}`,
            parameters: querySpec.parameters,
          }
        : { query: 'SELECT VALUE COUNT(1) FROM c' };

      const { resources, requestCharge } = await container.items
        .query<number>(countQuery, {
          partitionKey: options.partitionKey,
        })
        .fetchAll();

      return {
        success: true,
        data: resources?.[0] || 0,
        requestCharge,
      };
    } catch (error) {
      return {
        success: false,
        error: this.getErrorMessage(error),
        errorCode: this.getErrorCode(error),
      };
    }
  }

  // ============================================================
  // BULK OPERATIONS
  // ============================================================

  async bulk<T extends BaseEntity>(
    containerName: string,
    operations: BulkOperationItem<T>[]
  ): Promise<BulkOperationResult> {
    const container = this.getContainer(containerName);

    if (!container) {
      return {
        success: false,
        successCount: 0,
        failedCount: operations.length,
        errors: [
          {
            index: 0,
            errorMessage: 'Container not available',
          },
        ],
      };
    }

    try {
      const timestamp = new Date().toISOString();

      const bulkOps: OperationInput[] = operations.map((op) => {
        switch (op.operationType) {
          case 'create':
            return {
              operationType: BulkOperationType.Create,
              resourceBody: {
                ...(op.item as unknown as JSONObject),
                createdAt: op.item!.createdAt || timestamp,
                updatedAt: timestamp,
              },
            };
          case 'upsert':
            return {
              operationType: BulkOperationType.Upsert,
              resourceBody: {
                ...(op.item as unknown as JSONObject),
                createdAt: op.item!.createdAt || timestamp,
                updatedAt: timestamp,
              },
            };
          case 'replace':
            return {
              operationType: BulkOperationType.Replace,
              id: op.item!.id,
              resourceBody: {
                ...(op.item as unknown as JSONObject),
                updatedAt: timestamp,
              },
            };
          case 'delete':
            return {
              operationType: BulkOperationType.Delete,
              id: op.id!,
              partitionKey: op.partitionKey,
            };
          case 'read':
            return {
              operationType: BulkOperationType.Read,
              id: op.id!,
              partitionKey: op.partitionKey,
            };
          default:
            throw new Error(`Unknown operation type: ${op.operationType}`);
        }
      });

      const response = await container.items.bulk(bulkOps);

      let successCount = 0;
      let failedCount = 0;
      let totalRequestCharge = 0;
      const errors: BulkOperationResult['errors'] = [];

      response.forEach((result, index) => {
        totalRequestCharge += result.requestCharge || 0;

        if (result.statusCode >= 200 && result.statusCode < 300) {
          successCount++;
        } else {
          failedCount++;
          errors.push({
            index,
            id: operations[index].id || operations[index].item?.id,
            errorMessage: `Status code: ${result.statusCode}`,
            statusCode: result.statusCode,
          });
        }
      });

      return {
        success: failedCount === 0,
        successCount,
        failedCount,
        totalRequestCharge,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      return {
        success: false,
        successCount: 0,
        failedCount: operations.length,
        errors: [
          {
            index: 0,
            errorMessage: this.getErrorMessage(error),
          },
        ],
      };
    }
  }

  async bulkCreate<T extends BaseEntity>(
    containerName: string,
    items: T[]
  ): Promise<BulkOperationResult> {
    const operations: BulkOperationItem<T>[] = items.map((item) => ({
      operationType: 'create' as const,
      item,
      partitionKey: item.partitionKey,
    }));

    return this.bulk(containerName, operations);
  }

  async bulkUpsert<T extends BaseEntity>(
    containerName: string,
    items: T[]
  ): Promise<BulkOperationResult> {
    const operations: BulkOperationItem<T>[] = items.map((item) => ({
      operationType: 'upsert' as const,
      item,
      partitionKey: item.partitionKey,
    }));

    return this.bulk(containerName, operations);
  }

  async bulkDelete(
    containerName: string,
    items: Array<{ id: string; partitionKey: string }>
  ): Promise<BulkOperationResult> {
    const operations: BulkOperationItem<BaseEntity>[] = items.map((item) => ({
      operationType: 'delete' as const,
      id: item.id,
      partitionKey: item.partitionKey,
    }));

    return this.bulk(containerName, operations);
  }

  // ============================================================
  // QUERY BUILDER
  // ============================================================

  queryBuilder(): QueryBuilder {
    return new CosmosQueryBuilder();
  }

  // ============================================================
  // ERROR HANDLING
  // ============================================================

  private getErrorCode(error: unknown): CosmosErrorCode {
    const err = error as Error & { code?: number; statusCode?: number };
    const statusCode = err?.code || err?.statusCode;

    if (statusCode === 404) return CosmosErrorCode.NOT_FOUND;
    if (statusCode === 409) return CosmosErrorCode.CONFLICT;
    if (statusCode === 412) return CosmosErrorCode.PRECONDITION_FAILED;
    if (statusCode === 429) return CosmosErrorCode.TOO_MANY_REQUESTS;
    if (statusCode === 503) return CosmosErrorCode.SERVICE_UNAVAILABLE;
    if (statusCode === 408) return CosmosErrorCode.TIMEOUT;
    if (statusCode === 401) return CosmosErrorCode.AUTHENTICATION_ERROR;
    if (statusCode === 403) return CosmosErrorCode.FORBIDDEN;
    if (statusCode === 400) return CosmosErrorCode.INVALID_INPUT;

    return CosmosErrorCode.UNKNOWN_ERROR;
  }

  private getErrorMessage(error: unknown): string {
    const err = error as Error;
    return err?.message || 'Unknown error occurred';
  }

  // ============================================================
  // SERVICE STATUS
  // ============================================================

  getStatus(): CosmosServiceStatus {
    return {
      isInitialized: this._isInitialized,
      endpoint: this.config.endpoint,
      databaseName: this.config.databaseName,
      containers: Array.from(this.containers.keys()),
      enableLogging: this.config.enableLogging,
    };
  }
}

/**
 * Query Builder Implementation
 */
class CosmosQueryBuilder implements QueryBuilder {
  private selectFields: string[] = ['*'];
  private conditions: Array<{
    conjunction: 'AND' | 'OR' | '';
    field: string;
    operator: QueryOperator;
    value: unknown;
  }> = [];
  private orderByField?: string;
  private orderByDirection: 'ASC' | 'DESC' = 'ASC';
  private limitCount?: number;
  private offsetCount?: number;
  private paramCounter = 0;

  select(fields: string[]): QueryBuilder {
    this.selectFields = fields;
    return this;
  }

  where(field: string, operator: QueryOperator, value: unknown): QueryBuilder {
    this.conditions.push({ conjunction: '', field, operator, value });
    return this;
  }

  and(field: string, operator: QueryOperator, value: unknown): QueryBuilder {
    this.conditions.push({ conjunction: 'AND', field, operator, value });
    return this;
  }

  or(field: string, operator: QueryOperator, value: unknown): QueryBuilder {
    this.conditions.push({ conjunction: 'OR', field, operator, value });
    return this;
  }

  orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): QueryBuilder {
    this.orderByField = field;
    this.orderByDirection = direction;
    return this;
  }

  limit(count: number): QueryBuilder {
    this.limitCount = count;
    return this;
  }

  offset(count: number): QueryBuilder {
    this.offsetCount = count;
    return this;
  }

  build(): { query: string; parameters: QueryParameter[] } {
    const parameters: QueryParameter[] = [];
    let query = '';

    const selectClause =
      this.selectFields.length === 1 && this.selectFields[0] === '*'
        ? '*'
        : this.selectFields.map((f) => `c.${f}`).join(', ');
    query = `SELECT ${selectClause} FROM c`;

    if (this.conditions.length > 0) {
      const whereParts: string[] = [];

      for (const condition of this.conditions) {
        const paramName = `@p${this.paramCounter++}`;
        const clause = this.buildCondition(condition.field, condition.operator, paramName);

        if (condition.conjunction && whereParts.length > 0) {
          whereParts.push(`${condition.conjunction} ${clause}`);
        } else {
          whereParts.push(clause);
        }

        if (condition.operator !== 'IS_NULL' && condition.operator !== 'IS_NOT_NULL') {
          parameters.push({ name: paramName, value: condition.value });
        }
      }

      query += ` WHERE ${whereParts.join(' ')}`;
    }

    if (this.orderByField) {
      query += ` ORDER BY c.${this.orderByField} ${this.orderByDirection}`;
    }

    if (this.offsetCount !== undefined || this.limitCount !== undefined) {
      query += ` OFFSET ${this.offsetCount || 0} LIMIT ${this.limitCount || 100}`;
    }

    return { query, parameters };
  }

  private buildCondition(field: string, operator: QueryOperator, paramName: string): string {
    const fieldPath = `c.${field}`;

    switch (operator) {
      case '=':
        return `${fieldPath} = ${paramName}`;
      case '!=':
        return `${fieldPath} != ${paramName}`;
      case '>':
        return `${fieldPath} > ${paramName}`;
      case '>=':
        return `${fieldPath} >= ${paramName}`;
      case '<':
        return `${fieldPath} < ${paramName}`;
      case '<=':
        return `${fieldPath} <= ${paramName}`;
      case 'CONTAINS':
        return `CONTAINS(${fieldPath}, ${paramName})`;
      case 'STARTSWITH':
        return `STARTSWITH(${fieldPath}, ${paramName})`;
      case 'ENDSWITH':
        return `ENDSWITH(${fieldPath}, ${paramName})`;
      case 'ARRAY_CONTAINS':
        return `ARRAY_CONTAINS(${fieldPath}, ${paramName})`;
      case 'IN':
        return `${fieldPath} IN (${paramName})`;
      case 'NOT IN':
        return `${fieldPath} NOT IN (${paramName})`;
      case 'IS_NULL':
        return `IS_NULL(${fieldPath})`;
      case 'IS_NOT_NULL':
        return `NOT IS_NULL(${fieldPath})`;
      default:
        return `${fieldPath} = ${paramName}`;
    }
  }
}

// Export singleton instance
export const cosmosDBService = new CosmosDBService();
