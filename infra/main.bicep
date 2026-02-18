module openAi 'modules/openai.bicep' = {
  name: 'openAi'
  params: {
    location: 'eastus2'
    name: 'oai-devmind-dev'
    tags: {
      Project: 'DevMind AI'
      Environment: 'dev'
    }
    deployments: [
      {
        name: 'gpt-4o'
        modelName: 'gpt-4o'
        version: '2024-08-06'
        capacity: 10
      }
      {
        name: 'gpt-4o-mini'
        modelName: 'gpt-4o-mini'
        version: '2024-07-18'
        capacity: 10
      }
      {
        name: 'text-embedding-3-small'
        modelName: 'text-embedding-3-small'
        version: '1'
        capacity: 120
      }
    ]
  }
}
