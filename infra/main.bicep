// Azure Static Web App (Free tier) for the Barnes H3 hareline.
// az deployment group create -g rg-barnesh3 -f infra/main.bicep -p customDomain=barnesh3.com
@description('Name of the static web app')
param name string = 'swa-barnesh3'

@description('Static Web Apps is only offered in some regions; westeurope is closest to London')
param location string = 'westeurope'

@description('Optional custom domain, added once DNS points at the app')
param customDomain string = ''

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: name
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // Deployed from GitHub Actions with the deployment token, so no repo link here.
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource domain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (!empty(customDomain)) {
  parent: site
  name: empty(customDomain) ? 'placeholder' : customDomain
  properties: {}
}

output defaultHostname string = site.properties.defaultHostname
// Retrieve the deployment token with:
// az staticwebapp secrets list -n <name> --query properties.apiKey -o tsv
