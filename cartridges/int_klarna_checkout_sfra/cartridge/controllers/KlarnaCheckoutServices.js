'use strict';

var server = require('server');

var KlarnaHelpers = require('*/cartridge/scripts/util/klarnaHelpers');

/**
 * Updates the Klarna order when a shipping method or address if the checkout has changed
 * @transactional
 */
server.post('Update', server.middleware.https, function (req, res, next) {
    var BasketMgr = require('dw/order/BasketMgr');
    var URLUtils = require('dw/web/URLUtils');
    var Transaction = require('dw/system/Transaction');
    var KlarnaOrderUpdateResponseBuilder = require('*/cartridge/scripts/order/klarnaOrderUpdateResponseBuilder');

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
server.post('Validation', server.middleware.https, function (req, res) {
    var URLUtils = require('dw/web/URLUtils');
    var OrderMgr = require('dw/order/OrderMgr');
    var klarnaOrderObject = JSON.parse(req.body);

    var order = OrderMgr.getOrder(klarnaOrderObject.merchant_reference1);

    if (!order) {
        order = KlarnaHelpers.createOrder(klarnaOrderObject);

        if (!order) {
            res.setStatusCode(303);
            res.setHttpHeader('Location', URLUtils.https('Cart-Show').toString());
            return;
        }
    }

    res.setStatusCode(200);
});

/**
 * Updates Klarna Checkout iFrame
 */
server.get('UpdateCheckout', server.middleware.https, function (req, res, next) {
    var BasketMgr = require('dw/order/BasketMgr');
    var URLUtils = require('dw/web/URLUtils');
    var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
    var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');

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
        isUpdated = klarnaOrderService.createOrder(currentBasket, localeObject, req.locale.id);
    } else {
        isUpdated = klarnaOrderService.updateOrder(currentBasket, localeObject, klarnaOrderID, req.locale.id);
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
server.post('Push', server.middleware.https, function (req, res) {
    var Order = require('dw/order/Order');
    var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');
    var FRAUD_STATUS = require('*/cartridge/scripts/util/klarnaConstants').FRAUD_STATUS;
    var klarnaOrderID = req.querystring.klarna_order_id;
    var klarnaCountry = req.querystring.klarna_country;
    var localeId = req.locale.id;

    if (!klarnaOrderID || !klarnaCountry) {
        res.setStatusCode(200);
        return;
    }

    var localeObject = KlarnaHelpers.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);

    var placeOrderResult = KlarnaHelpers.placeOrder({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject,
        localeId: localeId
    });

    var order = (placeOrderResult.order_created && placeOrderResult.order) ? placeOrderResult.order : null;

    if (order && order.confirmationStatus.value === Order.CONFIRMATION_STATUS_CONFIRMED) {
        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject);
    } else if (order && (order.status.value === Order.ORDER_STATUS_CREATED && klarnaOrderObject.fraud_status === FRAUD_STATUS.PENDING)) {
        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject); // @TODO Verify with Klarna if they want acknowledge for pending orders
    } else {
        klarnaOrderService.cancelOrder(klarnaOrderID, localeObject);
    }

    res.setStatusCode(200);
});


/**
 *  Entry point for notifications on pending orders
 */
server.post('Notification', server.middleware.https, function (req, res) {
    var Logger = require('dw/system/Logger');
    var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');
    var klarnaFraudDecisionObject = JSON.parse(req.body);
    var klarnaOrderID = klarnaFraudDecisionObject.order_id;
    var klarnaCountry = req.querystring.klarna_country;

    Logger.getLogger('Klarna').info('Received notification for Klarna order with ID: {0}.', klarnaOrderID);

    var localeObject = KlarnaHelpers.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);

    if (klarnaOrderObject) {
        if (klarnaFraudDecisionObject.event_type === 'FRAUD_RISK_STOPPED') {
            KlarnaHelpers.handleStoppedOrders(klarnaOrderObject.merchant_reference1);
        } else {
            KlarnaHelpers.placeOrder({
                klarnaOrderObject: klarnaOrderObject,
                localeObject: localeObject,
                isPendingOrder: true,
                localeId: req.locale.id
            });
        }
    }

    res.setStatusCode(200);
});

module.exports = server.exports();
