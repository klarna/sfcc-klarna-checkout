'use strict';

var STOREFRONT_CARTRIDGE = require('~/cartridge/scripts/util/klarnaConstants.js').STOREFRONT_CARTRIDGE;

var page = require(STOREFRONT_CARTRIDGE + '/cartridge/controllers/Order');
var server = require('server');

/* API Includes */
var URLUtils = require('dw/web/URLUtils');
var Locale = require('dw/util/Locale');
var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');

/* Script Modules */
var OrderModel = require('*/cartridge/models/order');
var KlarnaOrderService = require('~/cartridge/scripts/services/KlarnaOrderService');
var KlarnaHelpers = require('~/cartridge/scripts/util/klarnaHelpers');

server.extend(page);


/**
 * Render the Klarna confirmation snippet
 */
server.replace('Confirm', server.middleware.https, function (req, res, next) {
    var Resource = require('dw/web/Resource');

    if (req.session.privacyCache.get('klarnaOrderID')) {
        req.session.privacyCache.set('klarnaOrderID', null);
    } else {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    var klarnaOrderID = req.querystring.klarna_order_id;
    var klarnaCountry = req.querystring.klarna_country;

    if (!klarnaOrderID || !klarnaCountry) {
        var placeOrderError = Resource.msg('error.technical', 'checkout', null);
        res.redirect(URLUtils.https('Checkout-Begin', 'err', placeOrderError).toString());
        return next();
    }

    var localeObject = KlarnaHelpers.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject);

    if (!klarnaOrderObject) {
        var placeOrderError = Resource.msg('error.technical', 'checkout', null);
        res.redirect(URLUtils.https('Checkout-Begin', 'err', placeOrderError).toString());
        return next();
    }

    var placeOrderResult =  KlarnaHelpers.placeOrder({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject,
        localeId: req.locale.id
    });

    if (placeOrderResult.error) {
        res.redirect(URLUtils.https('Checkout-Begin', 'err', placeOrderResult.errorMessage).toString());
    } else {
        var currentBasket = BasketMgr.getCurrentBasket();

        if (currentBasket) {
            Transaction.wrap(function () {
                KlarnaHelpers.clearBasket(currentBasket);
            });
        }

        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject);

        var config = {
            numberOfLineItems: '*'
        };

        var currentLocale = Locale.getLocale(req.locale.id);

        var orderModel = new OrderModel(
            placeOrderResult.order,
            { config: config, countryCode: currentLocale.country, containerView: 'order' }
        );

        res.render('checkout/klarnaConfirmation', {
            CurrentPageMetaData: {
                title: 'Klarna Confirmation'
            },
            order: orderModel,
            confirmationSnippet: placeOrderResult.confirmationSnippet
        });
    }
    return next();
});


module.exports = server.exports();
