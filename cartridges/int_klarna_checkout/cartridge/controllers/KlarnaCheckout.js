/* globals session:false, request:false, response:false */

'use strict';

/**
 * @module controllers/KlarnaCheckout
*/

/* API Includes */
var URLUtils = require('dw/web/URLUtils');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');
var ShippingMgr = require('dw/order/ShippingMgr');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var Logger = require('dw/system/Logger');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var HookMgr = require('dw/system/HookMgr');

/* Script Modules */
var app = require('*/cartridge/scripts/app');
var guard = require('*/cartridge/scripts/guard');
var utils = require('*/cartridge/scripts/util/klarnaHelper');
var KLARNA_PAYMENT_METHOD = require('*/cartridge/scripts/util/klarnaConstants.js').PAYMENT_METHOD;
var FRAUD_STATUS = require('*/cartridge/scripts/util/klarnaConstants').FRAUD_STATUS;
var KlarnaCartModel = require('*/cartridge/scripts/models/klarnaCartModel');
var KlarnaPlaceOrderController = require('*/cartridge/controllers/KlarnaPlaceOrder');
var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');
var TransientAddress = app.getModel('TransientAddress');


/**
 * Set the shipping method
 *
 * @transactional
 * @param  {dw.order.OrderAddress} shippingAddress current basket shipping address
 * @return {void}
 */
function prepareShipping(shippingAddress) {
    var cart = KlarnaCartModel.get();
    var applicableShippingMethods = cart.getApplicableShippingMethods(shippingAddress);
    var currentShippingMethod = cart.getDefaultShipment().getShippingMethod() || ShippingMgr.getDefaultShippingMethod();
    var defaultShipmentID = cart.getDefaultShipment().getID();

    Transaction.wrap(function () {
        var basketAddress = cart.createShipmentShippingAddress(defaultShipmentID);
        basketAddress.setCountryCode(shippingAddress.countryCode);
        basketAddress.setPostalCode(shippingAddress.postalCode);

        cart.updateShipmentShippingMethod(defaultShipmentID, currentShippingMethod.getID(), currentShippingMethod, applicableShippingMethods);
        cart.calculate();
    });
}

/**
 * Handles fraud risk stopped orders.
 *
 * @param {string} orderNo the SFCC order number
 * @return {void}
 */
function handleStoppedOrders(orderNo) {
    var order = OrderMgr.getOrder(orderNo);

    if (!order) {
        return;
    }

    Transaction.wrap(function () {
        order.addNote('Klarna Payment Notification', 'FRAUD_RISK_STOPPED - The order was stopped for some reason');
        var paymentInstrument = order.getPaymentInstruments(KLARNA_PAYMENT_METHOD)[0];
        if (paymentInstrument) {
            paymentInstrument.paymentTransaction.custom.kcFraudStatus = FRAUD_STATUS.STOPPED;
        }
    });

    if (order.status.value === Order.ORDER_STATUS_CREATED) {
        Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
        });
        return;
    }

    if (order.confirmationStatus.value === Order.CONFIRMATION_STATUS_CONFIRMED && order.exportStatus.value === Order.EXPORT_STATUS_READY && order.paymentStatus.value === Order.PAYMENT_STATUS_NOTPAID) {
        Transaction.wrap(function () {
            OrderMgr.cancelOrder(order);
            order.setCancelDescription('The order was stopped by Klarna for some reason.');
            order.setExportStatus(Order.EXPORT_STATUS_NOTEXPORTED);
        });
    } else if (order.confirmationStatus.value === Order.CONFIRMATION_STATUS_CONFIRMED && (order.exportStatus.value === Order.EXPORT_STATUS_EXPORTED || order.paymentStatus.value === Order.PAYMENT_STATUS_PAID)) {
        Logger.getLogger('Klarna').fatal('Klarna payment notification for order {0}: FRAUD_RISK_STOPPED - The order was stopped for some reason', orderNo);
    }
}

/**
 * Start the Klarna Checkout process
 * @param {Object} context page context
 */
function start(context) {
    var cart = KlarnaCartModel.get();

    if (!cart) {
        response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    var physicalShipments = cart.getPhysicalShipments();
    if (Site.getCurrent().getCustomPreferenceValue('enableMultiShipping') && physicalShipments && physicalShipments.size() > 1) {
        app.getView({
            KlarnaError: 'klarna.checkout.multishipError'
        }).render('checkout/klarna_checkout');
        return;
    }

    var pageMeta = require('*/cartridge/scripts/meta');
    pageMeta.update({
        pageTitle: 'Klarna Checkout'
    });

    var localeObject = utils.getLocaleObject();

    var shippingAddress = new TransientAddress();
    shippingAddress.countryCode = localeObject.custom.country;
    shippingAddress.postalCode = ' ';

    var validationResult = cart.validateForCheckout();
    if (!validationResult.EnableCheckout) {
        response.redirect(URLUtils.https('Cart-Show'));
    }

    prepareShipping(shippingAddress);

    HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD, 'Handle',
        cart.object
    );

    Transaction.wrap(function () {
        cart.calculate();
    });

    var checkoutSnippet;
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaCountry = session.privacy.klarnaCountry;
    var klarnaOrderID = (klarnaCountry && localeObject.custom.country !== klarnaCountry) ? null : session.privacy.klarnaOrderID;

    if (!klarnaOrderID) {
        checkoutSnippet = klarnaOrderService.createOrder(cart.object, localeObject, request.locale);
    } else {
        checkoutSnippet = klarnaOrderService.updateOrder(cart.object, localeObject, klarnaOrderID, request.locale);
    }

    app.getView({
        KlarnaError: !checkoutSnippet ? 'klarna.checkout.submissionError' : null,
        CheckoutSnippet: checkoutSnippet,
        LocaleObject: localeObject,
        Basket: cart.object,
        PlaceOrderError: context.PlaceOrderError
    }).render('checkout/klarna_checkout');
}

/**
 * Updates the Klarna order when a shipping method or address if the checkout has changed
 *
 * @transactional
 */
function update() {
    var cart = KlarnaCartModel.goc();
    var klarnaOrderObject = JSON.parse(request.httpParameterMap.requestBodyAsString);

    if (!klarnaOrderObject) {
        response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    Transaction.wrap(function () {
        cart.restore(klarnaOrderObject);
    });

    var KlarnaOrderUpdateResponseBuilder = require('*/cartridge/scripts/order/klarnaOrderUpdateResponseBuilder');
    var klarnaOrderUpdateResponseBuilder = new KlarnaOrderUpdateResponseBuilder();
    var orderUpdateResponse = klarnaOrderUpdateResponseBuilder.buildResponse({
        basket: cart.object,
        showShippingMethods: !!klarnaOrderObject.selected_shipping_option
    }).get();

    var responseUtils = require('*/cartridge/scripts/util/Response');
    responseUtils.renderJSON(orderUpdateResponse);
}

/**
 * Validate the Klarna order
 */
function validation() {
    var klarnaOrderObject = JSON.parse(request.httpParameterMap.requestBodyAsString);

    var order = OrderMgr.getOrder(klarnaOrderObject.merchant_reference1);

    if (!order) {
        order = KlarnaPlaceOrderController.CreateOrder(klarnaOrderObject); // eslint-disable-line new-cap

        if (!order) {
            response.setStatus(303);
            response.setHttpHeader('Location', URLUtils.https('Cart-Show').toString());
            return;
        }
    }

    response.setStatus(200);
}

/**
 * Renders the order confirmation page after successful order creation.
 *
 * @param {dw.order.Order} order the SFCC order
 * @param {string} confirmationSnippet Klarna Html confirmation snippet
 */
function showConfirmation(order, confirmationSnippet) {
    var cart = KlarnaCartModel.get();

    if (cart) {
        Transaction.wrap(function () {
            cart.clear();
        });
    }

    var pageMeta = require('*/cartridge/scripts/meta');
    pageMeta.update({
        pageTitle: 'Klarna Confirmation'
    });

    app.getView({
        Order: order,
        ConfirmationSnippet: confirmationSnippet
    }).render('checkout/klarna_confirmation');
}

/**
 * Calls the KlarnaPlaceOrder controller that does the place order action.
 * KlarnaPlaceOrder returns a JSON object with an order_created key and a boolean value if the order was created successfully.
 * If the order creation failed, it returns a JSON object with an error key and a boolean value.
 *
 * @param {Object} context page context
 */
function startPlaceOrder(context) {
    var placeOrderResult = KlarnaPlaceOrderController.Start(context); // eslint-disable-line new-cap
    if (placeOrderResult.error) {
        start(placeOrderResult);
    } else if (placeOrderResult.order_created) {
        showConfirmation(placeOrderResult.Order, context.klarnaOrderObject.html_snippet);
    }
}

/**
 * Render the Klarna confirmation snippet
 */
function confirmation() {
    var clearBasket = function () {
        var cart = KlarnaCartModel.get();
        if (cart) {
            Transaction.wrap(function () {
                cart.clear();
            });
        }
    };

    if (session.privacy.klarnaOrderID) {
        session.privacy.klarnaOrderID = null;
    } else {
        Logger.getLogger('Klarna').error('KlarnaCheckout-Confirmation: Could not find Klarna order ID in the session');
        clearBasket();
        response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    var klarnaOrderID = request.httpParameterMap.klarna_order_id;
    var klarnaCountry = request.httpParameterMap.klarna_country;

    var localeObject = utils.getLocaleObject(klarnaCountry);

    var klarnaOrderService = new KlarnaOrderService();

    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject);

    if (!klarnaOrderObject) {
        Logger.getLogger('Klarna').error('KlarnaCheckout-Confirmation: Could not get Klarna order with ID - ' + klarnaOrderID);
        clearBasket();
        response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    startPlaceOrder({
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject
    });
}

/**
 * Updates Klarna Checkout iFrame
 */
function updateKlarnaCheckout() {
    var cart = KlarnaCartModel.get();

    if (!cart) {
        response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    var localeObject = utils.getLocaleObject();

    Transaction.wrap(function () {
        cart.calculate();
    });

    var klarnaOrderService = new KlarnaOrderService();
    var isUpdated;

    if (!session.privacy.klarnaOrderID) {
        isUpdated = klarnaOrderService.createOrder(cart.object, localeObject, request.locale);
    } else {
        isUpdated = klarnaOrderService.updateOrder(cart.object, localeObject, session.privacy.klarnaOrderID, request.locale);
    }

    var responseUtils = require('*/cartridge/scripts/util/Response');
    if (!isUpdated) {
        responseUtils.renderJSON({ success: false });
    } else {
        responseUtils.renderJSON({ success: true });
    }
}

/**
 * Verify with Klarna that the order has been placed in SFCC
 */
function push() {
    var klarnaOrderID = request.httpParameterMap.klarna_order_id;
    var klarnaCountry = request.httpParameterMap.klarna_country;

    if (!klarnaOrderID || !klarnaCountry) {
        response.setStatus(200);
        return;
    }

    var localeObject = utils.getLocaleObject(klarnaCountry);

    var klarnaOrderService = new KlarnaOrderService();

    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);

    var placeOrderResult = KlarnaPlaceOrderController.Start({ // eslint-disable-line new-cap
        klarnaOrderObject: klarnaOrderObject,
        localeObject: localeObject
    });

    var order = (placeOrderResult.order_created && placeOrderResult.Order) ? placeOrderResult.Order : null;

    if (order && order.confirmationStatus.value === Order.CONFIRMATION_STATUS_CONFIRMED) {
        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject);
    } else if (order && (order.status.value === Order.ORDER_STATUS_CREATED && klarnaOrderObject.fraud_status === FRAUD_STATUS.PENDING)) {
        klarnaOrderService.acknowledgeOrder(klarnaOrderID, localeObject);
    } else {
        klarnaOrderService.cancelOrder(klarnaOrderID, localeObject);
    }

    response.setStatus(200);
}

/**
 * Select a shipping method for the default shipment.
 */
function selectShippingMethod() {
    var cart = KlarnaCartModel.get();
    var responseUtils = require('*/cartridge/scripts/util/Response');

    if (!cart) {
        responseUtils.renderJSON({ success: false });
        return;
    }

    var responseObject = Transaction.wrap(function () {
        cart.updateShipmentShippingMethod(cart.getDefaultShipment().getID(), request.httpParameterMap.shippingMethodID, null, null);
        cart.calculate();

        if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            var isSuccessful = utils.calculatePaymentTransactionTotals(cart.object);
            if (!isSuccessful) {
                cart.removePaymentInstruments(cart.getPaymentInstruments(PaymentInstrument.METHOD_GIFT_CERTIFICATE));
                return {
                    success: true,
                    redirect: URLUtils.https('KlarnaCheckout-Start').toString()
                };
            }
        }
        return null;
    });

    if (responseObject) {
        responseUtils.renderJSON(responseObject);
    } else {
        responseUtils.renderJSON({ success: true });
    }
}

/**
 *  Updates default shipment shipping address.
 *
 *  @transactional
 */
function updateShippingAddress() {
    var shippingAddress;
    var cart = KlarnaCartModel.get();
    var responseUtils = require('*/cartridge/scripts/util/Response');

    if (!cart) {
        responseUtils.renderJSON({ success: false });
        return;
    }

    var responseObject = Transaction.wrap(function () {
        shippingAddress = cart.createShipmentShippingAddress(cart.getDefaultShipment().getID());

        var countryCode = request.httpParameterMap.country.stringValue.toLowerCase();
        // Klarna JS API returns ISO3 country codes in this case, so we use map to get ISO2 country codes.
        if (countryCode && countryCode.length === 3) {
            var countryCodesMap = require('*/cartridge/countryCodesMap');
            countryCode = countryCodesMap[countryCode];
        }

        shippingAddress.setFirstName(request.httpParameterMap.given_name.stringValue);
        shippingAddress.setLastName(request.httpParameterMap.family_name.stringValue);
        shippingAddress.setAddress1(request.httpParameterMap.street_address.stringValue);
        shippingAddress.setAddress2(request.httpParameterMap.street_address2.stringValue);
        shippingAddress.setCity(request.httpParameterMap.city.stringValue);
        shippingAddress.setPostalCode(request.httpParameterMap.postal_code.stringValue);
        shippingAddress.setStateCode(request.httpParameterMap.region.stringValue);
        shippingAddress.setCountryCode(countryCode);

        cart.calculate();

        if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            var isSuccessful = utils.calculatePaymentTransactionTotals(cart.object);
            if (!isSuccessful) {
                cart.removePaymentInstruments(cart.getPaymentInstruments(PaymentInstrument.METHOD_GIFT_CERTIFICATE));
                return {
                    success: true,
                    redirect: URLUtils.https('KlarnaCheckout-Start').toString()
                };
            }
        }
        return null;
    });

    if (responseObject) {
        responseUtils.renderJSON(responseObject);
    } else {
        responseUtils.renderJSON({
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
}

/**
 *  Renders the order summary
 */
function updateSummary() {
    var cart = KlarnaCartModel.get();

    Transaction.wrap(function () {
        cart.calculate();
    });

    app.getView({
        checkoutstep: 0,
        Basket: cart.object
    }).render('checkout/klarna_minisummary');
}

/**
 *  Entry point for notifications on pending orders
 */
function notification() {
    var klarnaFraudDecisionObject = JSON.parse(request.httpParameterMap.requestBodyAsString);
    var klarnaOrderID = klarnaFraudDecisionObject.order_id;
    var klarnaCountry = request.httpParameterMap.klarna_country.value;

    Logger.getLogger('Klarna').info('Received notification for Klarna order with ID: {0}.', klarnaOrderID);

    var localeObject = utils.getLocaleObject(klarnaCountry);
    var klarnaOrderService = new KlarnaOrderService();
    var klarnaOrderObject = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);

    if (klarnaOrderObject) {
        if (klarnaFraudDecisionObject.event_type === 'FRAUD_RISK_STOPPED') {
            handleStoppedOrders(klarnaOrderObject.merchant_reference1);
        } else {
            KlarnaPlaceOrderController.Start({ // eslint-disable-line new-cap
                klarnaOrderObject: klarnaOrderObject,
                localeObject: localeObject,
                isPendingOrder: true
            });
        }
    }

    response.setStatus(200);
}


/*
* Exposed methods.
*/
/** Start the Klarna Checkout process.
 * @see {@link module:controllers/KlarnaCheckout~start} */
exports.Start = guard.ensure(['https'], start);
/** Updates the Klarna order.
 * @see {@link module:controllers/KlarnaCheckout~update} */
exports.Update = guard.ensure(['https', 'post'], update);
/** Updates the Klarna order.
* @see {@link module:controllers/KlarnaCheckout~validation} */
exports.Validation = guard.ensure(['https', 'post'], validation);
/** Render the Klarna confirmation snippet.
* @see {@link module:controllers/KlarnaCheckout~confirmation} */
exports.Confirmation = guard.ensure(['https'], confirmation);
/** Updates Klarna Checkout iFrame.
* @see {@link module:controllers/KlarnaCheckout~updateKlarnaCheckout} */
exports.UpdateKlarnaCheckout = guard.ensure(['https'], updateKlarnaCheckout);
/** Verify with Klarna that the order has been created in SFCC.
* @see {@link module:controllers/KlarnaCheckout~push} */
exports.Push = guard.ensure(['https'], push);
/** Select a shipping method for the default shipment.
* @see {@link module:controllers/KlarnaCheckout~selectShippingMethod} */
exports.SelectShippingMethod = guard.ensure(['https'], selectShippingMethod);
/** Updates default shipment shipping address.
* @see {@link module:controllers/KlarnaCheckout~updateShippingAddress} */
exports.UpdateShippingAddress = guard.ensure(['https'], updateShippingAddress);
/** Updates the order summary.
* @see {@link module:controllers/KlarnaCheckout~updateSummary} */
exports.UpdateSummary = guard.ensure(['https'], updateSummary);
/** Entry point for notifications on pending orders.
* @see {@link module:controllers/KlarnaCheckout~notification} */
exports.Notification = guard.ensure(['https'], notification);
