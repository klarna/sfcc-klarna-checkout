# Klarna Checkout 2017-2022 Link Cartridge
Version 22.1.0


## Integration

Please check ./documentation/Klarna Chekout Integration Documentation.docx (for SiteGenesis) and ./documentation/SFRA Klarna Chekout Integration Documentation.docx (for SFRA) as the integration reference.

# NPM scripts
`npm install` - Install all of the local dependencies.  
`npm run compile:js` - Compiles all .js files and aggregates them.  
`npm run lint` - Execute linting for all JavaScript files in the project.  
`npm run uploadSfra` - Will upload `int_klarna_checkout_sfra` to the server. Requires a valid `dw.json` file at the root that is configured for the sandbox to upload.  
`npm run uploadSitegenesis` - Will upload `int_klarna_checkout` to the server. Requires a valid `dw.json` file at the root that is configured for the sandbox to upload.

## Tests

### Unit tests

In order to run the unit tests, do the following steps in the root of the project.

1. `npm install`
2. `npm run test`

### Integration tests

In order to run the integration tests, do the following steps in the root of the project.

1. `npm install`
2. Make sure you have a `dw.json` file pointing to a sandbox.
3. Make sure that the product id defined with `testProductId` in `it.config.js` is pointing to a valid and online product.
4. Change `baseUrl` in `it.config.js` if necessary.
5. `npm run test:integration`
