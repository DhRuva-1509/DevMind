// src/services/azure/index.ts

// Auth Service
export { AzureAuthService, azureAuthService } from './auth/auth.service';
export * from './auth/auth.types';

// Key Vault Service
export { KeyVaultService, keyVaultService } from './keyvault/keyvault.service';
export * from './keyvault/keyvault.types';

// OpenAI Service
export { AzureOpenAIService, azureOpenAIService } from './openai/openai.service';
export * from './openai/openai.types';

// Search Service
export { AzureSearchService, azureSearchService } from './search/search.service';
export * from './search/search.types';

// Cosmos DB Service
export { CosmosDBService, cosmosDBService } from './cosmos/cosmos.service';
export * from './cosmos/cosmos.types';

// Blob Storage Service
export { BlobStorageService, blobStorageService } from './blob/blob.service';
export * from './blob/blob.types';
