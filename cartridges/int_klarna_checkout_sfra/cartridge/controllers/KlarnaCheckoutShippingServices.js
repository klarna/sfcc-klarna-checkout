'use strict';

var server = require('server');

var BasketMgr = require('dw/order/BasketMgr');
var URLUtils = require('dw/web/URLUtils');
var Transaction = require('dw/system/Transaction');
var Locale = require('dw/util/Locale');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var PaymentMgr = require('dw/order/PaymentMgr');
var ShippingMgr = require('dw/order/ShippingMgr');

/* Script Modules */
var OrderModel = require('*/cartridge/models/order');
var KlarnaHelpers = require('~/cartridge/scripts/util/klarnaHelpers');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var ShippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');

/**
 * Select a shipping method for the default shipment.
 */
server.get('SelectShippingMethod', server.middleware.https, function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();
    if (!currentBasket) {
        res.json({ success: false });
        return next();
    }

    var responseObject = Transaction.wrap(function () {
        ShippingHelper.selectShippingMethod(currentBasket.getDefaultShipment(), req.querystring.shippingMethodID);

        COHelpers.recalculateBasket(currentBasket);

        if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            var isSuccessful = KlarnaHelpers.calculatePaymentTransactionTotals(currentBasket);
            if (!isSuccessful) {
                currentBasket.removePaymentInstruments(currentBasket.getPaymentInstruments(PaymentInstrument.METHOD_GIFT_CERTIFICATE));
                return {
                    success: true,
                    redirect: URLUtils.https('Checkout-Begin').toString()
                };
            }
        }
        return null;
    });

    var basketModel = new OrderModel(
        currentBasket,
        {
            customer: req.currentCustomer.raw,
            usingMultiShipping: req.session.privacyCache.get('usingMultiShipping'),
            countryCode: Locale.getLocale(req.locale.id).country,
            containerView: 'basket'
        }
    );

    if (responseObject) {
        responseObject.order = basketModel;
        res.json(responseObject);
    } else {
        res.json({
            success: true,
            order: basketModel
        });
    }

    return next();
});

/**
 *  Updates default shipment shipping address.
 *
 *  @transactional
 */
server.get('UpdateShippingAddress', server.middleware.https, function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();

    if (!currentBasket) {
        res.json({ success: false });
        return next();
    }

    var shipment = currentBasket.getDefaultShipment();
    var shippingAddress = shipment.getShippingAddress();

    var responseObject = Transaction.wrap(function () {
        var countryCode = req.querystring.country.toLowerCase();
        // Klarna JS API returns ISO3 country codes in this case, so we use map to get ISO2 country codes.
        if (countryCode && countryCode.length === 3) {
            var countryCodesMap = require('~/cartridge/config/countryCodesMap');
            countryCode = countryCodesMap[countryCode];
        }

        if (shippingAddress === null) {
            shippingAddress = shipment.createShippingAddress();
        }

        shippingAddress.setFirstName(req.querystring.given_name || '');
        shippingAddress.setLastName(req.querystring.family_name || '');
        shippingAddress.setAddress1(req.querystring.street_address || '');
        shippingAddress.setAddress2(req.querystring.street_address2 || '');
        shippingAddress.setCity(req.querystring.city || '');
        shippingAddress.setPostalCode(req.querystring.postal_code || '');
        shippingAddress.setStateCode(req.querystring.region || '');
        shippingAddress.setCountryCode(countryCode || '');

        COHelpers.recalculateBasket(currentBasket);

        if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            var isSuccessful = KlarnaHelpers.calculatePaymentTransactionTotals(currentBasket);
            if (!isSuccessful) {
                currentBasket.removePaymentInstruments(currentBasket.getPaymentInstruments(PaymentInstrument.METHOD_GIFT_CERTIFICATE));
                return {
                    success: true,
                    redirect: URLUtils.https('Checkout-Begin').toString()
                };
            }
        }
        return null;
    });

    var basketModel = new OrderModel(
        currentBasket,
        {
            customer: req.currentCustomer.raw,
            usingMultiShipping: req.session.privacyCache.get('usingMultiShipping'),
            countryCode: Locale.getLocale(req.locale.id).country,
            containerView: 'basket'
        }
    );

    if (responseObject) {
        responseObject.order = basketModel;
        res.json(responseObject);
    } else {
        res.json({
            success: true,
            order: basketModel,
            address: {
                address1: shippingAddress.address1 || '',
                address2: shippingAddress.address2 || '',
                city: shippingAddress.city || '',
                countryCode: shippingAddress.countryCode.value || '',
                stateCode: shippingAddress.stateCode || '',
                postalCode: shippingAddress.postalCode || ''
            }
        });
    }

    return next();
});

/**
 * Determines the list of applicable shipping methods for the default shipment of
 * the current basket. The applicable shipping methods are based on the
 * merchandise in the cart and any address parameters included in the request.
 * Changes the shipping method of this shipment if the current method
 * is no longer applicable. Precalculates the shipping cost for each applicable
 * shipping method by simulating the shipping selection i.e. explicitly adds each
 * shipping method and then calculates the cart.
 * The simulation is done so that shipping cost along
 * with discounts and promotions can be shown to the user before making a
 * selection.
 * @transaction
 */
server.get('UpdateShippingMethodList', server.middleware.https, function (req, res, next) {
    var currentBasket = BasketMgr.getCurrentBasket();

    if (!currentBasket) {
        res.json({ success: false });
        return next();
    }

    var address = new Object();
    address.countryCode = req.querystring.countryCode;
    address.stateCode = req.querystring.stateCode;
    address.postalCode = req.querystring.postalCode;
    address.city = req.querystring.city;
    address.address1 = req.querystring.address1;
    address.address2 = req.querystring.address2;

    if (!address.countryCode) {
        var currentLocale = Locale.getLocale(req.locale.id);
        address.countryCode = currentLocale.country;
    }

    var shipment = currentBasket.getDefaultShipment();
    var applicableShippingMethods = ShippingHelper.getApplicableShippingMethods(shipment, address);
    var currentShippingMethod = shipment.getShippingMethod() || ShippingMgr.getDefaultShippingMethod();

    Transaction.begin();

    for (var i = 0; i < applicableShippingMethods.length; i++) {
        var method = applicableShippingMethods[i];

        ShippingHelper.selectShippingMethod(shipment, method.ID, null, address);
        COHelpers.recalculateBasket(currentBasket);
        method.shippingCost = currentBasket.getAdjustedShippingTotalPrice();
    }

    Transaction.rollback();

    Transaction.wrap(function () {
        ShippingHelper.selectShippingMethod(shipment, currentShippingMethod.getID(), null, address);
        COHelpers.recalculateBasket(currentBasket);
    });

    var responseObject = { applicableShippingMethods: applicableShippingMethods };

    if (req.querystring.format !== 'ajax') {
        res.render('checkout/klarnaShippingMethods', responseObject);
        return next();
    }

    var Template = require('dw/util/Template');
    var HashMap = require('dw/util/HashMap');

    var context = new HashMap();
    Object.keys(responseObject).forEach(function (key) {
        context.put(key, responseObject[key]);
    });

    var template = new Template('checkout/klarnaShippingMethods');
    var shippingMethodsHtml = template.render(context).text;

    var basketModel = new OrderModel(
        currentBasket,
        {
            customer: req.currentCustomer.raw,
            usingMultiShipping: req.session.privacyCache.get('usingMultiShipping'),
            countryCode: Locale.getLocale(req.locale.id).country,
            containerView: 'basket'
        }
    );

    res.json({
        success: true,
        shippingMethodsHtml: shippingMethodsHtml,
        order: basketModel
    });

    return next();
});

module.exports = server.exports();
