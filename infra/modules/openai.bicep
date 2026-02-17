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

