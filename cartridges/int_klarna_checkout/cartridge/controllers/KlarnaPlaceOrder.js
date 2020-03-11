/* globals session:false */

'use strict';

/**
 * @module controllers/KlarnaPlaceOrder
*/


/* API Includes */
var Transaction = require('dw/system/Transaction');
var OrderMgr = require('dw/order/OrderMgr');
var CustomerMgr = require('dw/customer/CustomerMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var HookMgr = require('dw/system/HookMgr');
var Status = require('dw/system/Status');
var Order = require('dw/order/Order');

/* Script Modules */
var app = require('*/cartridge/scripts/app');
var KlarnaCartModel = require('*/cartridge/scripts/models/klarnaCartModel');
var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');
var KLARNA_PAYMENT_METHOD = require('*/cartridge/scripts//util/klarnaConstants.js').PAYMENT_METHOD;

/**
 * Set SFCC Order Customer
 *
 * @param  {dw.order.Order} order SFCC order
 * @param  {string} customerNo the customer number
 * @return {void}
 */
function setOrderCustomer(order, customerNo) {
    var orderCustomer = CustomerMgr.getCustomerByCustomerNumber(customerNo);

    if (orderCustomer !== null) {
        order.setCustomer(orderCustomer);

        var customerName;

        if (orderCustomer.profile.firstName) {
            customerName = orderCustomer.profile.firstName;
        }

        if (orderCustomer.profile.lastName) {
            if (customerName) {
                customerName += ' ' + orderCustomer.profile.lastName;
            } else {
                customerName = orderCustomer.profile.lastName;
            }
        }

        if (customerName) {
            order.setCustomerName(customerName);
        }
    }
}

/**
 * Compares totals in Klarna and SFCC orders
 *
 * @param {Object} klarnaOrderObject - Klarna order
 * @param  {dw.order.Basket} basket - SFCC basket
 * @return  {boolean} if both order totals are equal
 */
function areKlarnaAndSfccTotalsEqual(klarnaOrderObject, basket) {
    var klarnaOrderTotal = Math.round(klarnaOrderObject.order_amount);
    var sfccOrderAmount = Math.round(basket.getNonGiftCertificateAmount().value * 100);

    return sfccOrderAmount === klarnaOrderTotal;
}

/**
 * Creates the order in SFCC
 *
 * @transactional
 * @param {Object} klarnaOrderObject Klarna order
 * @param  {dw.object.CustomObject} localeObject Klara region specific options
 * @return  {dw.order.Order} order or null
 */
function createOrder(klarnaOrderObject, localeObject) {
    var cart = KlarnaCartModel.goc();

    Transaction.wrap(function () {
        cart.restore(klarnaOrderObject);
    });

    var validationResult = cart.validateForCheckout();
    if (!validationResult.EnableCheckout) {
        return null;
    }

    // We are handling the case when you hit the checkout with a promotion applied.
    // While at checkout, the promotion expires. However, Klarna has no way to know and
    // that's where the two orders' totals start to diverge. Thus we fail to create the order
    // and this will fail Klarna order validation upon order submit
    if (!areKlarnaAndSfccTotalsEqual(klarnaOrderObject, cart)) {
        return null;
    }

    Transaction.begin();

    var order = null;

    try {
        if (klarnaOrderObject.merchant_reference1) {
            order = OrderMgr.createOrder(cart.object, klarnaOrderObject.merchant_reference1);
        } else {
            order = OrderMgr.createOrder(cart.object);

            var regionOptions;
            if (!localeObject) {
                var utils = require('*/cartridge/scripts/util/klarnaHelper');
                regionOptions = utils.getLocaleObject();
            } else {
                regionOptions = localeObject;
            }

            var klarnaOrderService = new KlarnaOrderService();
            klarnaOrderService.updateOrderMerchantReferences(klarnaOrderObject.order_id, regionOptions, order.orderNo);
        }

        if (klarnaOrderObject.merchant_reference2) {
            setOrderCustomer(order, klarnaOrderObject.merchant_reference2);
        }

        order.setExternalOrderNo(klarnaOrderObject.order_id);
        order.setExternalOrderStatus(klarnaOrderObject.status);
        order.setExternalOrderText(KLARNA_PAYMENT_METHOD);
    } catch (e) {
        Transaction.rollback();
        return null;
    }

    Transaction.commit();

    return order;
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
 * @param  {Object} klarnaOrderObj the Klarna order
 * @param  {dw.object.CustomObject} localeObject Klara region specific options
 * @param  {boolean} isPendingOrder whether the SFCC is in Pending status
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

        for (var i = 0; i < paymentInstruments.length; i++) {
            var paymentInstrument = paymentInstruments[i];

            if (PaymentMgr.getPaymentMethod(paymentInstrument.getPaymentMethod()).getPaymentProcessor() === null) {
                Transaction.begin();
                paymentInstrument.getPaymentTransaction().setTransactionID(order.getOrderNo());
                Transaction.commit();
            } else {
                var authorizationResult = {};
                var processor = PaymentMgr.getPaymentMethod(paymentInstrument.getPaymentMethod()).getPaymentProcessor();
                if (processor.ID === 'KLARNA_CHECKOUT') {
                    kcoAuthorizationResult = authorizationResult = HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD, 'Authorize', {
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
                    authorizationResult = { not_supported: true };
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
 * The entry point for placing the order in SCC.
 *
 * @param {Object} context page context
 * @return {Object} JSON object that is empty, contains error information, or PlaceOrderError status information.
 */
function start(context) {
    var klarnaOrderObj = context.klarnaOrderObject;
    var localeObject = context.localeObject;
    var isPendingOrder = context.isPendingOrder;

    var order = OrderMgr.getOrder(klarnaOrderObj.merchant_reference1);

    if (!order) {
        order = createOrder(klarnaOrderObj, localeObject);
        if (!order) {
            return {
                error: true,
                PlaceOrderError: new Status(Status.ERROR, 'confirm.error.technical')
            };
        }
    }

    if (order.status.value !== Order.ORDER_STATUS_CREATED) {
        return {
            Order: order,
            order_created: true
        };
    }

    HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD, 'Handle',
        order
    );

    var handlePaymentsResult = handlePayments(order, klarnaOrderObj, localeObject, isPendingOrder);

    if (handlePaymentsResult.error) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
            session.privacy.klarnaOrderID = null;
            return {
                error: true,
                PlaceOrderError: new Status(Status.ERROR, 'confirm.error.technical')
            };
        });
    } else if (handlePaymentsResult.missingPaymentInfo) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
            session.privacy.klarnaOrderID = null;
            return {
                error: true,
                PlaceOrderError: new Status(Status.ERROR, 'confirm.error.technical')
            };
        });
    } else if (handlePaymentsResult.declined) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
            session.privacy.klarnaOrderID = null;
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

    var OrderModel = app.getModel('Order');
    var orderPlacementStatus = OrderModel.submit(order);

    return orderPlacementStatus;
}

/*
* Exposed methods.
*/
exports.Start = start;
exports.CreateOrder = createOrder;
