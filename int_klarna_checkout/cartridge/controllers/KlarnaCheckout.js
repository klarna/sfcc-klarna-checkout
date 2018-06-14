'use strict';

/**
 * @module controllers/KlarnaCheckout
*/

var STOREFRONT_CARTRIDGE = require('~/cartridge/scripts/util/KlarnaConstants.js').STOREFRONT_CARTRIDGE;

/* API Includes */
var URLUtils = require('dw/web/URLUtils');
var Site = require('dw/system/Site');
var Transaction = require('dw/system/Transaction');
var ShippingMgr = require('dw/order/ShippingMgr');
var Status = require('dw/system/Status');
var StringUtils = require('dw/util/StringUtils');
var OrderMgr = require('dw/order/OrderMgr');
var Logger = require('dw/system/Logger');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');

/* Script Modules */
var app = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/app');
var guard = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/guard');
var utils = require('~/cartridge/scripts/util/KlarnaHelper');
var KlarnaHttpService = require('~/cartridge/scripts/common/KlarnaHttpService.ds');
var KlarnaApiContext = require('~/cartridge/scripts/common/KlarnaApiContext');
var KlarnaOrderRequestBuilder = require('~/cartridge/scripts/order/KlarnaOrderRequestBuilder');
var KLARNA_CHECKOUT = require('~/cartridge/scripts/payment/processor/KLARNA_CHECKOUT');
var KlarnaCartModel = require('~/cartridge/scripts/models/KlarnaCartModel');
var KlarnaPlaceOrderController = require('~/cartridge/controllers/KlarnaPlaceOrder');
var TransientAddress = app.getModel('TransientAddress');

/**
 * Start the Klarna Checkout process
 */
function start(context) {
	var cart, physicalShipments, localeObject, shippingAddress, validationResult, checkoutSnippet;

	cart = KlarnaCartModel.get();

	if (!cart) {
		response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    physicalShipments = cart.getPhysicalShipments();
    if (Site.getCurrent().getCustomPreferenceValue('enableMultiShipping') && physicalShipments && physicalShipments.size() > 1) {
    	app.getView({
    		KlarnaError: 'klarna.checkout.multishipError'
        }).render('checkout/klarna_checkout');
        return;
    }

	pageMeta = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/meta');
    pageMeta.update({
        pageTitle: 'Klarna Checkout'
    });

    localeObject = utils.getLocaleObject();

    shippingAddress = new TransientAddress();
    shippingAddress.countryCode = localeObject.custom.country;
    shippingAddress.postalCode = ' ';

    validationResult = cart.validateForCheckout();
    if (!validationResult.EnableCheckout) {
    	response.redirect(URLUtils.https('Cart-Show'));
    }

    prepareShipping(shippingAddress);

    KLARNA_CHECKOUT.Handle({Basket: cart.object});

    Transaction.wrap(function () {
		cart.calculate();
	});

    if (!session.custom.klarnaOrderID) {
    	checkoutSnippet = createKlarnaOrder(cart, localeObject);
    } else {
    	checkoutSnippet = updateKlarnaOrder(cart, localeObject);
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

	var KlarnaOrderUpdateResponseBuilder = require('~/cartridge/scripts/order/KlarnaOrderUpdateResponseBuilder');
	var klarnaOrderUpdateResponseBuilder = new KlarnaOrderUpdateResponseBuilder();
	var orderUpdateResponse = klarnaOrderUpdateResponseBuilder.buildResponse({
	    basket: cart.object,
	    showShippingMethods: !empty(klarnaOrderObject.selected_shipping_option)
	}).get();

	let responseUtils = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/util/Response');
	responseUtils.renderJSON(orderUpdateResponse);
}

/**
 * Validate the Klarna order
 */
function validation() {
	var klarnaOrderObject = JSON.parse(request.httpParameterMap.requestBodyAsString);

	//var order = OrderMgr.searchOrder('externalOrderNo = {0}', [klarnaOrderObject.order_id]);
	var order = OrderMgr.getOrder(klarnaOrderObject.merchant_reference1);

	if (!order) {
		order = KlarnaPlaceOrderController.CreateOrder(klarnaOrderObject);

		if (!order) {
			response.redirect(URLUtils.https('Cart-Show'));
			return;
		}
	}

	response.setStatus(200);
}

/**
 * Render the Klarna confirmation snippet
 */
function confirmation() {
	var klarnaOrderID, klarnaCountry, localeObject, klarnaOrderObject;

	if (session.custom.klarnaOrderID) {
		session.custom.klarnaOrderID = null;
	}

	klarnaOrderID = request.httpParameterMap.klarna_order_id;
	klarnaCountry = request.httpParameterMap.klarna_country;

	if (!klarnaOrderID || !klarnaCountry) {
		start({
			PlaceOrderError: new Status(dw.system.Status.ERROR, "confirm.error.technical")
		});
        return;
	}

	localeObject = utils.getLocaleObject(klarnaCountry);

	klarnaOrderObject = getKlarnaOrder(klarnaOrderID, localeObject);
	
	if (!klarnaOrderObject) {
		start({
			PlaceOrderError: new Status(dw.system.Status.ERROR, "confirm.error.technical")
		});
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
	var cart, localeObject, isUpdated;

	cart = KlarnaCartModel.get();

	if (!cart) {
		response.redirect(URLUtils.https('Cart-Show'));
        return;
    }

    localeObject = utils.getLocaleObject();

    Transaction.wrap(function () {
        cart.calculate();
    });

    if (!session.custom.klarnaOrderID) {
    	isUpdated = createKlarnaOrder(cart, localeObject);
    } else {
    	isUpdated = updateKlarnaOrder(cart, localeObject);
    }

    let responseUtils = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/util/Response');
    if (!isUpdated) {
    	responseUtils.renderJSON({success: false});
    } else {
    	responseUtils.renderJSON({success: true});
    }
}

/**
 * Verify with Klarna that the order has been created in SFCC
 */
function push() {
	var klarnaOrderID, klarnaCountry, localeObject, klarnaOrderObject;

	klarnaOrderID = request.httpParameterMap.klarna_order_id;
	klarnaCountry = request.httpParameterMap.klarna_country;

	if (!klarnaOrderID || !klarnaCountry) {
		response.setStatus(200);
		return;
	}

	localeObject = utils.getLocaleObject(klarnaCountry);

	klarnaOrderObject = getKlarnaOrder(klarnaOrderID, localeObject, true);

	var placeOrderResult = KlarnaPlaceOrderController.Start({
		klarnaOrderObject: klarnaOrderObject,
		localeObject: localeObject
	});

    if (placeOrderResult.order_created) {
    	acknowledgeKlarnaOrder(klarnaOrderID, localeObject);
    }

    response.setStatus(200);
}

/**
 * Select a shipping method for the default shipment.
 */
function selectShippingMethod() {
	var cart = KlarnaCartModel.get();
	let responseUtils = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/util/Response');

	if (!cart) {
		responseUtils.renderJSON({success: false});
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
	});
	
	if (responseObject) {
		responseUtils.renderJSON(responseObject);
	} else {
		responseUtils.renderJSON({success: true});
	}
}

/**
 *  Updates default shipment shipping address.
 *  
 *  @transactional
 */
function updateShippingAddress() {
	var shippingAddress, responseObject;
	var cart = KlarnaCartModel.get();
	let responseUtils = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/util/Response');

	if (!cart) {
		responseUtils.renderJSON({success: false});
        return;
    }

	responseObject = Transaction.wrap(function () {
		shippingAddress = cart.createShipmentShippingAddress(cart.getDefaultShipment().getID());

		var countryCode = request.httpParameterMap.country.stringValue.toLowerCase();
		//Klarna JS API returns ISO3 country codes in this case, so we use map to get ISO2 country codes.
		if (countryCode && countryCode.length === 3) {
			var countryCodesMap = require('~/cartridge/countryCodesMap');
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
	var klarnaOrderObject, localeObject;
    var klarnaFraudDecisionObject = JSON.parse(request.httpParameterMap.requestBodyAsString);
    var klarnaOrderID = klarnaFraudDecisionObject.order_id;
    var klarnaCountry = request.httpParameterMap.klarna_country.value;

    localeObject = utils.getLocaleObject(klarnaCountry);
    klarnaOrderObject = getKlarnaOrder(klarnaOrderID, localeObject, true);

    if (klarnaOrderObject) {
    	KlarnaPlaceOrderController.Start({
			klarnaOrderObject: klarnaOrderObject,
			localeObject: localeObject,
			isPendingOrder: true
		});
    }

    response.setStatus(200);
}

/**
 * Set the shipping method
 * 
 * @transactional
 * @param  {dw.order.OrderAddress} shippingAddress
 * @return {void}
 */
function prepareShipping(shippingAddress) {
	var cart, applicableShippingMethods, currentShippingMethod, basketAddress, defaultShipmentID;

	cart = KlarnaCartModel.get();
	applicableShippingMethods = cart.getApplicableShippingMethods(shippingAddress);
	currentShippingMethod = cart.getDefaultShipment().getShippingMethod() || ShippingMgr.getDefaultShippingMethod();
	defaultShipmentID = cart.getDefaultShipment().getID();

    Transaction.wrap(function () {
    	basketAddress = cart.createShipmentShippingAddress(defaultShipmentID);
    	basketAddress.setCountryCode(shippingAddress.countryCode);
    	basketAddress.setPostalCode(shippingAddress.postalCode);

        cart.updateShipmentShippingMethod(defaultShipmentID, currentShippingMethod.getID(), currentShippingMethod, applicableShippingMethods);
        cart.calculate();
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
        start(placeOrderResult);
    } else if (placeOrderResult.order_created) {
        showConfirmation(placeOrderResult.Order, context.klarnaOrderObject.html_snippet);
    }
}

/**
 * Renders the order confirmation page after successful order creation.
 * 
 * @param {dw.order.Order} order
 * @param {String} confirmationSnippet Klarna Html confirmation snippet
 */
function showConfirmation(order, confirmationSnippet) {
	var cart = KlarnaCartModel.get();

	if (cart) {
		Transaction.wrap(function () {
			cart.clear();
		});
	}

	var pageMeta = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/meta');
    pageMeta.update({
    	pageTitle: 'Klarna Confirmation'
	});

    app.getView({
        Order: order,
        ConfirmationSnippet: confirmationSnippet
    }).render('checkout/klarna_confirmation');
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

	session.custom.klarnaOrderID = response.order_id;

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
    
    var klarnaOrderID = session.custom.klarnaOrderID;
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

	} catch (e) {
		Logger.error(e);
	}
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


/*
 * Local methods
 */
exports.GetKlarnaOrder = getKlarnaOrder;