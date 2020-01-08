'use strict';

var page = module.superModule;
var server = require('server');

var KlarnaHelpers = require('*/cartridge/scripts/util/klarnaHelpers');

server.extend(page);

/**
 * Render the Klarna confirmation snippet
 */
server.replace('Confirm', server.middleware.https, function (req, res, next) {
    var URLUtils = require('dw/web/URLUtils');
    var Locale = require('dw/util/Locale');
    var BasketMgr = require('dw/order/BasketMgr');
    var Transaction = require('dw/system/Transaction');
    var OrderModel = require('*/cartridge/models/order');
    var Logger = require('dw/system/Logger');
    var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');
    var reportingUrlsHelper = require('*/cartridge/scripts/reportingUrls');

    var clearBasket = function () {
        var currentBasket = BasketMgr.getCurrentBasket();
        if (currentBasket) {
            Transaction.wrap(function () {
                KlarnaHelpers.clearBasket(currentBasket);
            });
        }
    };

    if (req.session.privacyCache.get('klarnaOrderID')) {
        req.session.privacyCache.set('klarnaOrderID', null);
    } else {
        Logger.getLogger('Klarna').error('Order-Confirm: Could not find Klarna order ID in the session');
        clearBasket();
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    var klarnaOrderID = req.querystring.klarna_order_id;
    var klarnaCountry = req.querystring.klarna_country;

    var localeObject = KlarnaHelpers.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject);

    if (!klarnaOrderObject) {
        Logger.getLogger('Klarna').error('Order-Confirm: Could not get Klarna order with ID - ' + klarnaOrderID);
        clearBasket();
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    var placeOrderResult = KlarnaHelpers.placeOrder({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject,
        localeId: req.locale.id
    });

    if (placeOrderResult.error) {
        var redirectURL = placeOrderResult.redirectURL
            ? placeOrderResult.redirectURL
            : URLUtils.https('Checkout-Begin', 'err', placeOrderResult.errorKey);

        res.redirect(redirectURL.toString());
    } else {
        clearBasket();

        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject);

        var config = {
            numberOfLineItems: '*'
        };

        var currentLocale = Locale.getLocale(req.locale.id);

        var orderModel = new OrderModel(
            placeOrderResult.order,
            { config: config, countryCode: currentLocale.country, containerView: 'order' }
        );

        var reportingURLs = reportingUrlsHelper.getOrderReportingURLs(placeOrderResult.order);

        res.render('checkout/klarnaConfirmation', {
            CurrentPageMetaData: {
                title: 'Klarna Confirmation'
            },
            order: orderModel,
            reportingURLs: reportingURLs,
            confirmationSnippet: placeOrderResult.confirmationSnippet
        });
    }
    return next();
});


module.exports = server.exports();
