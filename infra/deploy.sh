#!/bin/bash
set -e

# ── Config — fill these in before running ─────────────────────────────────────
TENANT_ID=""
SUBSCRIPTION_ID=""
BASE_NAME="devmind7"
RESOURCE_GROUP="rg-devmind-dev"
LOCATION="eastus2"
SEARCH_LOCATION="eastus"
COSMOS_DB_NAME="devmind-db"
# ─────────────────────────────────────────────────────────────────────────────

echo "=== DevMind Deployment ==="

az login --tenant "$TENANT_ID"
az account set --subscription "$SUBSCRIPTION_ID"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION"

az search service create \
  --name "srch-${BASE_NAME}-dev" \
  --resource-group "$RESOURCE_GROUP" \
  --sku basic \
  --location "$SEARCH_LOCATION" \
  --partition-count 1 \
  --replica-count 1

az deployment group create \
  --resource-group "$RESOURCE_GROUP" \
  --template-file infra/main.bicep \
  --parameters infra/parameters/dev.bicepparam

for container in pr-summaries pr-context-cache; do
  az cosmosdb sql container create \
    --account-name "cosmos-${BASE_NAME}-dev" \
    --resource-group "$RESOURCE_GROUP" \
    --database-name "$COSMOS_DB_NAME" \
    --name "$container" \
    --partition-key-path "/partitionKey"
done

echo ""
echo "=== Copy these to your .env ==="

echo -n "AZURE_OPENAI_ENDPOINT=https://oai-${BASE_NAME}-dev.openai.azure.com/"
echo ""
echo -n "AZURE_OPENAI_API_KEY="
az cognitiveservices account keys list \
  --name "oai-${BASE_NAME}-dev" \
  --resource-group "$RESOURCE_GROUP" \
  --query "key1" -o tsv

echo -n "AZURE_SEARCH_ENDPOINT=https://srch-${BASE_NAME}-dev.search.windows.net"
echo ""
echo -n "AZURE_SEARCH_API_KEY="
az search admin-key show \
  --service-name "srch-${BASE_NAME}-dev" \
  --resource-group "$RESOURCE_GROUP" \
  --query "primaryKey" -o tsv

echo -n "AZURE_COSMOS_ENDPOINT=https://cosmos-${BASE_NAME}-dev.documents.azure.com:443/"
echo ""
echo -n "AZURE_COSMOS_KEY="
az cosmosdb keys list \
  --name "cosmos-${BASE_NAME}-dev" \
  --resource-group "$RESOURCE_GROUP" \
  --query "primaryMasterKey" -o tsv

echo "AZURE_STORAGE_ACCOUNT_URL=https://st${BASE_NAME//-/}dev.blob.core.windows.net/"
echo "AZURE_KEYVAULT_URL=https://kv-${BASE_NAME}-dev.vault.azure.net/"

echo ""
echo "=== Done ==="
