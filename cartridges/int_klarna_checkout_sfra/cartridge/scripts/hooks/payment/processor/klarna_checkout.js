'use strict';

/* API Includes */
var Transaction = require('dw/system/Transaction');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var PaymentMgr = require('dw/order/PaymentMgr');
var Logger = require('dw/system/Logger');
var Site = require('dw/system/Site');

var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');

/**
 * Handles Klarna Fraud Status
 *
 * @param  {string} klarnaFraudStatus the fraud status of the transaction
 * @param  {boolean} isPendingOrder whether the SFCC is in Pending status
 * @return {Object} fraud status result
 */
function handleFraudStatus(klarnaFraudStatus, isPendingOrder) {
    var FRAUD_STATUS = require('*/cartridge/scripts/util/klarnaConstants').FRAUD_STATUS;
    var orderFraudStatus = null;

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
 * @param  {dw.order.Order} order SFCC order
 * @param  {string} klarnaOrderID Klarna order ID
 * @param  {dw.object.CustomObject} localeObject Klara region specific options
 * @return {Object} creation result, if successful { success: true }, otherwise { error: true }
*/
function createVCNSettlement(order, klarnaOrderID, localeObject) {
    var klarnaOrderService = new KlarnaOrderService();

    var response = klarnaOrderService.createVCNSettlement(klarnaOrderID, localeObject);

    if (!response || !response.settlement_id) {
        return { error: true };
    }

    try {
        Transaction.wrap(function () {
            var orderObj = order;
            orderObj.custom.kcVCNBrand = response.cards[0].brand;
            orderObj.custom.kcVCNHolder = response.cards[0].holder;
            orderObj.custom.kcVCNCardID = response.cards[0].card_id;
            orderObj.custom.kcVCNPCIData = response.cards[0].pci_data;
            orderObj.custom.kcVCNIV = response.cards[0].iv;
            orderObj.custom.kcVCNAESKey = response.cards[0].aes_key;
            orderObj.custom.kcIsVCN = true;
        });
    } catch (e) {
        Logger.getLogger('Klarna').error(e);
        return { error: true };
    }

    return { success: true };
}

/**
 * Create the Klarna Checkout payment instrument.
 * @param  {dw.order.LineItemCtnr} lineItemCtnr SFCC basket or order
 * @returns {Object} the success object
 */
function Handle(lineItemCtnr) {
    var KlarnaHelpers = require('*/cartridge/scripts/util/klarnaHelpers');
    var KLARNA_PAYMENT_METHOD = require('*/cartridge/scripts/util/klarnaConstants.js').PAYMENT_METHOD;
    var paymentInstrs = [];
    var iter = {};
    var existingPI = {};
    var amount = 0;

    Transaction.wrap(function () {
        paymentInstrs = lineItemCtnr.getPaymentInstruments();
        iter = paymentInstrs.iterator();
        existingPI = null;

        // remove all PI except gift certificates
        while (iter.hasNext()) {
            existingPI = iter.next();
            if (!PaymentInstrument.METHOD_GIFT_CERTIFICATE.equals(existingPI.paymentMethod)) {
                lineItemCtnr.removePaymentInstrument(existingPI);
            }
        }

        amount = KlarnaHelpers.calculateNonGiftCertificateAmount(lineItemCtnr);
        lineItemCtnr.createPaymentInstrument(KLARNA_PAYMENT_METHOD, amount);
    });

    return {
        success: true
    };
}

/**
 * The payment is authorized by using the KLARNA_CHECKOUT processor.
 *
 * @param {Object} args arguments object
 * @returns {Object} object holding the authorization result
 */
function Authorize(args) {
    var order = args.Order;
    var klarnaOrderObj = args.KlarnaOrderObj;
    var klarnaOrderID = klarnaOrderObj.order_id || null;
    var localeObject = args.LocaleObject || null;
    var isPendingOrder = args.isPendingOrder || false;
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
            return { error: true };
        }
    }

    var fraudStatusResult = handleFraudStatus(klarnaOrderObj.fraud_status, isPendingOrder);
    if (!fraudStatusResult) {
        return { error: true };
    }

    Transaction.wrap(function () {
        paymentInstrument.paymentTransaction.custom.kcFraudStatus = fraudStatusResult.OrderFraudStatus;
    });

    if (fraudStatusResult.OrderApproved !== true) {
        if (fraudStatusResult.OrderInReview === true) {
            return { pending: true };
        }

        return { declined: true };
    }

    var Order = require('dw/order/Order');
    var PaymentTransaction = require('dw/order/PaymentTransaction');
    var paymentMode = Site.getCurrent().getCustomPreferenceValue('kcPaymentMode').value;
    var vcnEnabled = Site.getCurrent().getCustomPreferenceValue('kcVCNEnabled');

    if (paymentMode === 'DIRECT_CAPTURE' && order.paymentStatus.value === Order.PAYMENT_STATUS_NOTPAID && !vcnEnabled) {
        var amount = paymentInstrument.paymentTransaction.amount;
        var isSuccessful = klarnaOrderService.captureOrder(klarnaOrderID, localeObject, amount);
        if (isSuccessful) {
            Transaction.wrap(function () {
                paymentInstrument.paymentTransaction.type = PaymentTransaction.TYPE_CAPTURE;
                order.paymentStatus = Order.PAYMENT_STATUS_PAID;
            });
        } else {
            Logger.getLogger('Klarna').fatal('Could not capture order {0}, Klarna order ID: {1}', order.getOrderNo(), klarnaOrderID);
        }
    } else {
        Transaction.wrap(function () {
            paymentInstrument.paymentTransaction.type = PaymentTransaction.TYPE_AUTH;
        });
    }

    if (!vcnEnabled) {
        return { authorized: true };
    }

    // If VCN is enabled as a payment option create the virtual card and save it in order custom attributes.
    var result = createVCNSettlement(order, klarnaOrderID, localeObject);

    if (result.error) {
        return { error: true };
    }

    // Plug here your Credit Card Processor
    var HookMgr = require('dw/system/HookMgr');
    return HookMgr.callHook('app.payment.processor.basic_credit', 'Authorize',
        order.getOrderNo(),
        paymentInstrument,
        PaymentMgr.getPaymentMethod(paymentInstrument.getPaymentMethod()).getPaymentProcessor()
    );
}


/*
 * Module exports
 */
exports.Handle = Handle;
exports.Authorize = Authorize;
