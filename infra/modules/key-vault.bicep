@description('Name of the Key Valut resource')
@minLength(3)
@maxLength(24)
param name string

@description('Azure Region for the Key Vault resource')
param location string

@description('Resource tags')
param tags object

@description('Key Vault SKU')
@allowed(['standard','premium'])
param sku string = 'standard'

@description('Enable soft delete')
param enableSoftDelete bool = true

@description('Soft delete retention days')
@minValue(7)
@maxValue(90)
param softDeleteRetentionDays int = 90

@description('Enable purge protection')
param enablePurgeProtection bool = false

@description('Enable RBAC authorization')
param enableRbacAuthorization bool = true

@description('Tenant ID')
param tenantId string = subscription().tenantId


resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = { 
  name: name
  location: location
  tags: tags
  properties: { 
    sku: { 
      family: 'A'
      name: sku
    }
    tenantId: tenantId
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: true
    enableSoftDelete: enableSoftDelete
    softDeleteRetentionInDays: softDeleteRetentionDays
    enablePurgeProtection: enablePurgeProtection == false ? true : null
    enableRbacAuthorization: enableRbacAuthorization
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
  }
}
}

@description('Key Vault ID')
output id string = keyVault.id

@description('Key Vault name')
output name string = keyVault.name

@description('Key Vault URI')
output uri string = keyVault.properties.vaultUri
