@description('Name of the OpenAI resource')
param name string

@description('Azure Region for the OpenAI resource')
param location string 

@description('Resource tags')
param tags object = {}

@description('SKU for the OpenAI resource -- Currently only supports "S0"')
param skuName string = 'S0'

@description('Model deployments to be created in the OpenAI resource')
param deployments array = []

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  kind: 'OpenAI'
  properties: {
    publicNetworkAccess: 'Enabled'
    customSubDomainName: name
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

@batchSize(1)
resource modelDeployments 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = [for deployment in deployments: {
  parent: openAiAccount
  name: deployment.name
  sku: {
    name: 'Standard'
    capacity: deployment.capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: deployment.modelName
      version: deployment.version
    }
  }
}]

@description('OpenAI resource ID')
output id string = openAiAccount.id

@description('OpenAI resource name')
output name string = openAiAccount.name

@description('OpenAI resource endpoint')
output endpoint string = openAiAccount.properties.endpoint
