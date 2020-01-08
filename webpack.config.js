/* globals cat, cd, cp, echo, exec, exit, find, ls, mkdir, rm, target, test */
'use strict';

require('shelljs/make');
var path = require('path');
var cartridgePath = './cartridges/int_klarna_checkout_sfra/cartridge/';

module.exports = [{
    mode: 'production',
    name: 'js',
    entry: {
        klarnaCheckout: path.join(__dirname, cartridgePath + '/client/js/default/klarnaCheckout.js'),
        klarnaOsm: path.join(__dirname, cartridgePath + '/client/js/default/klarnaOsm.js')
    },
    output: {
        path: path.resolve(cartridgePath + './static/default/js/'),
        filename: '[name].js'
    },
    optimization: {
        minimize: true
    }
}];
