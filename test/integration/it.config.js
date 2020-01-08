'use strict';

var getConfig = require('@tridnguyen/config');
var uuid = require('uuid/v1');

var opts = Object.assign({}, getConfig({
    baseUrl: 'https://' + global.baseUrl + '/on/demandware.store/Sites-RefArch-Site/en_US',
    testProductId: '701643421084M',
    orderNumber: uuid(),
    suite: '*',
    reporter: 'spec',
    timeout: 60000,
    locale: 'x_default'
}, './config.json'));

module.exports = opts;
