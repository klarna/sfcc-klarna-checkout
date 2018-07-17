'use strict';

/**
 * @module util/klarnaHelper
 */

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var Money = require('dw/value/Money');
var Logger = require('dw/system/Logger');
var Locale = require('dw/util/Locale');

/**
 * Get Klarna locale object
 * @param {string} country ISO 3166-1 country code
 * @param {string} localeID request object
 * @returns {dw.object.CustomObject} the locale object
 */
function getLocaleObject(country, localeID) {
    var localeObject;
    var countryCode = country;

    if (!countryCode && localeID) {
        var currentLocale = Locale.getLocale(localeID);
        countryCode = currentLocale.country;
    }

    try {
        localeObject = CustomObjectMgr.getCustomObject('KlarnaCountries', countryCode);
        if (!localeObject) {
            throw new Error('Klarna - No active locale custom object found');
        }
    } catch (e) {
        Logger.error(e);
        return null;
    }

    return localeObject;
}

/**
 * Calculates Payment Transaction Totals.
 *
 * @param {dw.order.Basket} basket The basket to calculate the payment transaction totals for
 * @return {boolean} true if successful, false otherwise
 */
function calculatePaymentTransactionTotals(basket) {
    var paymentInstruments = basket.getPaymentInstruments();
    var iter = paymentInstruments.iterator();
    var paymentInstrument = null;
    var nonGCPaymentInstrument = null;
    var giftCertTotal = new Money(0.0, basket.currencyCode);

    // locate any non-gift certificate payment instrument
    while (iter.hasNext()) {
        paymentInstrument = iter.next();
        if (!PaymentInstrument.METHOD_GIFT_CERTIFICATE.equals(paymentInstrument.paymentMethod)) {
            nonGCPaymentInstrument = paymentInstrument;
            break;
        }

        giftCertTotal = giftCertTotal.add(paymentInstrument.getPaymentTransaction().getAmount());
    }

    var orderTotal = basket.totalGrossPrice;

    if (!nonGCPaymentInstrument) {
        // if we have no other payment types and the gift certificate
        // doesn't cover the order we need to error out.
        if (giftCertTotal < orderTotal) {
            return false;
        }

        return true;
    }

	// calculate the amount to be charged for the
	// non-gift certificate payment instrument
    var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
    var amount = COHelpers.calculateNonGiftCertificateAmount(basket);

    // now set the non-gift certificate payment instrument total.
    if (amount.value < 0.0) {
        return false;
    }

    nonGCPaymentInstrument.paymentTransaction.setAmount(amount);

    return true;
}

/**
 * Creates the order in SFCC
 *
 * @transactional
 * @param {Object} klarnaOrderObject Klarna order
 * @return  {dw.order.Order} order
 */
function createOrder(klarnaOrderObject) {
    var KLARNA_PAYMENT_METHOD = require('~/cartridge/scripts/util/klarnaConstants.js').PAYMENT_METHOD;
    var cart = KlarnaCartModel.goc();

    Transaction.wrap(function () {
        cart.restore(klarnaOrderObject);
    });

    var validationResult = HookMgr.callHook(
        'app.validate.basket',
        'validateBasket',
        cart.object,
        false
    );
    if (validationResult.error) {
        return;
    }

    var order;
    Transaction.begin();
    try {
        order = OrderMgr.createOrder(cart.object);

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

module.exports = {
    getLocaleObject: getLocaleObject,
    calculatePaymentTransactionTotals: calculatePaymentTransactionTotals,
    createOrder: createOrder
};
