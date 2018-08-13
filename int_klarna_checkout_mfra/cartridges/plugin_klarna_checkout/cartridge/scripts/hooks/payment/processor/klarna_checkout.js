'use strict';

/* API Includes */
var Transaction = require('dw/system/Transaction');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var PaymentMgr = require('dw/order/PaymentMgr');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

/* Script Modules */
var KlarnaOrderService = require('~/cartridge/scripts/services/KlarnaOrderService');

/**
 * Create the Klarna Checkout payment instrument.
 */
function Handle(args) {
	var KlarnaHelpers = require('~/cartridge/scripts/util/klarnaHelpers');
	var basket = args.Basket;
	var paymentInstrs = [];
	var iter = {};
	var existingPI = {};
	var amount = 0;
	

	Transaction.wrap(function () {
		if (basket === null) {
			return { error: true };
		}

		paymentInstrs = basket.getPaymentInstruments();
		iter = paymentInstrs.iterator();
		existingPI = null;

		// remove all PI except gift certificates
		while( iter.hasNext() )
		{
			existingPI = iter.next();
			if (!PaymentInstrument.METHOD_GIFT_CERTIFICATE.equals(existingPI.paymentMethod)) {
				args.Basket.removePaymentInstrument(existingPI);
			}		
		}
		
		amount = KlarnaHelpers.calculateNonGiftCertificateAmount(basket);
        basket.createPaymentInstrument('KLARNA_CHECKOUT', amount);
	});

	return {
		success: true
	};
}

/**
 * The payment is authorized by using the KLARNA_CHECKOUT processor.
 */
function Authorize(args) {
    var order = args.Order;
    var klarnaOrderObj = args.KlarnaOrderObj;
    var klarnaOrderID = klarnaOrderObj.order_id;
    var localeObject = args.LocaleObject;
    var isPendingOrder = args.isPendingOrder;
	var paymentInstrument = args.PaymentInstrument;
	var paymentProcessor = PaymentMgr.getPaymentMethod(paymentInstrument.getPaymentMethod()).getPaymentProcessor();

    Transaction.wrap(function () {
        paymentInstrument.paymentTransaction.transactionID = klarnaOrderID;
        paymentInstrument.paymentTransaction.paymentProcessor = paymentProcessor;
    });

	var klarnaOrderService = new KlarnaOrderService();

    if (!klarnaOrderObj.fraud_status) {
    	klarnaOrderObj = klarnaOrderService.getOrder(klarnaOrderID, localeObject, true);
    	if (!klarnaOrderObj) {
    		return {error: true};
    	}
    }

    var fraudStatusResult = handleFraudStatus(klarnaOrderObj.fraud_status, isPendingOrder)
    if (!fraudStatusResult) {
    	return {error: true};
	}

    Transaction.wrap(function () {
    	paymentInstrument.paymentTransaction.custom.kcFraudStatus = fraudStatusResult.OrderFraudStatus;
	});
    
    if (fraudStatusResult.OrderApproved !== true) {
    	if (fraudStatusResult.OrderInReview === true) {
	    	return {pending: true};
    	} else {
    		return {declined: true};
    	}
    }

    var paymentMode = Site.getCurrent().getCustomPreferenceValue('kcPaymentMode').value;
    var vcnEnabled = Site.getCurrent().getCustomPreferenceValue('kcVCNEnabled');

    if (paymentMode === 'DIRECT_CAPTURE' && order.paymentStatus.value === dw.order.Order.PAYMENT_STATUS_NOTPAID && !vcnEnabled) {
		var amount = paymentInstrument.paymentTransaction.amount;
		var isSuccessful = klarnaOrderService.captureOrder(klarnaOrderID, localeObject, amount);
		if (isSuccessful) {
			Transaction.wrap(function () {
				paymentInstrument.paymentTransaction.type = dw.order.PaymentTransaction.TYPE_CAPTURE;
				order.paymentStatus = dw.order.Order.PAYMENT_STATUS_PAID;
			});
		}
    } else {
    	Transaction.wrap(function () {
    		paymentInstrument.paymentTransaction.type = dw.order.PaymentTransaction.TYPE_AUTH;
    	});
    }

    if (!vcnEnabled) {
    	return {authorized: true};
    }
    
    //If VCN is enabled as a payment option create the virtual card and save it in order custom attributes.
    var result = createVCNSettlement(order, klarnaOrderID, localeObject);

    if (result.error) {
    	return {error: true};
    }
    
	//Plug here your Credit Card Processor    
    Transaction.wrap(function () {
        paymentInstrument.paymentTransaction.transactionID = order.getOrderNo();
        paymentInstrument.paymentTransaction.paymentProcessor = paymentProcessor;
    });
    return {authorized: true};
}

/**
 * Handles Klarna Fraud Status
 * 
 * @param  {String} klarnaFraudStatus
 * @param  {String} isPendingOrder
 * @return {Object} fraud status result
 */
function handleFraudStatus(klarnaFraudStatus, isPendingOrder) {
	var FRAUD_STATUS = require('~/cartridge/scripts/util/klarnaConstants').FRAUD_STATUS;
	var orderFraudStatus = null;
	isPendingOrder = (isPendingOrder === true);

	if (klarnaFraudStatus === FRAUD_STATUS.ACCEPTED) {

		if (isPendingOrder) {
			orderFraudStatus = FRAUD_STATUS.ACCEPTED_AFTER_REVIEW;
		} else {
			orderFraudStatus = FRAUD_STATUS.ACCEPTED;
		}

		return {
			OrderFraudStatus: orderFraudStatus,
			OrderInReview: false,
			OrderApproved: true
		};
	}

	if (klarnaFraudStatus === FRAUD_STATUS.PENDING) {
		orderFraudStatus = FRAUD_STATUS.PENDING;

		return {
			OrderFraudStatus: orderFraudStatus,
			OrderInReview: true,
			OrderApproved: false
		};
	}

	if (klarnaFraudStatus === FRAUD_STATUS.REJECTED) {

		if (isPendingOrder) {
			orderFraudStatus = FRAUD_STATUS.REJECTED_AFTER_REVIEW;
		} else {
			orderFraudStatus = FRAUD_STATUS.REJECTED;
		}

		return {
			OrderFraudStatus: orderFraudStatus,
			OrderInReview: false,
			OrderApproved: false
		};
	}

	Logger.getLogger('Klarna').error('Unknown Klarna Fraud Status');
    return orderFraudStatus;
}

/**
 * API call to create new Klarna VCN settlement
 *
 * @param  {dw.order.Order} order
 * @param  {String} klarnaOrderID
 * @param  {dw.object.CustomObject} localeObject
 * @return {Object} creation result, if successful { success: true }, otherwise { error: true }
*/
function createVCNSettlement(order, klarnaOrderID, localeObject) {
	var Cypher = require('dw/crypto/Cipher');
	var KlarnaOrderService = require('~/cartridge/scripts/services/KlarnaOrderService');

	var klarnaOrderService = new KlarnaOrderService();

    var response = klarnaOrderService.createVCNSettlement(klarnaOrderID, localeObject)

	if (!response || !response.settlement_id) {
		return {error: true};	
	}

	try {
		//Decrypt PAN and CSC
		var VCNPrivateKey = Site.getCurrent().getCustomPreferenceValue('vcnPrivateKey');
		var cypher = new Cypher();

		var panEncrypted = response.cards[0].pan;
		var cscEncrypted = response.cards[0].csc;

		//mocking pan and csc for debug purposes
		//var panEncrypted = 'U50dpsYfr29a+kZta2A9pYdAPYvp1GnUYEt7BwFF2vWcD+31EHhzUuKHNnns61NQ+pjayXjHMll1v3lNLDehhAVj5/OuJCmAgk20Wx1SI/RYLtK5wA9Iv7ZOnGdwXOseTTUcXCgY1fjpBWtpqlgsBgqobZhaX3Q0KaBk89qwT2o21/Yo5HKiafxnZSAQ0x2lG5GBkRjy/UC/9nfkeCNZATxADQG2L3FnHrqXq/F6CLUmsxPIawWO5wmpYToa4/4UhAuQS/L/3lmvXoBd68gNSQsWSs+gjrNxMejmR5HJvzuwUj+htLZxvGds+FRSFFABZfbU+z1b9HjbzdxdkD55jtVHoWA1diTiFODSguScertk0oCwAFz6AKFC4P7NedfDuko3QFew2ab3CFO76DYQYXDE18itNHAG/PgpkYttS7sS1n1EJMBGh+18BbOmOutyuuAq0z7j3tiUfLl0aXCMs76VeoawGBKQhIY2k6fUTlaRjolSAwcwZbZV7dZZq5TcwIVzhiIBOtz/v3y0AhnEUua5kOeM6r1ulPqdPv2vHRIPPDHwQ6051GB68QpVnIRnvR63UVOqogsXyBduO281MNbXWRlO7c1UbjI3UlJiM0AVsZgZ0uWQxhbF+Xu48dkjhcjvbA4oi79RRtw4UfDHyEOOSX2zaOf/D5KY1GUPwAw=';
		//var cscEncrypted = 'P/jEMDJszBNpVdwNN/OCBHW+yuF3WcXGhX/vwVFjeGjp/YohO//6pHm9ggtY0m6inTzvfA849VZlJxeq8QVpo1p8dUUvC6L6CvmUEC8kUZBU77TkNChJCvzaGYr74pjsntu65A3nipraGCoCkAdYagtrJBZ0gl6jrv8jq2f+OfuH+YZoX0HMqvSh0v1+M+7sHLhxVDPs7Daqn8v6qyuZEajMYk4AZI4uKAu/X3TJTItC4hXa/epGIPDivyQ/EwDMK27P/I8rfw0bY6zxMw2+fYWlVjXbrUtl7Z/WiiUNC3cayrZtysAphD3RLt9re6dC6h1AzCIWBFZxHKCJB1MihDqgALOeLS6B4rxqljbb3bfWAkK6nkbnSEHwlvh628eNyIS9Ga/YWlriy4Z7kcCH7VuFcfKskGiDUE1qozeOmq58dMj6DRwsjgCshnWfd/HXcIdYuvEb0wn/mMygZa7MG2V7Sd2ROLtNpn6JhR0WScgJcwNWVN7sfhmElGy8bcmDYArusU0mDTUfamPmhVeRTbdiWE8xEqSqmIStUoPe1BvxHeKs+Gdw6iQKsxruwOJb+Tz5zzyfbsrVDp3wxsa3nb9nSJOZGTmi3ie7y02a/KuLGsypsIXZR2P1Jjofuh4mvT1nu4W2VJKNG9IuhxIAh8adCCxbZ0Cn70+8P3p42S4=';
		
		var panDecrypted = cypher.decrypt(panEncrypted, VCNPrivateKey, "RSA/ECB/PKCS1PADDING", null, 0);
		var cscDecrypted = cypher.decrypt(cscEncrypted, VCNPrivateKey, "RSA/ECB/PKCS1PADDING", null, 0);

		Transaction.wrap(function () {
			order.custom.kcVCNBrand = response.cards[0].brand;
			order.custom.kcVCNCSC = cscDecrypted;
			order.custom.kcVCNExpirationMonth = response.cards[0].expiration_month;
			order.custom.kcVCNExpirationYear = response.cards[0].expiration_year;
			order.custom.kcVCNHolder = response.cards[0].holder;
			order.custom.kcVCNPAN = panDecrypted;	
			order.custom.kcIsVCN = true;		
		});

	} catch (e) {
		Logger.getLogger('Klarna').error(e);
		return {error: true};
	}

	return {success: true};
}

/*
 * Module exports
 */
exports.Handle = Handle;
exports.Authorize = Authorize;
