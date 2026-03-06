import { expect } from 'chai';
import * as sinon from 'sinon';
import { CosmosDBService } from '../cosmos/cosmos.services';
import { CosmosErrorCode, ContainerConfigs, BaseEntity } from './cosmos.types';

describe('CosmosDBService', () => {
  let cosmosService: CosmosDBService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    cosmosService = new CosmosDBService({
      endpoint: '',
      databaseName: 'test-db',
      enableLogging: true,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const service = new CosmosDBService();
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should create instance with custom config', () => {
      const service = new CosmosDBService({
        endpoint: 'https://test.documents.azure.com:443/',
        databaseName: 'custom-db',
        enableLogging: false,
        maxRetryAttempts: 5,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should not be initialized without endpoint', () => {
      const service = new CosmosDBService({ endpoint: '' });
      expect(service.isInitialized).to.be.false;
    });

    it('should use default database name when not provided', () => {
      const service = new CosmosDBService({ endpoint: '' });
      const status = service.getStatus();
      expect(status.databaseName).to.equal('devmind');
    });

    it('should use custom database name when provided', () => {
      const service = new CosmosDBService({
        endpoint: '',
        databaseName: 'my-custom-db',
      });
      const status = service.getStatus();
      expect(status.databaseName).to.equal('my-custom-db');
    });

    it('should accept connection timeout config', () => {
      const service = new CosmosDBService({
        endpoint: '',
        connectionTimeoutMs: 5000,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should accept request timeout config', () => {
      const service = new CosmosDBService({
        endpoint: '',
        requestTimeoutMs: 60000,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should accept retry config', () => {
      const service = new CosmosDBService({
        endpoint: '',
        maxRetryAttempts: 5,
        retryDelayMs: 2000,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });
  });

  describe('getStatus', () => {
    it('should return service status object', () => {
      const status = cosmosService.getStatus();

      expect(status).to.have.property('isInitialized');
      expect(status).to.have.property('endpoint');
      expect(status).to.have.property('databaseName');
      expect(status).to.have.property('containers');
      expect(status).to.have.property('enableLogging');
    });

    it('should show correct database name', () => {
      const status = cosmosService.getStatus();
      expect(status.databaseName).to.equal('test-db');
    });

    it('should show logging enabled', () => {
      const status = cosmosService.getStatus();
      expect(status.enableLogging).to.be.true;
    });

    it('should show not initialized when no endpoint', () => {
      const status = cosmosService.getStatus();
      expect(status.isInitialized).to.be.false;
    });

    it('should show empty containers initially', () => {
      const status = cosmosService.getStatus();
      expect(status.containers).to.be.an('array').that.is.empty;
    });

    it('should show empty endpoint when not set', () => {
      const status = cosmosService.getStatus();
      expect(status.endpoint).to.equal('');
    });

    it('should allow disabling logging', () => {
      const service = new CosmosDBService({
        endpoint: '',
        enableLogging: false,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.false;
    });
  });

  describe('createDatabase', () => {
    it('should return error when client not initialized', async () => {
      const result = await cosmosService.createDatabase();

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
      expect(result.error).to.equal('Cosmos client not initialized');
    });
  });

  describe('createContainer', () => {
    it('should return error when database not initialized', async () => {
      const result = await cosmosService.createContainer({
        name: 'test-container',
        partitionKeyPath: '/partitionKey',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
      expect(result.error).to.equal('Database not initialized');
    });

    it('should accept container config with TTL', async () => {
      const result = await cosmosService.createContainer({
        name: 'test-container',
        partitionKeyPath: '/partitionKey',
        defaultTtl: 3600,
      });

      expect(result.success).to.be.false;
    });

    it('should accept container config with unique keys', async () => {
      const result = await cosmosService.createContainer({
        name: 'test-container',
        partitionKeyPath: '/partitionKey',
        uniqueKeyPaths: ['/email'],
      });

      expect(result.success).to.be.false;
    });

    it('should accept container config with throughput', async () => {
      const result = await cosmosService.createContainer({
        name: 'test-container',
        partitionKeyPath: '/partitionKey',
        throughput: 400,
      });

      expect(result.success).to.be.false;
    });

    it('should accept container config with multiple unique keys', async () => {
      const result = await cosmosService.createContainer({
        name: 'test-container',
        partitionKeyPath: '/partitionKey',
        uniqueKeyPaths: ['/email', '/username'],
      });

      expect(result.success).to.be.false;
    });
  });

  describe('deleteContainer', () => {
    it('should return error when database not initialized', async () => {
      const result = await cosmosService.deleteContainer('test-container');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
      expect(result.error).to.equal('Database not initialized');
    });
  });

  describe('listContainers', () => {
    it('should return empty array when database not initialized', async () => {
      const containers = await cosmosService.listContainers();
      expect(containers).to.be.an('array').that.is.empty;
    });
  });

  describe('create', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.create('test-container', {
        id: 'item1',
        partitionKey: 'pk1',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
      expect(result.error).to.equal('Container not available');
    });

    it('should accept item with all base entity fields', async () => {
      const result = await cosmosService.create('test-container', {
        id: 'item1',
        partitionKey: 'pk1',
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-01T00:00:00Z',
        ttl: 3600,
      });

      expect(result.success).to.be.false;
    });

    it('should accept item with custom fields', async () => {
      interface CustomEntity extends BaseEntity {
        name: string;
        count: number;
      }

      const result = await cosmosService.create<CustomEntity>('test-container', {
        id: 'item1',
        partitionKey: 'pk1',
        name: 'Test Item',
        count: 10,
      });

      expect(result.success).to.be.false;
    });
  });

  describe('read', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.read('test-container', 'item1', 'pk1');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept any id and partition key', async () => {
      const result = await cosmosService.read(
        'test-container',
        'non-existent-id',
        'some-partition-key'
      );

      expect(result.success).to.be.false;
    });
  });

  describe('update', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.update('test-container', {
        id: 'item1',
        partitionKey: 'pk1',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept item with updated fields', async () => {
      interface CustomEntity extends BaseEntity {
        name: string;
      }

      const result = await cosmosService.update<CustomEntity>('test-container', {
        id: 'item1',
        partitionKey: 'pk1',
        name: 'Updated Name',
      });

      expect(result.success).to.be.false;
    });
  });

  describe('upsert', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.upsert('test-container', {
        id: 'item1',
        partitionKey: 'pk1',
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept new item for upsert', async () => {
      const result = await cosmosService.upsert('test-container', {
        id: 'new-item',
        partitionKey: 'pk1',
      });

      expect(result.success).to.be.false;
    });

    it('should accept existing item for upsert', async () => {
      const result = await cosmosService.upsert('test-container', {
        id: 'existing-item',
        partitionKey: 'pk1',
        createdAt: '2024-01-01T00:00:00Z',
      });

      expect(result.success).to.be.false;
    });
  });

  describe('delete', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.delete('test-container', 'item1', 'pk1');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept any id and partition key for delete', async () => {
      const result = await cosmosService.delete('test-container', 'any-id', 'any-pk');

      expect(result.success).to.be.false;
    });
  });

  describe('patch', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'set', path: '/name', value: 'updated' },
      ]);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept set operation', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'set', path: '/name', value: 'updated' },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept add operation', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'add', path: '/newField', value: 'new value' },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept replace operation', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'replace', path: '/existingField', value: 'replaced value' },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept remove operation', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'remove', path: '/oldField' },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept incr operation', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'incr', path: '/count', value: 1 },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept multiple patch operations', async () => {
      const result = await cosmosService.patch('test-container', 'item1', 'pk1', [
        { op: 'set', path: '/name', value: 'updated' },
        { op: 'incr', path: '/count', value: 1 },
        { op: 'remove', path: '/oldField' },
        { op: 'add', path: '/newArray', value: [] },
      ]);

      expect(result.success).to.be.false;
    });
  });

  describe('query', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.query('test-container', {
        query: 'SELECT * FROM c',
      });

      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept simple query', async () => {
      const result = await cosmosService.query('test-container', {
        query: 'SELECT * FROM c',
      });

      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array');
    });

    it('should accept query with single parameter', async () => {
      const result = await cosmosService.query('test-container', {
        query: 'SELECT * FROM c WHERE c.type = @type',
        parameters: [{ name: '@type', value: 'telemetry' }],
      });

      expect(result.success).to.be.false;
    });

    it('should accept query with multiple parameters', async () => {
      const result = await cosmosService.query('test-container', {
        query: 'SELECT * FROM c WHERE c.type = @type AND c.status = @status',
        parameters: [
          { name: '@type', value: 'telemetry' },
          { name: '@status', value: 'active' },
        ],
      });

      expect(result.success).to.be.false;
    });

    it('should accept query with maxItems option', async () => {
      const result = await cosmosService.query(
        'test-container',
        { query: 'SELECT * FROM c' },
        { maxItems: 10 }
      );

      expect(result.success).to.be.false;
    });

    it('should accept query with partitionKey option', async () => {
      const result = await cosmosService.query(
        'test-container',
        { query: 'SELECT * FROM c' },
        { partitionKey: 'pk1' }
      );

      expect(result.success).to.be.false;
    });

    it('should accept query with continuationToken option', async () => {
      const result = await cosmosService.query(
        'test-container',
        { query: 'SELECT * FROM c' },
        { continuationToken: 'some-token' }
      );

      expect(result.success).to.be.false;
    });

    it('should accept query with all options', async () => {
      const result = await cosmosService.query(
        'test-container',
        { query: 'SELECT * FROM c' },
        {
          maxItems: 50,
          partitionKey: 'pk1',
          continuationToken: 'token123',
        }
      );

      expect(result.success).to.be.false;
    });
  });

  describe('queryAll', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.queryAll('test-container', {
        query: 'SELECT * FROM c',
      });

      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
    });

    it('should accept query with partition key', async () => {
      const result = await cosmosService.queryAll(
        'test-container',
        { query: 'SELECT * FROM c' },
        { partitionKey: 'pk1' }
      );

      expect(result.success).to.be.false;
    });
  });

  describe('findBy', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.findBy('test-container', 'eventType', 'api_call');

      expect(result.success).to.be.false;
      expect(result.items).to.be.an('array').that.is.empty;
    });

    it('should accept string value', async () => {
      const result = await cosmosService.findBy('test-container', 'status', 'active');

      expect(result.success).to.be.false;
    });

    it('should accept number value', async () => {
      const result = await cosmosService.findBy('test-container', 'count', 42);

      expect(result.success).to.be.false;
    });

    it('should accept boolean value', async () => {
      const result = await cosmosService.findBy('test-container', 'isActive', true);

      expect(result.success).to.be.false;
    });

    it('should accept query options', async () => {
      const result = await cosmosService.findBy('test-container', 'status', 'active', {
        maxItems: 10,
        partitionKey: 'pk1',
      });

      expect(result.success).to.be.false;
    });
  });

  describe('count', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.count('test-container');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(CosmosErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept count without query spec', async () => {
      const result = await cosmosService.count('test-container');

      expect(result.success).to.be.false;
    });

    it('should accept count with query spec', async () => {
      const result = await cosmosService.count('test-container', {
        query: 'SELECT * FROM c WHERE c.type = @type',
        parameters: [{ name: '@type', value: 'telemetry' }],
      });

      expect(result.success).to.be.false;
    });

    it('should accept count with partition key option', async () => {
      const result = await cosmosService.count('test-container', undefined, {
        partitionKey: 'pk1',
      });

      expect(result.success).to.be.false;
    });
  });

  describe('bulk', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'create',
          item: { id: 'item1', partitionKey: 'pk1' },
          partitionKey: 'pk1',
        },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(1);
      expect(result.successCount).to.equal(0);
    });

    it('should accept create operations', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'create',
          item: { id: 'item1', partitionKey: 'pk1' },
          partitionKey: 'pk1',
        },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept upsert operations', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'upsert',
          item: { id: 'item1', partitionKey: 'pk1' },
          partitionKey: 'pk1',
        },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept replace operations', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'replace',
          item: { id: 'item1', partitionKey: 'pk1' },
          partitionKey: 'pk1',
        },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept delete operations', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'delete',
          id: 'item1',
          partitionKey: 'pk1',
        },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept read operations', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'read',
          id: 'item1',
          partitionKey: 'pk1',
        },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept multiple operation types', async () => {
      const result = await cosmosService.bulk<BaseEntity>('test-container', [
        {
          operationType: 'create',
          item: { id: 'item1', partitionKey: 'pk1' },
          partitionKey: 'pk1',
        },
        {
          operationType: 'upsert',
          item: { id: 'item2', partitionKey: 'pk2' },
          partitionKey: 'pk2',
        },
        {
          operationType: 'delete',
          id: 'item3',
          partitionKey: 'pk3',
        },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(3);
    });

    it('should include error details', async () => {
      const result = await cosmosService.bulk('test-container', [
        {
          operationType: 'create',
          item: { id: 'item1', partitionKey: 'pk1' },
          partitionKey: 'pk1',
        },
      ]);

      expect(result.errors).to.be.an('array');
      expect(result.errors![0]).to.have.property('errorMessage');
    });
  });

  describe('bulkCreate', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.bulkCreate('test-container', [
        { id: 'item1', partitionKey: 'pk1' },
        { id: 'item2', partitionKey: 'pk2' },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(2);
    });

    it('should accept single item', async () => {
      const result = await cosmosService.bulkCreate('test-container', [
        { id: 'item1', partitionKey: 'pk1' },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(1);
    });

    it('should accept multiple items', async () => {
      const result = await cosmosService.bulkCreate('test-container', [
        { id: 'item1', partitionKey: 'pk1' },
        { id: 'item2', partitionKey: 'pk2' },
        { id: 'item3', partitionKey: 'pk3' },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(3);
    });

    it('should accept empty array', async () => {
      const result = await cosmosService.bulkCreate('test-container', []);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(0);
    });
  });

  describe('bulkUpsert', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.bulkUpsert('test-container', [
        { id: 'item1', partitionKey: 'pk1' },
        { id: 'item2', partitionKey: 'pk2' },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(2);
    });

    it('should accept items with existing timestamps', async () => {
      const result = await cosmosService.bulkUpsert('test-container', [
        {
          id: 'item1',
          partitionKey: 'pk1',
          createdAt: '2024-01-01T00:00:00Z',
        },
      ]);

      expect(result.success).to.be.false;
    });
  });

  describe('bulkDelete', () => {
    it('should return error when container not available', async () => {
      const result = await cosmosService.bulkDelete('test-container', [
        { id: 'item1', partitionKey: 'pk1' },
        { id: 'item2', partitionKey: 'pk2' },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(2);
    });

    it('should accept single item', async () => {
      const result = await cosmosService.bulkDelete('test-container', [
        { id: 'item1', partitionKey: 'pk1' },
      ]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(1);
    });

    it('should accept empty array', async () => {
      const result = await cosmosService.bulkDelete('test-container', []);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(0);
    });
  });

  describe('queryBuilder', () => {
    it('should create a query builder', () => {
      const builder = cosmosService.queryBuilder();
      expect(builder).to.exist;
      expect(builder).to.have.property('select');
      expect(builder).to.have.property('where');
      expect(builder).to.have.property('and');
      expect(builder).to.have.property('or');
      expect(builder).to.have.property('orderBy');
      expect(builder).to.have.property('limit');
      expect(builder).to.have.property('offset');
      expect(builder).to.have.property('build');
    });

    it('should build simple select all query', () => {
      const { query, parameters } = cosmosService.queryBuilder().build();

      expect(query).to.equal('SELECT * FROM c');
      expect(parameters).to.have.lengthOf(0);
    });

    it('should build query with where clause', () => {
      const { query, parameters } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .build();

      expect(query).to.include('SELECT * FROM c');
      expect(query).to.include('WHERE');
      expect(query).to.include('c.eventType = @p0');
      expect(parameters).to.have.lengthOf(1);
      expect(parameters[0].name).to.equal('@p0');
      expect(parameters[0].value).to.equal('api_call');
    });

    it('should build query with AND condition', () => {
      const { query, parameters } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .and('userId', '=', 'user123')
        .build();

      expect(query).to.include('c.eventType = @p0');
      expect(query).to.include('AND c.userId = @p1');
      expect(parameters).to.have.lengthOf(2);
    });

    it('should build query with OR condition', () => {
      const { query, parameters } = cosmosService
        .queryBuilder()
        .where('status', '=', 'active')
        .or('status', '=', 'pending')
        .build();

      expect(query).to.include('c.status = @p0');
      expect(query).to.include('OR c.status = @p1');
      expect(parameters).to.have.lengthOf(2);
    });

    it('should build query with mixed AND/OR conditions', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('type', '=', 'telemetry')
        .and('status', '=', 'active')
        .or('priority', '=', 'high')
        .build();

      expect(query).to.include('c.type = @p0');
      expect(query).to.include('AND c.status = @p1');
      expect(query).to.include('OR c.priority = @p2');
    });

    it('should build query with ORDER BY ASC', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .orderBy('timestamp', 'ASC')
        .build();

      expect(query).to.include('ORDER BY c.timestamp ASC');
    });

    it('should build query with ORDER BY DESC', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .orderBy('timestamp', 'DESC')
        .build();

      expect(query).to.include('ORDER BY c.timestamp DESC');
    });

    it('should build query with default ORDER BY direction', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .orderBy('timestamp')
        .build();

      expect(query).to.include('ORDER BY c.timestamp ASC');
    });

    it('should build query with LIMIT', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .limit(100)
        .build();

      expect(query).to.include('OFFSET 0 LIMIT 100');
    });

    it('should build query with OFFSET', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .offset(50)
        .build();

      expect(query).to.include('OFFSET 50 LIMIT 100');
    });

    it('should build query with LIMIT and OFFSET', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('eventType', '=', 'api_call')
        .limit(25)
        .offset(50)
        .build();

      expect(query).to.include('OFFSET 50 LIMIT 25');
    });

    it('should build query with SELECT specific fields', () => {
      const { query } = cosmosService
        .queryBuilder()
        .select(['id', 'eventType', 'timestamp'])
        .where('eventType', '=', 'api_call')
        .build();

      expect(query).to.include('SELECT c.id, c.eventType, c.timestamp FROM c');
    });

    it('should build query with != operator', () => {
      const { query } = cosmosService.queryBuilder().where('status', '!=', 'deleted').build();

      expect(query).to.include('c.status != @p0');
    });

    it('should build query with > operator', () => {
      const { query } = cosmosService.queryBuilder().where('count', '>', 10).build();

      expect(query).to.include('c.count > @p0');
    });

    it('should build query with >= operator', () => {
      const { query } = cosmosService.queryBuilder().where('count', '>=', 10).build();

      expect(query).to.include('c.count >= @p0');
    });

    it('should build query with < operator', () => {
      const { query } = cosmosService.queryBuilder().where('count', '<', 100).build();

      expect(query).to.include('c.count < @p0');
    });

    it('should build query with <= operator', () => {
      const { query } = cosmosService.queryBuilder().where('count', '<=', 100).build();

      expect(query).to.include('c.count <= @p0');
    });

    it('should build query with CONTAINS operator', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('content', 'CONTAINS', 'search term')
        .build();

      expect(query).to.include('CONTAINS(c.content, @p0)');
    });

    it('should build query with STARTSWITH operator', () => {
      const { query } = cosmosService.queryBuilder().where('name', 'STARTSWITH', 'prefix').build();

      expect(query).to.include('STARTSWITH(c.name, @p0)');
    });

    it('should build query with ENDSWITH operator', () => {
      const { query } = cosmosService.queryBuilder().where('name', 'ENDSWITH', 'suffix').build();

      expect(query).to.include('ENDSWITH(c.name, @p0)');
    });

    it('should build query with ARRAY_CONTAINS operator', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('tags', 'ARRAY_CONTAINS', 'important')
        .build();

      expect(query).to.include('ARRAY_CONTAINS(c.tags, @p0)');
    });

    it('should build query with IN operator', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('status', 'IN', ['active', 'pending'])
        .build();

      expect(query).to.include('c.status IN (@p0)');
    });

    it('should build query with NOT IN operator', () => {
      const { query } = cosmosService
        .queryBuilder()
        .where('status', 'NOT IN', ['deleted', 'archived'])
        .build();

      expect(query).to.include('c.status NOT IN (@p0)');
    });

    it('should build query with IS_NULL operator', () => {
      const { query, parameters } = cosmosService
        .queryBuilder()
        .where('deletedAt', 'IS_NULL', null)
        .build();

      expect(query).to.include('IS_NULL(c.deletedAt)');
      expect(parameters).to.have.lengthOf(0);
    });

    it('should build query with IS_NOT_NULL operator', () => {
      const { query, parameters } = cosmosService
        .queryBuilder()
        .where('updatedAt', 'IS_NOT_NULL', null)
        .build();

      expect(query).to.include('NOT IS_NULL(c.updatedAt)');
      expect(parameters).to.have.lengthOf(0);
    });

    it('should build complex query with all features', () => {
      const { query, parameters } = cosmosService
        .queryBuilder()
        .select(['id', 'eventType', 'timestamp', 'userId'])
        .where('eventType', '=', 'api_call')
        .and('timestamp', '>', '2024-01-01')
        .and('status', '!=', 'deleted')
        .orderBy('timestamp', 'DESC')
        .limit(50)
        .offset(100)
        .build();

      expect(query).to.include('SELECT c.id, c.eventType, c.timestamp, c.userId FROM c');
      expect(query).to.include('WHERE');
      expect(query).to.include('c.eventType = @p0');
      expect(query).to.include('AND c.timestamp > @p1');
      expect(query).to.include('AND c.status != @p2');
      expect(query).to.include('ORDER BY c.timestamp DESC');
      expect(query).to.include('OFFSET 100 LIMIT 50');
      expect(parameters).to.have.lengthOf(3);
    });
  });

  describe('ContainerConfigs', () => {
    describe('TELEMETRY', () => {
      it('should have correct name', () => {
        expect(ContainerConfigs.TELEMETRY.name).to.equal('telemetry');
      });

      it('should have correct partition key path', () => {
        expect(ContainerConfigs.TELEMETRY.partitionKeyPath).to.equal('/partitionKey');
      });

      it('should have 90 day TTL', () => {
        const ninetyDaysInSeconds = 60 * 60 * 24 * 90;
        expect(ContainerConfigs.TELEMETRY.defaultTtl).to.equal(ninetyDaysInSeconds);
      });
    });

    describe('SESSIONS', () => {
      it('should have correct name', () => {
        expect(ContainerConfigs.SESSIONS.name).to.equal('sessions');
      });

      it('should have userId as partition key', () => {
        expect(ContainerConfigs.SESSIONS.partitionKeyPath).to.equal('/userId');
      });

      it('should have 7 day TTL', () => {
        const sevenDaysInSeconds = 60 * 60 * 24 * 7;
        expect(ContainerConfigs.SESSIONS.defaultTtl).to.equal(sevenDaysInSeconds);
      });
    });

    describe('TRIBAL_KNOWLEDGE', () => {
      it('should have correct name', () => {
        expect(ContainerConfigs.TRIBAL_KNOWLEDGE.name).to.equal('tribal-knowledge');
      });

      it('should have repository as partition key', () => {
        expect(ContainerConfigs.TRIBAL_KNOWLEDGE.partitionKeyPath).to.equal('/repository');
      });

      it('should have no TTL (value -1)', () => {
        expect(ContainerConfigs.TRIBAL_KNOWLEDGE.defaultTtl).to.equal(-1);
      });
    });

    describe('USER_PREFERENCES', () => {
      it('should have correct name', () => {
        expect(ContainerConfigs.USER_PREFERENCES.name).to.equal('user-preferences');
      });

      it('should have userId as partition key', () => {
        expect(ContainerConfigs.USER_PREFERENCES.partitionKeyPath).to.equal('/userId');
      });

      it('should have no TTL (value -1)', () => {
        expect(ContainerConfigs.USER_PREFERENCES.defaultTtl).to.equal(-1);
      });
    });

    describe('COST_TRACKING', () => {
      it('should have correct name', () => {
        expect(ContainerConfigs.COST_TRACKING.name).to.equal('cost-tracking');
      });

      it('should have correct partition key path', () => {
        expect(ContainerConfigs.COST_TRACKING.partitionKeyPath).to.equal('/partitionKey');
      });

      it('should have 1 year TTL', () => {
        const oneYearInSeconds = 60 * 60 * 24 * 365;
        expect(ContainerConfigs.COST_TRACKING.defaultTtl).to.equal(oneYearInSeconds);
      });
    });
  });

  describe('CosmosErrorCode', () => {
    it('should have NOT_FOUND', () => {
      expect(CosmosErrorCode.NOT_FOUND).to.equal('NOT_FOUND');
    });

    it('should have CONFLICT', () => {
      expect(CosmosErrorCode.CONFLICT).to.equal('CONFLICT');
    });

    it('should have PRECONDITION_FAILED', () => {
      expect(CosmosErrorCode.PRECONDITION_FAILED).to.equal('PRECONDITION_FAILED');
    });

    it('should have TOO_MANY_REQUESTS', () => {
      expect(CosmosErrorCode.TOO_MANY_REQUESTS).to.equal('TOO_MANY_REQUESTS');
    });

    it('should have SERVICE_UNAVAILABLE', () => {
      expect(CosmosErrorCode.SERVICE_UNAVAILABLE).to.equal('SERVICE_UNAVAILABLE');
    });

    it('should have TIMEOUT', () => {
      expect(CosmosErrorCode.TIMEOUT).to.equal('TIMEOUT');
    });

    it('should have INVALID_INPUT', () => {
      expect(CosmosErrorCode.INVALID_INPUT).to.equal('INVALID_INPUT');
    });

    it('should have AUTHENTICATION_ERROR', () => {
      expect(CosmosErrorCode.AUTHENTICATION_ERROR).to.equal('AUTHENTICATION_ERROR');
    });

    it('should have FORBIDDEN', () => {
      expect(CosmosErrorCode.FORBIDDEN).to.equal('FORBIDDEN');
    });

    it('should have UNKNOWN_ERROR', () => {
      expect(CosmosErrorCode.UNKNOWN_ERROR).to.equal('UNKNOWN_ERROR');
    });
  });

  describe('configuration', () => {
    it('should use default endpoint from environment', () => {
      const originalEnv = process.env.AZURE_COSMOS_ENDPOINT;
      process.env.AZURE_COSMOS_ENDPOINT = '';

      const service = new CosmosDBService();
      const status = service.getStatus();
      expect(status.endpoint).to.equal('');

      process.env.AZURE_COSMOS_ENDPOINT = originalEnv;
    });

    it('should allow custom connection timeout', () => {
      const service = new CosmosDBService({
        endpoint: '',
        connectionTimeoutMs: 5000,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should allow custom request timeout', () => {
      const service = new CosmosDBService({
        endpoint: '',
        requestTimeoutMs: 60000,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should allow custom retry attempts', () => {
      const service = new CosmosDBService({
        endpoint: '',
        maxRetryAttempts: 5,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should allow custom retry delay', () => {
      const service = new CosmosDBService({
        endpoint: '',
        retryDelayMs: 2000,
      });
      expect(service).to.be.instanceOf(CosmosDBService);
    });

    it('should allow disabling logging', () => {
      const service = new CosmosDBService({
        endpoint: '',
        enableLogging: false,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.false;
    });

    it('should allow enabling logging', () => {
      const service = new CosmosDBService({
        endpoint: '',
        enableLogging: true,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.true;
    });

    it('should allow all config options together', () => {
      const service = new CosmosDBService({
        endpoint: '',
        databaseName: 'custom-db',
        connectionTimeoutMs: 5000,
        requestTimeoutMs: 30000,
        enableLogging: true,
        maxRetryAttempts: 3,
        retryDelayMs: 1000,
      });
      const status = service.getStatus();
      expect(status.databaseName).to.equal('custom-db');
      expect(status.enableLogging).to.be.true;
    });
  });
});
