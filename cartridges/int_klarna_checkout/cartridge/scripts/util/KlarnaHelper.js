'use strict';

/**
 * @module util/KlarnaHelper
 */

var STOREFRONT_CARTRIDGE = require('int_klarna_checkout/cartridge/scripts/util/KlarnaConstants.js').STOREFRONT_CARTRIDGE;

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var Money = require('dw/value/Money');
var Logger = require('dw/system/Logger');

/**
 * Get Klarna locale object
 * @return {dw.web.URL} the last called URL
 */
exports.getLocaleObject = function (countryCode) {
	if (!countryCode) {
		var Countries = require(STOREFRONT_CARTRIDGE.CORE + '/cartridge/scripts/util/Countries');
		countryCode = Countries.getCurrent({CurrentRequest: request}).countryCode;
	}
	
	try {
		var localeObject = CustomObjectMgr.getCustomObject('KlarnaCountries', countryCode);
		
		if (!localeObject) {
			throw new Error('Klarna - No active locale custom object found');
		}

	} catch (e) {
		Logger.error(e);
		return null;
	}

	return localeObject;
};

/**
 * Calculates Payment Transaction Totals.
 * 
 * @param {dw.order.Basket} basket The basket to calculate the payment transaction totals for
 * @return {Boolean} true if successful, false otherwise
 */
exports.calculatePaymentTransactionTotals = function (basket) {
    var paymentInstruments = basket.getPaymentInstruments();
    var iter = paymentInstruments.iterator();
    var paymentInstrument = null;
	var nonGCPaymentInstrument = null;
	var giftCertTotal = new Money(0.0, basket.currencyCode);

    // locate any non-gift certificate payment instrument
    while(iter.hasNext())
    {
    	paymentInstrument = iter.next();
    	if (PaymentInstrument.METHOD_GIFT_CERTIFICATE.equals(paymentInstrument.paymentMethod)) {
    		giftCertTotal = giftCertTotal.add(paymentInstrument.getPaymentTransaction().getAmount());
    		continue;
    	}

    	nonGCPaymentInstrument = paymentInstrument;
    	break;
    }
  
	var orderTotal = basket.totalGrossPrice;

    if (!nonGCPaymentInstrument) {
    	// if we have no other payment types and the gift certificate
    	// doesn't cover the order we need to error out.
    	if (giftCertTotal < orderTotal) {
    		return false;
    	} else {  		
    		return true;
    	}
    }

	// calculate the amount to be charged for the 
	// non-gift certificate payment instrument
    var checkoutUtils = require('int_klarna_checkout/cartridge/scripts/checkout/Utils.ds');
	var amount = checkoutUtils.calculateNonGiftCertificateAmount(basket);

    // now set the non-gift certificate payment instrument total.
    if (amount.value < 0.0) {
    	return false;
    } else {
        nonGCPaymentInstrument.paymentTransaction.setAmount(amount);
    }

    return true;
}

