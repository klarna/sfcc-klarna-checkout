'use strict';

/**
 * @module controllers/KlarnaPlaceOrder
*/

var STOREFRONT_CARTRIDGE = require('~/cartridge/scripts/util/KlarnaConstants.js').STOREFRONT_CARTRIDGE;

/* API Includes */
var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var CustomerMgr = require('dw/customer/CustomerMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var HookMgr = require('dw/system/HookMgr');
var Status = require('dw/system/Status');

/* Script Modules */
var app = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/app');
var Order = app.getModel('Order');
var KlarnaCartModel = require('~/cartridge/scripts/models/KlarnaCartModel');
var KlarnaHttpService = require('~/cartridge/scripts/common/KlarnaHttpService.ds');
var KlarnaApiContext = require('~/cartridge/scripts/common/KlarnaApiContext');
var KLARNA_PAYMENT_METHOD = require('int_klarna_checkout/cartridge/scripts//util/KlarnaConstants.js').PAYMENT_METHOD;
var KLARNA_CHECKOUT = require('int_klarna_checkout/cartridge/scripts/payment/processor/KLARNA_CHECKOUT.js');


/**
 * The entry point for placing the order in SCC.
 *
 * @return {Object} JSON object that is empty, contains error information, or PlaceOrderError status information.
 */
function start(context) {
	var order, klarnaOrderObj, localeObject, isPendingOrder;

	klarnaOrderObj = context.klarnaOrderObject;
	localeObject = context.localeObject;
	isPendingOrder = context.isPendingOrder;

	order = OrderMgr.getOrder(klarnaOrderObj.merchant_reference1);

	if (!order) {
		order = createOrder(klarnaOrderObj, localeObject);
		if (!order) {
			return {
				error: true,
				PlaceOrderError: new Status(dw.system.Status.ERROR, "confirm.error.technical")
		    };
		}
	}

	if (order.status.value !== order.ORDER_STATUS_CREATED) {
		return {
	        Order: order,
	        order_created: true
	    };
	}

	KLARNA_CHECKOUT.Handle({Basket: order});

	var handlePaymentsResult = handlePayments(order, klarnaOrderObj, localeObject, isPendingOrder);

	if (handlePaymentsResult.error) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order);
            session.custom.klarnaOrderID = null;
            return {
                error: true,
                PlaceOrderError: new Status(Status.ERROR, 'confirm.error.technical')
            };
        });

    } else if (handlePaymentsResult.missingPaymentInfo) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order);
            session.custom.klarnaOrderID = null;
            return {
                error: true,
                PlaceOrderError: new Status(Status.ERROR, 'confirm.error.technical')
            };
        });

    } else if (handlePaymentsResult.declined) {
		return Transaction.wrap(function () {
			OrderMgr.failOrder(order);
			session.custom.klarnaOrderID = null;
			return {
				error: true,
				PlaceOrderError: new Status(Status.ERROR, 'confirm.error.declined') 
			};
		});    

    } else if (handlePaymentsResult.pending) {
    	return {
            order_created: true,
            Order: order
        };
	}

    var orderPlacementStatus = Order.submit(order);

    return orderPlacementStatus;
	
	
}

/**
 * Responsible for payment handling. This function uses PaymentProcessorModel methods to
 * handle payment processing specific to each payment instrument. It returns an
 * error if any of the authorizations failed or a payment
 * instrument is of an unknown payment method. If a payment method has no
 * payment processor assigned, the payment is accepted as authorized.
 *
 * @transactional
 * @param {dw.order.Order} order - the order to handle payments for.
 * @return {Object} JSON object containing information about missing payments, errors, or an empty object if the function is successful.
 */
function handlePayments(order, klarnaOrderObj, localeObject, isPendingOrder) {
	var kcoAuthorizationResult = {};

    if (order.getTotalNetPrice() !== 0.00) {

        var paymentInstruments = order.getPaymentInstruments();

        if (paymentInstruments.length === 0) {
            return {
                missingPaymentInfo: true
            };
        }
        /**
         * Sets the transaction ID for the payment instrument.
         */
        var handlePaymentTransaction = function () {
            paymentInstrument.getPaymentTransaction().setTransactionID(order.getOrderNo());
        };

        for (var i = 0; i < paymentInstruments.length; i++) {
            var paymentInstrument = paymentInstruments[i];

            if (PaymentMgr.getPaymentMethod(paymentInstrument.getPaymentMethod()).getPaymentProcessor() === null) {

                Transaction.wrap(handlePaymentTransaction);

            } else {
            	var authorizationResult = {};
            	var processor = PaymentMgr.getPaymentMethod(paymentInstrument.getPaymentMethod()).getPaymentProcessor();
            	if (processor.ID === 'KLARNA_CHECKOUT') {
            		kcoAuthorizationResult = authorizationResult = KLARNA_CHECKOUT.Authorize({
                    	Order: order, 
                    	PaymentInstrument: paymentInstrument, 
                    	KlarnaOrderObj: klarnaOrderObj, 
                    	LocaleObject: localeObject, 
                    	isPendingOrder: isPendingOrder
                	});

            	} else if (HookMgr.hasHook('app.payment.processor.' + processor.ID)) {
            		if (!isPendingOrder) {
	            		authorizationResult = HookMgr.callHook('app.payment.processor.' + processor.ID, 'Authorize', {
	                        Order: order,
	                        OrderNo: order.getOrderNo(),
	                        PaymentInstrument: paymentInstrument
	                    });
            		}

            	} else {
            		authorizationResult = {not_supported: true};
            	}

                if (authorizationResult.not_supported || authorizationResult.error) {
                    return {
                        error: true
                    };
                }
            }
        }
    }

    return kcoAuthorizationResult;
}

/**
 * Creates the order in SFCC
 *
 * @transactional
 * @return  {dw.order.Order} order
 */
function createOrder(klarnaOrderObject, localeObject) {
	var cart, validationResult, order;

	cart = KlarnaCartModel.goc();

	Transaction.wrap(function () {
		cart.restore(klarnaOrderObject);
	});

	validationResult = cart.validateForCheckout();
    if (!validationResult.EnableCheckout) {
    	return;
    }

    Transaction.begin();

    try {
    	if (klarnaOrderObject.merchant_reference1) {
    		order = OrderMgr.createOrder(cart.object, klarnaOrderObject.merchant_reference1);
    	} else {

    		if (!localeObject) {
    			var utils = require('~/cartridge/scripts/util/KlarnaHelper');
    			localeObject = utils.getLocaleObject();
    		}

    		order = OrderMgr.createOrder(cart.object);
    		updateKlarnaOrderMerchantReferences(klarnaOrderObject.order_id, localeObject, order.orderNo);
    	}

	    if (klarnaOrderObject.merchant_reference2) {
	    	setOrderCustomer(order, klarnaOrderObject.merchant_reference2)
	    }

	    order.setExternalOrderNo(klarnaOrderObject.order_id);

	   	order.setExternalOrderStatus(klarnaOrderObject.status);

	   	order.setExternalOrderText(KLARNA_PAYMENT_METHOD);

    } catch (e) {
    	Transaction.rollback();
    	return;
    }

   	Transaction.commit();

   	return order;
}

/**
 * Set SFCC Order Customer
 *
 * @param  {dw.order.Order} order
 * @param  {String} customerNo
 * @return {void}
 */
function setOrderCustomer(order, customerNo) {
	var customer = CustomerMgr.getCustomerByCustomerNumber(customerNo);

	if (customer !== null) {
		order.setCustomer(customer);

		if (!empty(customer.profile.firstName)) {
			customerName = customer.profile.firstName;
		}

		if (!empty(customer.profile.lastName)) {
			customerName += ' ' + customer.profile.lastName;
		}

		if (!empty(customerName)) {
			order.setCustomerName(customerName);
		}
	}
}

/**
 * API call to update Klarna Order Merchant References
 *
 * @param  {String} klarnaOrderID
 * @param  {dw.object.CustomObject} localeObject
 * @param  {String} orderNo
 * @return {Boolean} true if successful, false otherwise
 */
function updateKlarnaOrderMerchantReferences(klarnaOrderID, localeObject, orderNo) {
	var klarnaHttpService = new KlarnaHttpService();
    var klarnaApiContext = new KlarnaApiContext();
    var requestBodyObject = new Object();

	requestBodyObject.merchant_reference1 = orderNo;

	var requestUrl = dw.util.StringUtils.format(klarnaApiContext.getFlowApiUrls().get('updateMerchantReferences'), klarnaOrderID);
	var response;

	try {
		response = klarnaHttpService.call(requestUrl, 'PATCH', localeObject.custom.credentialID, requestBodyObject);
	} catch (e) {
		return false;
	}

	return true;
}


/*
* Exposed methods.
*/
exports.Start = start;
exports.CreateOrder = createOrder;