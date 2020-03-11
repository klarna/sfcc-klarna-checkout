/* globals request:false */

'use strict';

/**
 * @module util/KlarnaHelper
 */


var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var Money = require('dw/value/Money');
var Logger = require('dw/system/Logger');

/**
 * Get Klarna locale object
 * @param {string} country ISO 3166-1 country code
 * @return {dw.object.CustomObject} Klara region specific options
 */
exports.getLocaleObject = function (country) {
    var localeObject;
    var countryCode = country;

    if (!countryCode) {
        var Countries = require('*/cartridge/scripts/util/Countries');
        countryCode = Countries.getCurrent({ CurrentRequest: request }).countryCode;
    }

    try {
        localeObject = CustomObjectMgr.getCustomObject('KlarnaCountries', countryCode);
        if (!localeObject) {
            throw new Error('Klarna - No active locale custom object found');
        }
    } catch (e) {
        Logger.getLogger('Klarna').error(e);
        return null;
    }

    return localeObject;
};

/**
 * Calculates Payment Transaction Totals.
 *
 * @param {dw.order.Basket} basket The basket to calculate the payment transaction totals for
 * @return {boolean} true if successful, false otherwise
 */
exports.calculatePaymentTransactionTotals = function (basket) {
    var paymentInstruments = basket.getPaymentInstruments();
    var iter = paymentInstruments.iterator();
    var paymentInstrument = null;
    var nonGCPaymentInstrument = null;
    var giftCertTotal = new Money(0.0, basket.currencyCode);

    // locate any non-gift certificate payment instrument
    while (iter.hasNext()) {
        paymentInstrument = iter.next();
        if (PaymentInstrument.METHOD_GIFT_CERTIFICATE.equals(paymentInstrument.paymentMethod)) {
            giftCertTotal = giftCertTotal.add(paymentInstrument.getPaymentTransaction().getAmount());
            continue; // eslint-disable-line no-continue
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
        }
        return true;
    }

    // calculate the amount to be charged for the
    // non-gift certificate payment instrument
    var checkoutUtils = require('*/cartridge/scripts/checkout/Utils');
    var amount = checkoutUtils.calculateNonGiftCertificateAmount(basket);

    // now set the non-gift certificate payment instrument total.
    if (amount.value < 0.0) {
        return false;
    }

    nonGCPaymentInstrument.paymentTransaction.setAmount(amount);
    return true;
};

/**
 * Calculate order total value for a basket.
 *
 * @param {dw.order.Basket} basket the basket to calculate the order total value.
 * @return {dw.value.Money} total order value.
 */
exports.calculateOrderTotalValue = function (basket) {
    // calculate the amount to be charged for the
    // non-gift certificate payment instrument
    var checkoutUtils = require('*/cartridge/scripts/checkout/Utils');

    var orderTotalValue = null;

    if (basket.totalGrossPrice.available) {
        orderTotalValue = checkoutUtils.calculateNonGiftCertificateAmount(basket);
    } else {
        orderTotalValue = basket.getAdjustedMerchandizeTotalPrice(true).add(basket.giftCertificateTotalPrice);
    }

    return orderTotalValue;
};
