using '../main.bicep'

param environment = 'dev'
param location = 'eastus2'
param baseName = 'devmind'
param tags = {
  Project: 'DevMind AI'
  Environment: 'dev'
}

//OpenAI Capacities
param gpt4oCapacity = 10
param gpt4oMiniCapacity = 10
param embeddingCapacity = 120

//AI Search Configuration
param searchSku = 'basic'
param searchPartitionCount = 1
param searchReplicaCount = 1

//Cosmos DB Configuration
param cosmosDbDatabaseName = 'devmind-db'

//Storage Configuration
param storageSku = 'Standard_LRS'

// Key Vault Configuration
param keyVaultEnablePurgeProtection = false
