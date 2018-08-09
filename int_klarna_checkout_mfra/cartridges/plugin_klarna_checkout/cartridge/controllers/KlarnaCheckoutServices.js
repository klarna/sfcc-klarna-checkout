'use strict';

var server = require('server');

var BasketMgr = require('dw/order/BasketMgr');
var URLUtils = require('dw/web/URLUtils');
var Transaction = require('dw/system/Transaction');

/* Script Modules */
var KlarnaOrderService = require('~/cartridge/scripts/services/KlarnaOrderService');
var KlarnaHelpers = require('~/cartridge/scripts/util/klarnaHelpers');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');


/**
 * Updates the Klarna order when a shipping method or address if the checkout has changed
 * @transactional
 */
server.post('Update', server.middleware.https, function (req, res, next) {
    var KlarnaOrderUpdateResponseBuilder = require('~/cartridge/scripts/order/klarnaOrderUpdateResponseBuilder');

    var basket = BasketMgr.getCurrentOrNewBasket();
    var klarnaOrderObject = JSON.parse(req.body);

    if (!klarnaOrderObject) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    Transaction.wrap(function () {
        KlarnaHelpers.restoreBasket(basket, klarnaOrderObject);
    });

    var klarnaOrderUpdateResponseBuilder = new KlarnaOrderUpdateResponseBuilder();
    var orderUpdateResponse = klarnaOrderUpdateResponseBuilder.buildResponse({
        basket: basket,
        showShippingMethods: !!klarnaOrderObject.selected_shipping_option
    }).get();

    var json = JSON.stringify(orderUpdateResponse);
    res.setStatusCode(200);
    res.setContentType('application/json');
    res.print(json);

    return next();
});

/**
 * Validate the Klarna order
 */
server.post('Validation', server.middleware.https, function (req, res, next) {
    var OrderMgr = require('dw/order/OrderMgr');
    var klarnaOrderObject = JSON.parse(req.body);

    var order = OrderMgr.getOrder(klarnaOrderObject.merchant_reference1);

    if (!order) {
        order = KlarnaHelpers.createOrder(klarnaOrderObject);

        if (!order) {
            res.redirect(URLUtils.https('Cart-Show'));
            return;
        }
    }

    res.setStatusCode(200);
});

/**
 * Updates Klarna Checkout iFrame
 */
server.get('UpdateCheckout', server.middleware.https, function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();

    if (!currentBasket) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    var localeObject = KlarnaHelpers.getLocaleObject(null, req.locale.id);

    COHelpers.recalculateBasket(currentBasket);

    var isUpdated;
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderID = req.session.privacyCache.get('klarnaOrderID');

    if (!klarnaOrderID) {
        isUpdated = klarnaOrderService.createOrder(currentBasket, localeObject, req);
    } else {
        isUpdated = klarnaOrderService.updateOrder(currentBasket, localeObject, klarnaOrderID);
    }

    if (!isUpdated) {
        res.json({ success: false });
    } else {
        res.json({ success: true });
    }

    return next();
});

/**
 * Verify with Klarna that the order has been created in SFCC
 */
server.post('Push', server.middleware.https, function (req, res, next) {
    var klarnaOrderID = req.querystring.klarna_order_id;
    var klarnaCountry = req.querystring.klarna_country;
    var localeId = req.locale.id;

    if (!klarnaOrderID || !klarnaCountry) {
        res.setStatusCode(200);
    next();
    }

    var localeObject = KlarnaHelpers.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);

    var placeOrderResult = KlarnaHelpers.placeOrder({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject,
        localeId: localeId
    });

    if (placeOrderResult.order_created) {
        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject);
    }

    res.setStatusCode(200);
    next();
});


/**
 *  Entry point for notifications on pending orders
 */
server.post('Notification', server.middleware.https, function (req, res, next) {
    var klarnaFraudDecisionObject = JSON.parse(req.body);
    var klarnaOrderID = klarnaFraudDecisionObject.order_id;
    var klarnaCountry = req.querystring.klarna_country;
    var localeId = req.locale.id;

    var localeObject = KlarnaHelpers.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);

    if (klarnaOrderObject) {
        KlarnaHelpers.placeOrder({
            klarnaOrderObject: klarnaOrderObject,
            localeObject: localeObject,
            isPendingOrder: true,
            localeId: localeId
        });
    }

    res.setStatusCode(200);
    next();
});

module.exports = server.exports();
