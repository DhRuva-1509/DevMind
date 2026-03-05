import { expect } from 'chai';
import * as sinon from 'sinon';
import { AzureSearchService } from './search.service';
import { SearchErrorCode, IndexSchemas } from './search.types';

describe('AzureSearchService', () => {
  let searchService: AzureSearchService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    searchService = new AzureSearchService({
      endpoint: '',
      indexName: 'test-index',
      enableSemanticSearch: true,
      enableLogging: true,
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ============================================================
  // CONSTRUCTOR TESTS
  // ============================================================

  describe('constructor', () => {
    it('should create instance with default config', () => {
      const service = new AzureSearchService();
      expect(service).to.be.instanceOf(AzureSearchService);
    });

    it('should create instance with custom config', () => {
      const service = new AzureSearchService({
        endpoint: 'https://test.search.windows.net',
        indexName: 'custom-index',
        enableSemanticSearch: false,
        defaultTopK: 20,
      });
      expect(service).to.be.instanceOf(AzureSearchService);
    });

    it('should not be initialized without endpoint', () => {
      const service = new AzureSearchService({ endpoint: '' });
      expect(service.isInitialized).to.be.false;
    });

    it('should use default index name when not provided', () => {
      const service = new AzureSearchService({ endpoint: '' });
      const status = service.getStatus();
      expect(status.defaultIndex).to.equal('documentation');
    });

    it('should use custom index name when provided', () => {
      const service = new AzureSearchService({
        endpoint: '',
        indexName: 'my-custom-index',
      });
      const status = service.getStatus();
      expect(status.defaultIndex).to.equal('my-custom-index');
    });
  });

  // ============================================================
  // GET STATUS TESTS
  // ============================================================

  describe('getStatus', () => {
    it('should return service status object', () => {
      const status = searchService.getStatus();

      expect(status).to.have.property('isInitialized');
      expect(status).to.have.property('endpoint');
      expect(status).to.have.property('defaultIndex');
      expect(status).to.have.property('enableSemanticSearch');
      expect(status).to.have.property('enableLogging');
    });

    it('should show correct default index', () => {
      const status = searchService.getStatus();
      expect(status.defaultIndex).to.equal('test-index');
    });

    it('should show semantic search enabled', () => {
      const status = searchService.getStatus();
      expect(status.enableSemanticSearch).to.be.true;
    });

    it('should show logging enabled', () => {
      const status = searchService.getStatus();
      expect(status.enableLogging).to.be.true;
    });

    it('should show not initialized when no endpoint', () => {
      const status = searchService.getStatus();
      expect(status.isInitialized).to.be.false;
    });

    it('should show empty endpoint', () => {
      const status = searchService.getStatus();
      expect(status.endpoint).to.equal('');
    });
  });

  // ============================================================
  // CREATE INDEX TESTS
  // ============================================================

  describe('createIndex', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.createIndex({
        name: 'test-index',
        fields: [
          { name: 'id', type: 'Edm.String', key: true },
          { name: 'content', type: 'Edm.String', searchable: true },
        ],
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should include index name in error response', async () => {
      const result = await searchService.createIndex({
        name: 'my-index',
        fields: [{ name: 'id', type: 'Edm.String', key: true }],
      });

      expect(result.indexName).to.equal('my-index');
    });

    it('should accept index configuration with vector fields', async () => {
      const result = await searchService.createIndex({
        name: 'test-index',
        fields: [
          { name: 'id', type: 'Edm.String', key: true },
          { name: 'content', type: 'Edm.String', searchable: true },
          {
            name: 'contentVector',
            type: 'Collection(Edm.Single)',
            dimensions: 3072,
            vectorSearchProfile: 'vector-profile',
          },
        ],
        vectorProfiles: [{ name: 'vector-profile', algorithmConfigurationName: 'hnsw-algo' }],
        vectorAlgorithms: [{ name: 'hnsw-algo', kind: 'hnsw' }],
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should accept index configuration with semantic search', async () => {
      const result = await searchService.createIndex({
        name: 'test-index',
        fields: [
          { name: 'id', type: 'Edm.String', key: true },
          { name: 'title', type: 'Edm.String', searchable: true },
          { name: 'content', type: 'Edm.String', searchable: true },
        ],
        semanticConfigName: 'semantic-config',
        semanticTitleField: 'title',
        semanticContentFields: ['content'],
      });

      expect(result.success).to.be.false;
    });

    it('should accept vector algorithm with hnsw parameters', async () => {
      const result = await searchService.createIndex({
        name: 'test-index',
        fields: [{ name: 'id', type: 'Edm.String', key: true }],
        vectorProfiles: [{ name: 'vector-profile', algorithmConfigurationName: 'hnsw-algo' }],
        vectorAlgorithms: [
          {
            name: 'hnsw-algo',
            kind: 'hnsw',
            parameters: {
              metric: 'cosine',
              m: 4,
              efConstruction: 400,
              efSearch: 500,
            },
          },
        ],
      });

      expect(result.success).to.be.false;
    });
  });

  // ============================================================
  // UPDATE INDEX TESTS
  // ============================================================

  describe('updateIndex', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.updateIndex({
        name: 'test-index',
        fields: [{ name: 'id', type: 'Edm.String', key: true }],
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should include index name in response', async () => {
      const result = await searchService.updateIndex({
        name: 'my-index',
        fields: [{ name: 'id', type: 'Edm.String', key: true }],
      });

      expect(result.indexName).to.equal('my-index');
    });
  });

  // ============================================================
  // DELETE INDEX TESTS
  // ============================================================

  describe('deleteIndex', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.deleteIndex('test-index');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should include index name in response', async () => {
      const result = await searchService.deleteIndex('my-index');

      expect(result.indexName).to.equal('my-index');
    });
  });

  // ============================================================
  // INDEX EXISTS TESTS
  // ============================================================

  describe('indexExists', () => {
    it('should return false when client not initialized', async () => {
      const exists = await searchService.indexExists('test-index');
      expect(exists).to.be.false;
    });

    it('should handle any index name', async () => {
      const exists = await searchService.indexExists('non-existent-index');
      expect(exists).to.be.false;
    });
  });

  // ============================================================
  // LIST INDEXES TESTS
  // ============================================================

  describe('listIndexes', () => {
    it('should return empty array when client not initialized', async () => {
      const indexes = await searchService.listIndexes();
      expect(indexes).to.be.an('array').that.is.empty;
    });
  });

  // ============================================================
  // GET INDEX STATS TESTS
  // ============================================================

  describe('getIndexStats', () => {
    it('should return null when client not initialized', async () => {
      const stats = await searchService.getIndexStats('test-index');
      expect(stats).to.be.null;
    });
  });

  // ============================================================
  // UPLOAD DOCUMENTS TESTS
  // ============================================================

  describe('uploadDocuments', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.uploadDocuments([{ id: 'doc1', content: 'Hello world' }]);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(1);
      expect(result.successCount).to.equal(0);
    });

    it('should report correct failed count for multiple documents', async () => {
      const documents = [
        { id: 'doc1', content: 'Hello' },
        { id: 'doc2', content: 'World' },
        { id: 'doc3', content: 'Test' },
      ];

      const result = await searchService.uploadDocuments(documents);

      expect(result.failedCount).to.equal(3);
      expect(result.successCount).to.equal(0);
    });

    it('should include error details', async () => {
      const result = await searchService.uploadDocuments([{ id: 'doc1', content: 'Test' }]);

      expect(result.errors).to.be.an('array');
      expect(result.errors![0]).to.have.property('errorMessage');
    });

    it('should accept documents with vector embeddings', async () => {
      const result = await searchService.uploadDocuments([
        {
          id: 'doc1',
          content: 'Hello world',
          contentVector: new Array(3072).fill(0.1),
        },
      ]);

      expect(result.success).to.be.false;
    });

    it('should accept documents with metadata', async () => {
      const result = await searchService.uploadDocuments([
        {
          id: 'doc1',
          content: 'Hello world',
          title: 'Test Document',
          library: 'react-query',
          version: '5.0.0',
        },
      ]);

      expect(result.success).to.be.false;
    });
  });

  // ============================================================
  // UPSERT DOCUMENTS TESTS
  // ============================================================

  describe('upsertDocuments', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.upsertDocuments([{ id: 'doc1', content: 'Hello world' }]);

      expect(result.success).to.be.false;
    });

    it('should report correct failed count', async () => {
      const result = await searchService.upsertDocuments([
        { id: 'doc1', content: 'Hello' },
        { id: 'doc2', content: 'World' },
      ]);

      expect(result.failedCount).to.equal(2);
    });
  });

  // ============================================================
  // DELETE DOCUMENTS TESTS
  // ============================================================

  describe('deleteDocuments', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.deleteDocuments(['doc1', 'doc2']);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(2);
    });

    it('should handle single document deletion', async () => {
      const result = await searchService.deleteDocuments(['doc1']);

      expect(result.success).to.be.false;
      expect(result.failedCount).to.equal(1);
    });

    it('should handle empty array', async () => {
      const result = await searchService.deleteDocuments([]);

      expect(result.failedCount).to.equal(0);
    });
  });

  // ============================================================
  // GET DOCUMENT TESTS
  // ============================================================

  describe('getDocument', () => {
    it('should return null when client not initialized', async () => {
      const doc = await searchService.getDocument('doc1');
      expect(doc).to.be.null;
    });

    it('should handle any document ID', async () => {
      const doc = await searchService.getDocument('non-existent-doc');
      expect(doc).to.be.null;
    });
  });

  // ============================================================
  // GET DOCUMENT COUNT TESTS
  // ============================================================

  describe('getDocumentCount', () => {
    it('should return 0 when client not initialized', async () => {
      const count = await searchService.getDocumentCount();
      expect(count).to.equal(0);
    });

    it('should accept custom index name', async () => {
      const count = await searchService.getDocumentCount('custom-index');
      expect(count).to.equal(0);
    });
  });

  // ============================================================
  // SEARCH TESTS
  // ============================================================

  describe('search', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.search({ searchText: 'test' });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
      expect(result.results).to.be.an('array').that.is.empty;
    });

    it('should include duration in response', async () => {
      const result = await searchService.search({ searchText: 'test' });

      expect(result).to.have.property('durationMs');
    });

    it('should accept search with top parameter', async () => {
      const result = await searchService.search({
        searchText: 'test query',
        top: 10,
      });

      expect(result.success).to.be.false;
    });

    it('should accept search with skip parameter', async () => {
      const result = await searchService.search({
        searchText: 'test',
        skip: 5,
      });

      expect(result.success).to.be.false;
    });

    it('should accept search with filter', async () => {
      const result = await searchService.search({
        searchText: 'test',
        filter: "library eq 'react-query'",
      });

      expect(result.success).to.be.false;
    });

    it('should accept search with select fields', async () => {
      const result = await searchService.search({
        searchText: 'test',
        select: ['id', 'content', 'title'],
      });

      expect(result.success).to.be.false;
    });

    it('should accept search with orderBy', async () => {
      const result = await searchService.search({
        searchText: 'test',
        orderBy: ['lastUpdated desc'],
      });

      expect(result.success).to.be.false;
    });

    it('should accept search with facets', async () => {
      const result = await searchService.search({
        searchText: 'test',
        facets: ['library', 'version'],
      });

      expect(result.success).to.be.false;
    });

    it('should accept search with highlight fields', async () => {
      const result = await searchService.search({
        searchText: 'test',
        highlightFields: ['content', 'title'],
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom index name', async () => {
      const result = await searchService.search({ searchText: 'test' }, 'custom-index');

      expect(result.success).to.be.false;
    });
  });

  // ============================================================
  // VECTOR SEARCH TESTS
  // ============================================================

  describe('vectorSearch', () => {
    it('should return error when client not initialized', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should return error for empty vector', async () => {
      const result = await searchService.vectorSearch([]);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.INVALID_VECTOR);
      expect(result.error).to.equal('Vector is required for vector search');
    });

    it('should return error for null vector', async () => {
      const result = await searchService.vectorSearch(null as unknown as number[]);

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.INVALID_VECTOR);
    });

    it('should accept vector search with top parameter', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector, { top: 5 });

      expect(result.success).to.be.false;
    });

    it('should accept vector search with filter', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector, {
        filter: "version eq '5.0.0'",
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom vector field', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector, {
        vectorField: 'customVectorField',
      });

      expect(result.success).to.be.false;
    });

    it('should accept vectorK parameter', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector, {
        vectorK: 20,
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom index name', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector, {}, 'custom-index');

      expect(result.success).to.be.false;
    });

    it('should include duration in response', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.vectorSearch(vector);

      expect(result).to.have.property('durationMs');
    });
  });

  // ============================================================
  // HYBRID SEARCH TESTS
  // ============================================================

  describe('hybridSearch', () => {
    it('should return error when client not initialized', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.hybridSearch({
        searchText: 'useQuery hook',
        vector,
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should return error for empty vector', async () => {
      const result = await searchService.hybridSearch({
        searchText: 'useQuery hook',
        vector: [],
      });

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.INVALID_VECTOR);
      expect(result.error).to.equal('Vector is required for hybrid search');
    });

    it('should accept hybrid search with filter', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.hybridSearch({
        searchText: 'useQuery hook',
        vector,
        filter: "library eq 'react-query'",
      });

      expect(result.success).to.be.false;
    });

    it('should accept hybrid search with top parameter', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.hybridSearch({
        searchText: 'useQuery',
        vector,
        top: 10,
      });

      expect(result.success).to.be.false;
    });

    it('should accept hybrid search with semantic search enabled', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.hybridSearch({
        searchText: 'useQuery',
        vector,
        enableSemanticSearch: true,
        semanticConfigName: 'semantic-config',
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom index name', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.hybridSearch(
        {
          searchText: 'test',
          vector,
        },
        'custom-index'
      );

      expect(result.success).to.be.false;
    });

    it('should include duration in response', async () => {
      const vector = new Array(3072).fill(0.1);
      const result = await searchService.hybridSearch({
        searchText: 'test',
        vector,
      });

      expect(result).to.have.property('durationMs');
    });
  });

  // ============================================================
  // SEMANTIC SEARCH TESTS
  // ============================================================

  describe('semanticSearch', () => {
    it('should return error when client not initialized', async () => {
      const result = await searchService.semanticSearch('useQuery hook');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.AUTHENTICATION_ERROR);
    });

    it('should return error when semantic search disabled', async () => {
      const service = new AzureSearchService({
        endpoint: '',
        enableSemanticSearch: false,
      });

      const result = await service.semanticSearch('test query');

      expect(result.success).to.be.false;
      expect(result.errorCode).to.equal(SearchErrorCode.INVALID_QUERY);
      expect(result.error).to.equal('Semantic search is not enabled');
    });

    it('should accept semantic search with options', async () => {
      const result = await searchService.semanticSearch('test query', {
        top: 5,
        filter: "library eq 'react-query'",
      });

      expect(result.success).to.be.false;
    });

    it('should accept custom index name', async () => {
      const result = await searchService.semanticSearch('test query', {}, 'custom-index');

      expect(result.success).to.be.false;
    });
  });

  // ============================================================
  // INDEX SCHEMAS TESTS
  // ============================================================

  describe('IndexSchemas', () => {
    describe('DOCUMENTATION schema', () => {
      it('should exist', () => {
        expect(IndexSchemas.DOCUMENTATION).to.exist;
      });

      it('should have correct name', () => {
        expect(IndexSchemas.DOCUMENTATION.name).to.equal('documentation');
      });

      it('should have fields array', () => {
        expect(IndexSchemas.DOCUMENTATION.fields).to.be.an('array');
      });

      it('should have required fields', () => {
        const fieldNames = IndexSchemas.DOCUMENTATION.fields.map((f) => f.name);

        expect(fieldNames).to.include('id');
        expect(fieldNames).to.include('content');
        expect(fieldNames).to.include('contentVector');
        expect(fieldNames).to.include('title');
        expect(fieldNames).to.include('library');
        expect(fieldNames).to.include('version');
        expect(fieldNames).to.include('section');
        expect(fieldNames).to.include('url');
        expect(fieldNames).to.include('lastUpdated');
      });

      it('should have 9 fields', () => {
        expect(IndexSchemas.DOCUMENTATION.fields).to.have.lengthOf(9);
      });

      it('should have id field as first field', () => {
        expect(IndexSchemas.DOCUMENTATION.fields[0].name).to.equal('id');
      });

      it('should have content field as second field', () => {
        expect(IndexSchemas.DOCUMENTATION.fields[1].name).to.equal('content');
      });

      it('should have contentVector field as third field', () => {
        expect(IndexSchemas.DOCUMENTATION.fields[2].name).to.equal('contentVector');
      });

      it('should have correct type for id field', () => {
        const idField = IndexSchemas.DOCUMENTATION.fields[0];
        expect(idField.type).to.equal('Edm.String');
      });

      it('should have correct type for contentVector field', () => {
        const vectorField = IndexSchemas.DOCUMENTATION.fields[2];
        expect(vectorField.type).to.equal('Collection(Edm.Single)');
      });

      it('should have correct type for lastUpdated field', () => {
        const lastUpdatedField = IndexSchemas.DOCUMENTATION.fields[8];
        expect(lastUpdatedField.type).to.equal('Edm.DateTimeOffset');
      });
    });

    describe('TRIBAL_KNOWLEDGE schema', () => {
      it('should exist', () => {
        expect(IndexSchemas.TRIBAL_KNOWLEDGE).to.exist;
      });

      it('should have correct name', () => {
        expect(IndexSchemas.TRIBAL_KNOWLEDGE.name).to.equal('tribal-knowledge');
      });

      it('should have fields array', () => {
        expect(IndexSchemas.TRIBAL_KNOWLEDGE.fields).to.be.an('array');
      });

      it('should have required fields', () => {
        const fieldNames = IndexSchemas.TRIBAL_KNOWLEDGE.fields.map((f) => f.name);

        expect(fieldNames).to.include('id');
        expect(fieldNames).to.include('content');
        expect(fieldNames).to.include('contentVector');
        expect(fieldNames).to.include('source');
        expect(fieldNames).to.include('author');
        expect(fieldNames).to.include('prNumber');
        expect(fieldNames).to.include('repository');
        expect(fieldNames).to.include('createdAt');
      });

      it('should have 8 fields', () => {
        expect(IndexSchemas.TRIBAL_KNOWLEDGE.fields).to.have.lengthOf(8);
      });

      it('should have id field as first field', () => {
        expect(IndexSchemas.TRIBAL_KNOWLEDGE.fields[0].name).to.equal('id');
      });

      it('should have correct type for prNumber field', () => {
        const prField = IndexSchemas.TRIBAL_KNOWLEDGE.fields.find((f) => f.name === 'prNumber');
        expect(prField).to.exist;
        expect(prField!.type).to.equal('Edm.Int32');
      });

      it('should have correct type for createdAt field', () => {
        const createdAtField = IndexSchemas.TRIBAL_KNOWLEDGE.fields[7];
        expect(createdAtField.type).to.equal('Edm.DateTimeOffset');
      });
    });
  });

  // ============================================================
  // ERROR CODES TESTS
  // ============================================================

  describe('SearchErrorCode', () => {
    it('should have INDEX_NOT_FOUND', () => {
      expect(SearchErrorCode.INDEX_NOT_FOUND).to.equal('INDEX_NOT_FOUND');
    });

    it('should have INDEX_ALREADY_EXISTS', () => {
      expect(SearchErrorCode.INDEX_ALREADY_EXISTS).to.equal('INDEX_ALREADY_EXISTS');
    });

    it('should have DOCUMENT_NOT_FOUND', () => {
      expect(SearchErrorCode.DOCUMENT_NOT_FOUND).to.equal('DOCUMENT_NOT_FOUND');
    });

    it('should have INVALID_QUERY', () => {
      expect(SearchErrorCode.INVALID_QUERY).to.equal('INVALID_QUERY');
    });

    it('should have INVALID_VECTOR', () => {
      expect(SearchErrorCode.INVALID_VECTOR).to.equal('INVALID_VECTOR');
    });

    it('should have AUTHENTICATION_ERROR', () => {
      expect(SearchErrorCode.AUTHENTICATION_ERROR).to.equal('AUTHENTICATION_ERROR');
    });

    it('should have QUOTA_EXCEEDED', () => {
      expect(SearchErrorCode.QUOTA_EXCEEDED).to.equal('QUOTA_EXCEEDED');
    });

    it('should have SERVICE_UNAVAILABLE', () => {
      expect(SearchErrorCode.SERVICE_UNAVAILABLE).to.equal('SERVICE_UNAVAILABLE');
    });

    it('should have RATE_LIMITED', () => {
      expect(SearchErrorCode.RATE_LIMITED).to.equal('RATE_LIMITED');
    });

    it('should have UNKNOWN_ERROR', () => {
      expect(SearchErrorCode.UNKNOWN_ERROR).to.equal('UNKNOWN_ERROR');
    });
  });

  // ============================================================
  // CONFIGURATION TESTS
  // ============================================================

  describe('configuration', () => {
    it('should use default topK of 10', () => {
      const service = new AzureSearchService({ endpoint: '' });
      const status = service.getStatus();
      expect(status).to.exist;
    });

    it('should allow custom defaultTopK', () => {
      const service = new AzureSearchService({
        endpoint: '',
        defaultTopK: 25,
      });
      expect(service).to.be.instanceOf(AzureSearchService);
    });

    it('should allow custom apiVersion', () => {
      const service = new AzureSearchService({
        endpoint: '',
        apiVersion: '2023-11-01',
      });
      expect(service).to.be.instanceOf(AzureSearchService);
    });

    it('should allow disabling semantic search', () => {
      const service = new AzureSearchService({
        endpoint: '',
        enableSemanticSearch: false,
      });
      const status = service.getStatus();
      expect(status.enableSemanticSearch).to.be.false;
    });

    it('should allow disabling logging', () => {
      const service = new AzureSearchService({
        endpoint: '',
        enableLogging: false,
      });
      const status = service.getStatus();
      expect(status.enableLogging).to.be.false;
    });
  });
});
