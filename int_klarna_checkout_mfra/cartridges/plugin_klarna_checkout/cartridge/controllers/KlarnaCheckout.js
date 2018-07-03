'use strict';

var server = require('server');

/* API Includes */
var URLUtils = require('dw/web/URLUtils');
var Transaction = require('dw/system/Transaction');
var Status = require('dw/system/Status');
var StringUtils = require('dw/util/StringUtils');
var OrderMgr = require('dw/order/OrderMgr');
var Logger = require('dw/system/Logger');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var HookMgr = require('dw/system/HookMgr');

/* Script Modules */
var utils = require('~/cartridge/scripts/util/klarnaHelper');
var KlarnaHttpService = require('~/cartridge/scripts/services/klarnaHttpService');
var KlarnaApiContext = require('~/cartridge/scripts/services/klarnaApiContext');
var KlarnaOrderRequestBuilder = require('~/cartridge/scripts/order/klarnaOrderRequestBuilder');
var KLARNA_CHECKOUT = require('~/cartridge/scripts/hooks/payment/processor/klarna_checkout');
var KlarnaCartModel = require('~/cartridge/models/klarnaCartModel');
var KlarnaPlaceOrderController = require('~/cartridge/controllers/KlarnaPlaceOrder');
var OrderModel = require('*/cartridge/models/order');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var ShippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');

/**
 * Set the shipping method
 *
 * @transactional
 * @param  {dw.order.OrderAddress} shippingAddress
 * @return {void}
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

/**
 * Calls the KlarnaPlaceOrder controller that does the place order action.
 * KlarnaPlaceOrder returns a JSON object with an order_created key and a boolean value if the order was created successfully.
 * If the order creation failed, it returns a JSON object with an error key and a boolean value.
 */
function startPlaceOrder(context) {
    var placeOrderResult = KlarnaPlaceOrderController.Start(context);
    if (placeOrderResult.error) {
        return {
            error: true,
            placeOrderResult: placeOrderResult
        };
    } else if (placeOrderResult.order_created) {
        var cart = KlarnaCartModel.get();
        Transaction.wrap(function () {
            cart.clear();
        });
        return {
            error: false,
            order: placeOrderResult.Order,
            confirmationSnippet: context.klarnaOrderObject.html_snippet
        };
    }

    return {};
}

/**
 * API call to create Klarna order
 *
 * @param  {module:models/CartModel~CartModel} cart - A CartModel wrapping the current Basket.
 * @param  {dw.object.CustomObject} localeObject
 * @return {String} Html snippet used for rendering the Klarna checkout
 */
function createKlarnaOrder(cart, localeObject) {
    var klarnaHttpService = new KlarnaHttpService();
    var klarnaApiContext = new KlarnaApiContext();
    var orderRequestBuilder = new KlarnaOrderRequestBuilder();
    var requestBody = orderRequestBuilder.buildRequest({
        basket: cart.object,
        localeObject: localeObject
    }).get();

    var requestUrl = klarnaApiContext.getFlowApiUrls().get('createOrder');
    var response;

    try {
        response = klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
    } catch (e) {
        Logger.error(e);
        return null;
    }

    req.session.custom.klarnaOrderID = response.order_id;

    return response.html_snippet;
}

/**
 * API call to update Klarna order
 *
 * @param  {module:models/CartModel~CartModel} cart - A CartModel wrapping the current Basket.
 * @param  {dw.object.CustomObject} localeObject
 * @return {String} updated Klarna Html snippet
 */
function updateKlarnaOrder(cart, localeObject) {
    var klarnaHttpService = new KlarnaHttpService();
    var klarnaApiContext = new KlarnaApiContext();
    var orderRequestBuilder = new KlarnaOrderRequestBuilder();
    var requestBody = orderRequestBuilder.buildRequest({
        basket: cart.object,
    	localeObject: localeObject
    }).get();

    var klarnaOrderID = req.session.custom.klarnaOrderID;
    var requestUrl = StringUtils.format(klarnaApiContext.getFlowApiUrls().get('updateOrder'), klarnaOrderID);
    var response;

    try {
    	response = klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
    } catch (e) {
    	Logger.error(e);
    	return null;
    }

    return response.html_snippet;
}

/**
 * API call to read an order from Klarna
 *
 * @param  {String} klarnaOrderID
 * @param  {dw.object.CustomObject} localeObject
 * @return {Object} Klarna Order Object
 */
function getKlarnaOrder(klarnaOrderID, localeObject, isCompletedOrder) {
    var klarnaHttpService = new KlarnaHttpService();
    var klarnaApiContext = new KlarnaApiContext();
    var klarnaApiUrl = isCompletedOrder ? 'getCompletedOrder' : 'getOrder';
    var requestUrl = StringUtils.format(klarnaApiContext.getFlowApiUrls().get(klarnaApiUrl), klarnaOrderID);
    var response;

    try {
    	response = klarnaHttpService.call(requestUrl, 'GET', localeObject.custom.credentialID);
} catch (e) {
    	Logger.error(e);
    	return null;
}

    return response;
}

/**
 * API call to acknowledge the order
 *
 * @param  {String} klarnaOrderID
 * @param  {dw.object.CustomObject} localeObject
 * @return {void}
 */
function acknowledgeKlarnaOrder(klarnaOrderID, localeObject) {
    var klarnaHttpService = new KlarnaHttpService();
    var klarnaApiContext = new KlarnaApiContext();

    try {
    	var requestUrl = StringUtils.format(klarnaApiContext.getFlowApiUrls().get('acknowledgeOrder'), klarnaOrderID);
    var response = klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID);
    var deleteme = response;
} catch (e) {
    Logger.error(e);
}
}

/**
 * Start the Klarna Checkout process
 */
server.get('Start', server.middleware.https, function (req, res, next) {
    var cart;
    var localeObject;
    var checkoutSnippet;

    cart = KlarnaCartModel.get();

    if (!cart) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    // Calculate the basket
    Transaction.wrap(function () {
        COHelpers.ensureNoEmptyShipments(req);
    });

    if (cart.object.currencyCode !== req.session.currency.currencyCode) {
        Transaction.wrap(function () {
            cart.object.updateCurrency();
        });
    }

    if (req.session.privacyCache.get('usingMultiShipping') && cart.shipments.length > 1) {
        res.render('checkout/klarnaCheckout', {
            KlarnaError: 'klarna.checkout.multishipError'
        });
        return next();
    }

    localeObject = utils.getLocaleObject(null, req);

    // Loop through all shipments and make sure all are valid
    var allValid = COHelpers.ensureValidShipments(cart.object);

    var validationBasketStatus = HookMgr.callHook(
        'app.validate.basket',
        'validateBasket',
        cart.object,
        false
    );

    if (validationBasketStatus.error) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    prepareShipping(cart.object, localeObject);

    KLARNA_CHECKOUT.Handle({ Basket: cart.object });

    // Calculate the basket
    COHelpers.recalculateBasket(cart.object);

    var orderModel = new OrderModel(
        cart.object,
        {
            customer: req.currentCustomer.raw,
            usingMultiShipping: false,
            shippable: allValid,
            countryCode: localeObject.custom.country,
            containerView: 'basket'
        }
    );

    if (!req.session.custom.klarnaOrderID) {
        checkoutSnippet = createKlarnaOrder(cart, localeObject);
    } else {
        checkoutSnippet = updateKlarnaOrder(cart, localeObject);
    }

    res.render('checkout/klarnaCheckout', {
        CurrentPageMetaData: {
            title: 'Klarna Checkout'
        },
        order: orderModel,
    	KlarnaError: !checkoutSnippet ? 'klarna.checkout.submissionError' : null,
    	CheckoutSnippet: checkoutSnippet,
    	LocaleObject: localeObject,
        Basket: cart.object,
    	PlaceOrderError: req.PlaceOrderError
    });

    return next();
});


/**
 * Updates the Klarna order when a shipping method or address in the checkout has changed
 *
 * @transactional
 */
server.post('Update', server.middleware.https, function (req, res, next) {
    var KlarnaOrderUpdateResponseBuilder = require('~/cartridge/scripts/order/klarnaOrderUpdateResponseBuilder');

    var cart = KlarnaCartModel.goc();
    var klarnaOrderObject = JSON.parse(req.body);

    if (!klarnaOrderObject) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    Transaction.wrap(function () {
        cart.restore(klarnaOrderObject);
    });

    var klarnaOrderUpdateResponseBuilder = new KlarnaOrderUpdateResponseBuilder();
    var orderUpdateResponse = klarnaOrderUpdateResponseBuilder.buildResponse({
        basket: cart.object,
        showShippingMethods: !empty(klarnaOrderObject.selected_shipping_option)
    }).get();

    var json = JSON.stringify(orderUpdateResponse);
    res.setStatusCode(200);
    res.setContentType('application/json');
    res.print(json);
});

/**
 * Validate the Klarna order
 */
server.post('Validation', server.middleware.https, function (req, res, next) {
    var klarnaOrderObject = JSON.parse(req.body);

    var order = OrderMgr.searchOrder('externalOrderNo = {0}', [klarnaOrderObject.order_id]);

    if (!order) {
        order = KlarnaPlaceOrderController.CreateOrder(klarnaOrderObject);

        if (!order) {
            res.redirect(URLUtils.https('Cart-Show'));
            return next();
        }
    }

    res.setStatusCode(200);
});

/**
 * Render the Klarna confirmation snippet
 */
server.get('Confirmation', server.middleware.https, function (req, res, next) {
    var klarnaOrderID;
    var klarnaCountry;
    var localeObject;
    var klarnaOrderObject;

    if (req.session.custom.klarnaOrderID) {
        req.session.custom.klarnaOrderID = null;
    } else {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    klarnaOrderID = req.querystring.klarna_order_id;
    klarnaCountry = req.querystring.klarna_country;

    if (!klarnaOrderID || !klarnaCountry) {
        var placeOrderError = new Status(dw.system.Status.ERROR, 'confirm.error.technical');
        res.redirect(URLUtils.https('KlarnaCheckout-Begin', 'PlaceOrderError', placeOrderError).toString());
        return next();
    }

    localeObject = utils.getLocaleObject(klarnaCountry);

    klarnaOrderObject = getKlarnaOrder(klarnaOrderID, localeObject);

    if (!klarnaOrderObject) {
        var placeOrderError = new Status(dw.system.Status.ERROR, 'confirm.error.technical');
        res.redirect(URLUtils.https('KlarnaCheckout-Begin', 'PlaceOrderError', placeOrderError).toString());
        return next();
    }

    var placeOrderResult = startPlaceOrder({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject,
        localeId: req.locale.id
    });

    if (placeOrderResult.error) {
        res.redirect(URLUtils.https('KlarnaCheckout-Begin', 'PlaceOrderError', placeOrderResult).toString());
    } else {
        acknowledgeKlarnaOrder(klarnaOrderID, localeObject);

        var config = {
            numberOfLineItems: '*'
        };

        var currentLocale = dw.util.Locale.getLocale(req.locale.id);

        var orderModel = new OrderModel(
            placeOrderResult.order,
            { config: config, countryCode: currentLocale.country, containerView: 'order' }
        );

        res.render('checkout/klarnaConfirmation', {
            CurrentPageMetaData: {
                title: 'Klarna Confirmation'
            },
            order: orderModel,
            ConfirmationSnippet: placeOrderResult.confirmationSnippet
        });
    }

    return next();
});

/**
 * Updates Klarna Checkout iFrame
 */
server.get('UpdateKlarnaCheckout', server.middleware.https, function (req, res, next) {
    var cart, 
localeObject, 
isUpdated;

    cart = KlarnaCartModel.get();

    if (!cart) {
        res.redirect(URLUtils.https('Cart-Show'));
        return next();
    }

    localeObject = utils.getLocaleObject(null, req);

    COHelpers.recalculateBasket(cart.object);

    if (!req.session.custom.klarnaOrderID) {
        isUpdated = createKlarnaOrder(cart, localeObject);
    } else {
        isUpdated = updateKlarnaOrder(cart, localeObject);
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
    var klarnaOrderID, 
klarnaCountry, 
localeId, 
localeObject, 
klarnaOrderObject;

    klarnaOrderID = req.querystring.klarna_order_id;
    klarnaCountry = req.querystring.klarna_country;
    localeId = req.locale.id;

    if (!klarnaOrderID || !klarnaCountry) {
        res.setStatusCode(200);
        return;
    }

    localeObject = utils.getLocaleObject(klarnaCountry);

    klarnaOrderObject = getKlarnaOrder(klarnaOrderID, localeObject, true);

    var placeOrderResult = KlarnaPlaceOrderController.Start({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject,
        localeId: localeId
    });

    if (placeOrderResult.order_created) {
        acknowledgeKlarnaOrder(klarnaOrderID, localeObject);
    }

    res.setStatusCode(200);
});

/**
 * Select a shipping method for the default shipment.
 */
server.get('SelectShippingMethod', server.middleware.https, function (req, res, next) {
    var cart = KlarnaCartModel.get();

    if (!cart) {
        res.json({ success: false });
        return next();
    }

    var responseObject = Transaction.wrap(function () {
        cart.updateShipmentShippingMethod(cart.object.getDefaultShipment().getID(), req.querystring.shippingMethodID, null, null);

        HookMgr.callHook('dw.order.calculate', 'calculate', cart.object);

        if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            var isSuccessful = utils.calculatePaymentTransactionTotals(cart.object);
            if (!isSuccessful) {
                cart.object.removePaymentInstruments(cart.object.getPaymentInstruments(PaymentInstrument.METHOD_GIFT_CERTIFICATE));
                return {
                    success: true,
                    redirect: URLUtils.https('KlarnaCheckout-Begin').toString()
                };
            }
        }
    });

    if (responseObject) {
        res.json(responseObject);
    } else {
        res.json({ success: true });
    }

    return next();
});

/**
 *  Updates default shipment shipping address.
 *
 *  @transactional
 */
server.get('UpdateShippingAddress', server.middleware.https, function (req, res, next) {
    var shippingAddress, 
responseObject;
    var cart = KlarnaCartModel.get();

    if (!cart) {
    res.json({ success: false });
    return next();
}

    responseObject = Transaction.wrap(function () {
    shippingAddress = cart.createShipmentShippingAddress(cart.object.getDefaultShipment().getID());

    var countryCode = req.querystring.country.toLowerCase();
		// Klarna JS API returns ISO3 country codes in this case, so we use map to get ISO2 country codes.
    if (countryCode && countryCode.length === 3) {
    var countryCodesMap = require('~/cartridge/countryCodesMap');
    countryCode = countryCodesMap[countryCode];
}

    shippingAddress.setFirstName(req.querystring.given_name);
    shippingAddress.setLastName(req.querystring.family_name);
    shippingAddress.setAddress1(req.querystring.street_address);
    shippingAddress.setAddress2(req.querystring.street_address2);
    shippingAddress.setCity(req.querystring.city);
    shippingAddress.setPostalCode(req.querystring.postal_code);
    shippingAddress.setStateCode(req.querystring.region);
    shippingAddress.setCountryCode(countryCode);

    HookMgr.callHook('dw.order.calculate', 'calculate', cart.object);

    if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
    var isSuccessful = utils.calculatePaymentTransactionTotals(cart.object);
    if (!isSuccessful) {
    cart.object.removePaymentInstruments(cart.object.getPaymentInstruments(PaymentInstrument.METHOD_GIFT_CERTIFICATE));
    return {
    success: true,
    redirect: URLUtils.https('KlarnaCheckout-Begin').toString()
};
}
}
});

    if (responseObject) {
    res.json(responseObject);
} else {
    res.json({
    success: true,
    address: {
    address1: shippingAddress.address1,
    address2: shippingAddress.address2,
    city: shippingAddress.city,
    countryCode: shippingAddress.countryCode.value,
    stateCode: shippingAddress.stateCode,
    postalCode: shippingAddress.postalCode
}
});
}

    return next();
});

/**
 *  Renders the order summary
 */
server.get('UpdateSummary', server.middleware.https, function (req, res, next) {
    var OrderModel = require('*/cartridge/models/order');

    var cart = KlarnaCartModel.get();

    COHelpers.recalculateBasket(cart.object);

    var orderModel = new OrderModel(
        cart.object,
        {
            customer: req.currentCustomer.raw,
            usingMultiShipping: req.session.privacyCache.get('usingMultiShipping'),
            countryCode: dw.util.Locale.getLocale(req.locale.id).country,
            containerView: 'basket'
        }
    );

    res.render('checkout/orderTotalSummary', {
        checkoutstep: 0,
        order: orderModel
    });

    return next();
});

/**
 *  Entry point for notifications on pending orders
 */
server.post('Notification', server.middleware.https, function (req, res, next) {
    var klarnaOrderObject, 
localeObject;

    var klarnaFraudDecisionObject = JSON.parse(req.body);
    var klarnaOrderID = klarnaFraudDecisionObject.order_id;
    var klarnaCountry = req.querystring.klarna_country;
    var localeId = req.locale.id;

    localeObject = utils.getLocaleObject(klarnaCountry);
    klarnaOrderObject = getKlarnaOrder(klarnaOrderID, localeObject, true);

    if (klarnaOrderObject) {
        KlarnaPlaceOrderController.Start({
            klarnaOrderObject: klarnaOrderObject,
            localeObject: localeObject,
            isPendingOrder: true,
            localeId: localeId
        });
    }

    res.setStatusCode(200);
});


module.exports = server.exports();
/*
 * Local methods
 */
exports.GetKlarnaOrder = getKlarnaOrder;
