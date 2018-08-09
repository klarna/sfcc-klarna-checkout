'use strict';

var STOREFRONT_CARTRIDGE = require('~/cartridge/scripts/util/klarnaConstants.js').STOREFRONT_CARTRIDGE;

var page = require(STOREFRONT_CARTRIDGE + '/cartridge/controllers/Checkout');
var server = require('server');

/* API Includes */
var URLUtils = require('dw/web/URLUtils');
var Transaction = require('dw/system/Transaction');
var HookMgr = require('dw/system/HookMgr');
var BasketMgr = require('dw/order/BasketMgr');

/* Script Modules */
var KlarnaHelpers = require('~/cartridge/scripts/util/klarnaHelpers');
var KlarnaOrderService = require('~/cartridge/scripts/services/KlarnaOrderService');
var OrderModel = require('*/cartridge/models/order');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var ShippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');


server.extend(page);

/**
 * Set the shipping method
 * @transactional
 * @param  {dw.orer.Basket} basket
 * @param  {Object} localeObject
 * @returns {void}
 */
function prepareShipping(basket, localeObject) {
    var shipment = basket.defaultShipment;

    Transaction.wrap(function () {
        var shippingAddress = shipment.shippingAddress;
        if (!shippingAddress) {
            shippingAddress = shipment.createShippingAddress();
            shippingAddress.countryCode = localeObject.custom.country;
            shippingAddress.postalCode = ' ';
        }

        ShippingHelper.selectShippingMethod(shipment);

        COHelpers.recalculateBasket(basket);
    });
}

server.replace('Login', server.middleware.get, function (req, res, next) {
    res.redirect(URLUtils.https('Checkout-Begin'));
    next();
});

/**
 * Begin the Klarna Checkout process
 */
server.replace('Begin', server.middleware.https, function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();

    if (!currentBasket) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    // Calculate the basket
    Transaction.wrap(function () {
        COHelpers.ensureNoEmptyShipments(req);
    });

    if (currentBasket.currencyCode !== req.session.currency.currencyCode) {
        Transaction.wrap(function () {
            currentBasket.updateCurrency();
        });
    }

    if (req.session.privacyCache.get('usingMultiShipping') && currentBasket.shipments.length > 1) {
        res.render('checkout/klarnaCheckout', {
            KlarnaError: 'klarna.checkout.multishipError'
        });
        return next();
    }

    var localeObject = KlarnaHelpers.getLocaleObject(null, req.locale.id);

    // Loop through all shipments and make sure all are valid
    var allValid = COHelpers.ensureValidShipments(currentBasket);

    var validationBasketStatus = HookMgr.callHook(
        'app.validate.basket',
        'validateBasket',
        currentBasket,
        false
    );

    if (validationBasketStatus.error) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    prepareShipping(currentBasket, localeObject);

    HookMgr.callHook('app.payment.processor.KLARNA_CHECKOUT', 'Handle', {
        Basket: currentBasket
    });

    // Calculate the basket
    COHelpers.recalculateBasket(currentBasket);

    var checkoutSnippet;
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderID = req.session.privacyCache.get('klarnaOrderID');

    if (!klarnaOrderID) {
        checkoutSnippet = klarnaOrderService.createOrder(currentBasket, localeObject, req);
    } else {
        checkoutSnippet = klarnaOrderService.updateOrder(currentBasket, localeObject, klarnaOrderID);
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
        KlarnaError: !checkoutSnippet ? 'klarna.checkout.submissionError' : null,
        CheckoutSnippet: checkoutSnippet,
        LocaleObject: localeObject,
        Basket: currentBasket,
        PlaceOrderError: req.err
    });

    return next();
});

module.exports = server.exports();
