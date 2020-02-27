'use strict';

var page = module.superModule;
var server = require('server');

server.extend(page);

var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');

/**
 * Set the shipping method
 * @transactional
 * @param  {dw.orer.Basket} basket current basket
 * @param  {Object} localeObject Klara region specific options
 * @returns {void}
 */
function prepareShipping(basket, localeObject) {
    var Transaction = require('dw/system/Transaction');
    var ShippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');
    var ShippingMgr = require('dw/order/ShippingMgr');

    var shipment = basket.defaultShipment;

    Transaction.wrap(function () {
        var shippingAddress = shipment.shippingAddress;
        if (!shippingAddress) {
            shippingAddress = shipment.createShippingAddress();
            shippingAddress.countryCode = localeObject.custom.country;
            shippingAddress.postalCode = ' ';
        }

        var currentShippingMethod = shipment.getShippingMethod() || ShippingMgr.getDefaultShippingMethod();
        ShippingHelper.selectShippingMethod(shipment, currentShippingMethod.getID());

        COHelpers.recalculateBasket(basket);
    });
}

server.prepend('Login', server.middleware.get, function (req, res, next) {
    var URLUtils = require('dw/web/URLUtils');
    res.redirect(URLUtils.https('Checkout-Begin'));
    next();
});

/**
 * Begin the Klarna Checkout process
 */
server.append('Begin', server.middleware.https, function (req, res, next) {
    var HookMgr = require('dw/system/HookMgr');
    var BasketMgr = require('dw/order/BasketMgr');
    var Resource = require('dw/web/Resource');
    var KlarnaHelpers = require('*/cartridge/scripts/util/klarnaHelpers');
    var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');
    var OrderModel = require('*/cartridge/models/order');
    var KLARNA_PAYMENT_METHOD = require('*/cartridge/scripts/util/klarnaConstants.js').PAYMENT_METHOD;

    var currentBasket = BasketMgr.getCurrentBasket();

    if (req.session.privacyCache.get('usingMultiShipping') && currentBasket.shipments.length > 1) {
        res.render('checkout/klarnaCheckout', {
            klarnaError: Resource.msg('klarna.checkout.multishipError', 'checkout', null)
        });
        return next();
    }

    var localeObject = KlarnaHelpers.getLocaleObject(null, req.locale.id);
    if (!localeObject) {
        res.render('checkout/klarnaCheckout', {
            klarnaError: Resource.msg('klarna.checkout.notsupportedcountry', 'checkout', null)
        });
        return next();
    }

    var allValid = COHelpers.ensureValidShipments(currentBasket);

    prepareShipping(currentBasket, localeObject);

    HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD.toLowerCase(), 'Handle',
        currentBasket
    );

    COHelpers.recalculateBasket(currentBasket);

    var checkoutSnippet;
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaCountry = req.session.privacyCache.get('klarnaCountry');
    var klarnaOrderID = (klarnaCountry && localeObject.custom.country !== klarnaCountry) ? null : req.session.privacyCache.get('klarnaOrderID');

    if (!klarnaOrderID) {
        checkoutSnippet = klarnaOrderService.createOrder(currentBasket, localeObject, req.locale.id);
    } else {
        checkoutSnippet = klarnaOrderService.updateOrder(currentBasket, localeObject, klarnaOrderID, req.locale.id);
    }

    var basketModel = new OrderModel(
        currentBasket,
        {
            customer: req.currentCustomer.raw,
            usingMultiShipping: false,
            shippable: allValid,
            countryCode: localeObject.custom.country,
            containerView: 'basket'
        }
    );

    res.render('checkout/klarnaCheckout', {
        CurrentPageMetaData: {
            title: 'Klarna Checkout'
        },
        order: basketModel,
        klarnaError: !checkoutSnippet ? Resource.msg('klarna.checkout.submissionError', 'checkout', null) : null,
        checkoutSnippet: checkoutSnippet,
        localeObject: localeObject,
        basket: currentBasket,
        placeOrderError: req.querystring.err ? Resource.msg(req.querystring.err, 'checkout', null) : null
    });

    return next();
});

module.exports = server.exports();
