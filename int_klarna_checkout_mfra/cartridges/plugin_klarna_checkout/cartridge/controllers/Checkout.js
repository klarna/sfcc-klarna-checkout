'use strict';

var STOREFRONT_CARTRIDGE = require('plugin_klarna_checkout/cartridge/scripts/util/klarnaConstants.js').STOREFRONT_CARTRIDGE;

var page = require(STOREFRONT_CARTRIDGE + '/cartridge/controllers/Checkout');
var server = require('server');


server.extend(page);

server.replace('Login', server.middleware.get, function (req, res, next) {
	var URLUtils = require('dw/web/URLUtils');

	res.redirect(URLUtils.https('KlarnaCheckout-Start'));
    next();
});


module.exports = server.exports();
