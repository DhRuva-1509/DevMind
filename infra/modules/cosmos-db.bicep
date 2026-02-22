@description('Name of the Cosmos DB account')
param name string

@description('Azure Region for the Cosmos DB account')
param location string

@description('Resource tags')
param tags object

@description('Database name')
param databaseName string

@description('Containers to create')
param containers array

resource cosmosDbAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: name
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    consistencyPolicy:{
      defaultConsistencyLevel: 'Session'
    }
    locations:[{
      locationName: location
      failoverPriority: 0
      isZoneRedundant: false
    }]
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]

    enableAutomaticFailover: false
    enableMultipleWriteLocations: false
    publicNetworkAccess: 'Enabled'
    networkAclBypass: 'AzureServices'
    disableLocalAuth: false
  }
}

/*
  RESOURCE: Cosmos DB SQL Database
*/
resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = { 
  parent: cosmosDbAccount
  name: databaseName
  properties:{ 
    resource: {
      id: databaseName
    }
  }
}


/*
  RESOURCE: Cosmos DB SQL Containers
*/

resource cosmosContainers 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = [for container in containers: {
  parent: database
  name: container.name
  properties: {
    resource: {
      id: container.name
      partitionKey: {
        paths: [container.partitionKey]
        kind: 'Hash'
        version: 2
      }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [
          {
            path: '/*'
          }
        ]
        excludedPaths: [
          {
            path: '/_etag/?'
          }
        ]
      }
      defaultTtl: container.ttl
    }
  }
}]

/*  
Outputs
*/
@description('Cosmos DB account ID')
output id string = cosmosDbAccount.id

@description('Cosmos DB account name')
output name string = cosmosDbAccount.name

@description('Cosmos DB account endpoint')
output endpoint string = cosmosDbAccount.properties.documentEndpoint

@description('Cosmos DB SQL database name')
output sqlDatabaseName string = database.name
