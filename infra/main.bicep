targetScope = 'resourceGroup'

/*
AZURE OPENAI SERVICE PARAMETERS
*/
@description('Environment name')
@allowed(['dev','staging','prod'])
param environment string

@description('Azure region for all resources')
param location string

@description('Base name for all resources')
param baseName string

@description('Resource tags')
param tags object

@description('GPT-4o capacity in thoussands of tokens per minute')
param gpt4oCapacity int

@description('GPT-4o-mini capacity in thoussands of tokens per minute')
param gpt4oMiniCapacity int

@description('Embedding model capacity in thousands of tokens per minute')
param embeddingCapacity int


/*
AZURE AI SEARCH SERVICE PARAMETERS
*/
@description('AI Search SKU')
@allowed(['free','basic', 'standard','standard2','standard3'])
param searchSku string

@description('AI Search replica count')
param searchReplicaCount int

@description('AI Search partition count')
param searchPartitionCount int

/*
COSMOS DB PARAMETERS
*/
@description('Cosmos DB database name')
param cosmosDbDatabaseName string


/*
STORAGE PARAMETERS
*/
@description('Storage SKU')
@allowed(['Standard_LRS', 'Standard_GRS', 'Standard_ZRS', 'Premium_LRS'])
param storageSku string

/*
VARIABLES
*/
var openAiName = 'oai-${baseName}-${environment}'
var searchName = 'srch-${baseName}-${environment}'
var cosmosDbName = 'cosmos-${baseName}-${environment}'
var storageName = 'st${replace(baseName, '-', '')}${environment}'

/*
MODULES
*/
module openAi 'modules/openai.bicep' = {
  name: 'openAi'
  params: {
    location: location
    name: openAiName
    tags: tags
    deployments: [
      {
        name: 'gpt-4o'
        modelName: 'gpt-4o'
        version: '2024-08-06'
        capacity: gpt4oCapacity
      }
      {
        name: 'gpt-4o-mini'
        modelName: 'gpt-4o-mini'
        version: '2024-07-18'
        capacity: gpt4oMiniCapacity
      }
      {
        name: 'text-embedding-3-small'
        modelName: 'text-embedding-3-small'
        version: '1'
        capacity: embeddingCapacity
      }
    ]
  }
}

module search 'modules/ai-search.bicep' = {
  name: 'search'
  params: {
    name: searchName
    location: location
    tags: tags
    sku: searchSku
    replicaCount: searchReplicaCount
    partitionCount: searchPartitionCount
  }
}

module cosmoDb 'modules/cosmos-db.bicep' = {
  name: 'cosmosDb'
  params: { 
    name: cosmosDbName
    location: location
    tags: tags
    databaseName: cosmosDbDatabaseName
    containers: [
      {
        name: 'telemetry'
        partitionKey: '/agentName'
        ttl: 2592000 // 30 days in seconds
      }
      {
        name: 'sessions'
        partitionKey: '/userId'
        ttl: 604800 // 7 days in seconds
      }
      {
        name: 'pr-comments'
        partitionKey: '/repositoryId'
        ttl: -1
      }
      {
        name: 'cost-tracking'
        partitionKey: '/date'
        ttl: 7776000 // 90 days in seconds
      }
    ]
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: storageName
    location: location
    tags: tags
    sku: storageSku
  }
}

output openAiEndpoint string = openAi.outputs.endpoint
output openAiName string = openAi.outputs.name
output searchEndpoint string = search.outputs.endpoint
output searchName string = search.outputs.name
output cosmosDbEndpoint string = cosmoDb.outputs.endpoint
output cosmosDbName string = cosmoDb.outputs.name
output storageBlobEndpoint string = storage.outputs.blobEndpoint
output storageName string = storage.outputs.name
