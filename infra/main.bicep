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
VARIABLES
*/
var openAiName = 'oai-${baseName}-${environment}'
var searchName = 'srch-${baseName}-${environment}'


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

output openAiEndpoint string = openAi.outputs.endpoint
output openAiName string = openAi.outputs.name
