using '../main.bicep'
param environment = 'dev'
param location = 'eastus2'
param baseName = 'devmind6'
param searchLocation = 'eastus'
param tags = {
  Project: 'DevMind AI'
  Environment: 'dev'
}
param gpt4oCapacity = 10
param gpt4oMiniCapacity = 10
param embeddingCapacity = 60
param searchSku = 'basic'
param searchPartitionCount = 1
param searchReplicaCount = 1
param cosmosDbDatabaseName = 'devmind-db'
param storageSku = 'Standard_LRS'
param keyVaultEnablePurgeProtection = false
param logAnalyticsRetentionInDays = 30
