@description('NAme if the Azure AI Search service')
param name string

@description('Azure Region')
param location string

@description('Resource tags')
param tags object

@description('SKU for the Azure AI search service')
@allowed(['free','basic', 'standard','standard2','standard3'])
param sku string

@minValue(1)
@maxValue(12)
@description('Number of replicas')
param replicaCount int = 1

@description('Number of partitions')
@allowed([1,2,3,4,6,12])
param partitionCount int = 1

@description('Semantic search configuration')
@allowed(['disabled','free', 'standard'])
param semanticSearch string = 'free'

resource searchService 'Microsoft.Search/searchServices@2023-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  properties:{
    replicaCount: replicaCount
    partitionCount: partitionCount
    hostingMode: 'default'
    publicNetworkAccess: 'enabled'
    networkRuleSet: {
      ipRules: []
    }
    disableLocalAuth: false
    authOptions: {
      apiKeyOnly: {}
    }
    semanticSearch: semanticSearch
  }
}

@description('Search service resource ID')
output id string = searchService.id

@description('Search service name')
output name string = searchService.name

@description('Search service endpoint')
output endpoint string = 'https://${searchService.name}.search.windows.net'

@description('Search service admin key')
output adminKey string = searchService.listAdminKeys().primaryKey
