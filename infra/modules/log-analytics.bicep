@description('Name of the Log Analytics workspace')
param name string

@description('Azure region for the Log Analytics workspace')
param location string

@description('Resource tags')
param tags object

@description('SKU name')
@allowed(['Free', 'PerGB2018', 'PerNode', 'Premium', 'Standalone', 'Standard'])
param sku string

@description('Data retention in days')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30


resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = { 
  name: name
  location: location
  tags: tags
  properties: { 
    sku: { 
      name: sku
    }
    retentionInDays: retentionInDays
    features: { 
      enableLogAccessUsingOnlyResourcePermissions: true
    }

    workspaceCapping: { 
      dailyQuotaGb: -1 
    }

    publicNetworkAccessForIngestion:'Enabled'
    publicNetworkAccessForQuery:'Enabled'
  }
}

@description('Log Analytics workspace ID')
output id string = logAnalytics.id

@description('Log Analytics workspace name')
output name string = logAnalytics.name

@description('Log Analytics customer ID')
output customerId string = logAnalytics.properties.customerId
