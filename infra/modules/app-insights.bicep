@description('Name of the Applications Insights resource')
param name string

@description('Azure Region for the Application Insights resource')
param location string

@description('Resource tags')
param tags object

@description('Log Analytics workspace ID')
param logAnalyticsWorkspaceId string

@description('Application type')
@allowed(['web', 'other'])
param applicationType string = 'web'

resource appInsights 'Microsoft.Insights/components@2020-02-02' = { 
  name: name
  location: location
  tags: tags
  kind: 'web'
  properties: { 
    Application_Type:applicationType
    WorkspaceResourceId: logAnalyticsWorkspaceId
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
    RetentionInDays:90
  }
}

@description('Application Insights ID')
output id string = appInsights.id

@description('Application Insights name')
output name string = appInsights.name

@description('Application Insights instrumentation key')
output instrumentationKey string = appInsights.properties.InstrumentationKey

@description('Application Insights connection string')
output connectionString string = appInsights.properties.ConnectionString
