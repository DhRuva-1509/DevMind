// ============================================================================
// storage.bicep - Azure Blob Storage
// ============================================================================

// ============================================================================
// PARAMETERS
// ============================================================================

@description('Name of the storage account')
@minLength(3)
@maxLength(24)
param name string

@description('Azure region')
param location string

@description('Resource tags')
param tags object = {}

@description('Storage SKU')
@allowed(['Standard_LRS', 'Standard_GRS', 'Standard_ZRS', 'Premium_LRS'])
param sku string = 'Standard_LRS'

@description('Access tier')
@allowed(['Hot', 'Cool'])
param accessTier string = 'Hot'

@description('Blob containers to create')
param containers array = []

// ============================================================================
// RESOURCE: Storage Account
// ============================================================================

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: sku
  }
  kind: 'StorageV2'
  properties: {
    accessTier: accessTier
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
    encryption: {
      services: {
        blob: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

// ============================================================================
// RESOURCE: Blob Service
// ============================================================================

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

// ============================================================================
// RESOURCE: Containers
// ============================================================================

resource documentationContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'documentation'
  properties: {
    publicAccess: 'None'
  }
}

resource uploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'uploads'
  properties: {
    publicAccess: 'None'
  }
}

resource promptsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'prompts'
  properties: {
    publicAccess: 'None'
  }
}

resource tempContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: 'temp'
  properties: {
    publicAccess: 'None'
  }
}

// ============================================================================
// RESOURCE: Lifecycle Policy
// ============================================================================

resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  dependsOn: [
    tempContainer
    uploadsContainer
  ]
  properties: {
    policy: {
      rules: [
        {
          name: 'delete-temp-files'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['temp/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 1
                }
              }
            }
          }
        }
        {
          name: 'delete-uploads-after-3-days'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: ['blockBlob']
              prefixMatch: ['uploads/']
            }
            actions: {
              baseBlob: {
                delete: {
                  daysAfterModificationGreaterThan: 3
                }
              }
            }
          }
        }
      ]
    }
  }
}

// ============================================================================
// OUTPUTS
// ============================================================================

@description('Storage account ID')
output id string = storageAccount.id

@description('Storage account name')
output name string = storageAccount.name

@description('Blob endpoint')
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
