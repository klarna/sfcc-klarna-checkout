/* globals session:false, APIException:false */

'use strict';

/**
 * @module util/klarnaHelpers
 */

/* API Includes */
var ProductMgr = require('dw/catalog/ProductMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var ORDER_LINE_TYPE = require('*/cartridge/scripts/util/klarnaConstants').ORDER_LINE_TYPE;
var KLARNA_PAYMENT_METHOD = require('*/cartridge/scripts/util/klarnaConstants.js').PAYMENT_METHOD;
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Money = require('dw/value/Money');
var Logger = require('dw/system/Logger');
var Locale = require('dw/util/Locale');
var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');
var HookMgr = require('dw/system/HookMgr');
var OrderMgr = require('dw/order/OrderMgr');
var Order = require('dw/order/Order');
var AmountDiscount = require('dw/campaign/AmountDiscount');


/* Script Modules */
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var BasketCalculationHelpers = require('*/cartridge/scripts/helpers/basketCalculationHelpers');
var ShippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');
var KlarnaOrderService = require('*/cartridge/scripts/services/klarnaOrderService');

/**
 * Get Klarna locale object
 * @param {string} country ISO 3166-1 country code
 * @param {string} localeID current locale
 * @returns {dw.object.CustomObject} Klara region specific options
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
        Logger.getLogger('Klarna').error(e);
        return null;
    }

    return localeObject;
}

/**
 * Calculates the amount to be payed by a non-gift certificate payment instrument based
 * on the given basket. The method subtracts the amount of all redeemed gift certificates
 * from the order total and returns this value.
 *
 * @param {dw.order.LineItemCtnr} lineItemCtnr the lineItemCtnr
 * @returns {dw.value.Money} the non GiftCertificate amount
 */
function calculateNonGiftCertificateAmount(lineItemCtnr) {
    var giftCertTotal = new Money(0.0, lineItemCtnr.currencyCode);

    // get the list of all gift certificate payment instruments
    var gcPaymentInstrs = lineItemCtnr.getGiftCertificatePaymentInstruments();
    var iter = gcPaymentInstrs.iterator();
    var orderPI = null;

    // sum the total redemption amount
    while (iter.hasNext()) {
        orderPI = iter.next();
        giftCertTotal = giftCertTotal.add(orderPI.getPaymentTransaction().getAmount());
    }

    var orderTotal = lineItemCtnr.totalGrossPrice;

    // calculate the amount to charge for the payment instrument
    // this is the remaining open order total which has to be paid
    var amountOpen = orderTotal.subtract(giftCertTotal);

    return amountOpen;
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
    var amount = calculateNonGiftCertificateAmount(basket);

    // now set the non-gift certificate payment instrument total.
    if (amount.value < 0.0) {
        return false;
    }

    nonGCPaymentInstrument.paymentTransaction.setAmount(amount);

    return true;
}

/**
 * Restores GiftCertificate PaymentInstrument.
 *
 * @param {dw.order.Basket} basket the current basket
 * @param {dw.order.GiftCertificate} giftCertificate the gift certificate
 * @param {number} gcAmountValue the amount of the certificate
 * @return {dw.order.OrderPaymentInstrument} the order PaymentInstrument
 */
function restoreGiftCertificatePaymentInstrument(basket, giftCertificate, gcAmountValue) {
    var gcPaymentInstrs = basket.getGiftCertificatePaymentInstruments(giftCertificate.getGiftCertificateCode()).iterator();
    var existingPI = null;

    while (gcPaymentInstrs.hasNext()) {
        existingPI = gcPaymentInstrs.next();
        basket.removePaymentInstrument(existingPI);
    }

    var orderTotal = basket.getTotalGrossPrice();
    var amountToRedeem = new Money(gcAmountValue, basket.getCurrencyCode());
    var giftCertTotal = new Money(0.0, basket.getCurrencyCode());
    gcPaymentInstrs = basket.getGiftCertificatePaymentInstruments().iterator();
    var orderPI = null;

    while (gcPaymentInstrs.hasNext()) {
        orderPI = gcPaymentInstrs.next();
        giftCertTotal = giftCertTotal.add(orderPI.getPaymentTransaction().getAmount());
    }

    var orderBalance = orderTotal.subtract(giftCertTotal);

    if (orderBalance < amountToRedeem) {
        amountToRedeem = orderBalance;
    }

    return basket.createGiftCertificatePaymentInstrument(giftCertificate.getGiftCertificateCode(), amountToRedeem);
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @return {void}
 */
function clearBasket(basket) {
    basket.removeAllPaymentInstruments();

    var productLineItems = basket.getProductLineItems();
    for (var m = 0; m < productLineItems.length; m++) {
        var productLineItem = productLineItems[m];
        basket.removeProductLineItem(productLineItem);
    }

    var couponLineItems = basket.getCouponLineItems();
    for (var c = 0; c < couponLineItems.length; c++) {
        var couponLineItem = couponLineItems[c];
        basket.removeCouponLineItem(couponLineItem);
    }

    var shipments = basket.getShipments();
    for (var l = 0; l < shipments.length; l++) {
        var shipment = shipments[l];

        if (!shipment.isDefault()) {
            basket.removeShipment(shipment);
        }
    }

    var giftLineItems = basket.getGiftCertificateLineItems();
    for (var g = 0; g < giftLineItems.length; g++) {
        var giftLineItem = giftLineItems[g];
        basket.removeGiftCertificateLineItem(giftLineItem);
    }

    BasketCalculationHelpers.calculateTotals(basket);
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function setCurrency(basket, klarnaOrderObj) {
    if (klarnaOrderObj.purchase_currency) {
        var Currency = require('dw/util/Currency');

        var newCurrency = Currency.getCurrency(klarnaOrderObj.purchase_currency);
        session.setCurrency(newCurrency);
        basket.updateCurrency();
    } else {
        throw new Error('Could not set basket currency');
    }
}

/**
 * @param  {dw.catalog.Product} product the product
 * @param  {Array} klarnaOrderLines the line items from the Klarna order
 * @return {dw.catalog.ProductOptionModel} productOptionModel
 */
function setProductOptions(product, klarnaOrderLines) {
    var productID = product.ID;
    var productOptionModel = product.optionModel;
    var options = productOptionModel.getOptions().iterator();

    for (var i = 0; i < klarnaOrderLines.length; i++) {
        var orderLine = klarnaOrderLines[i];
        if (orderLine.type === ORDER_LINE_TYPE.SURCHARGE && productID === orderLine.reference.slice(0, productID.length)) {
            while (options.hasNext()) {
                var option = options.next();
                var selectedOptionID = productID + '_' + option.ID;
                if (selectedOptionID === orderLine.reference.slice(0, selectedOptionID.length)) {
                    var selectedOptionValueID = orderLine.reference.slice((selectedOptionID + '_').length);
                    var productOptionValue = productOptionModel.getOptionValue(option, selectedOptionValueID);
                    productOptionModel.setSelectedOptionValue(option, productOptionValue);
                    break;
                }
            }
        }
    }
    return productOptionModel;
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function restoreLineItems(basket, klarnaOrderObj) {
    var klarnaOrderLines = klarnaOrderObj.order_lines;
    var shipment = basket.getDefaultShipment();
    var product = null;
    var bonusProducts = [];

    if (klarnaOrderLines && klarnaOrderLines.length > 0) {
        for (var i = 0; i < klarnaOrderLines.length; i++) {
            var orderLine = klarnaOrderLines[i];
            var productOptionModel = null;

            if (orderLine.type === ORDER_LINE_TYPE.PHYSICAL) {
                product = ProductMgr.getProduct(orderLine.reference);

                if (!product) {
                    throw new Error('Failed to create productLineItem from Klarna order line');
                }

                if (product.optionProduct) {
                    productOptionModel = setProductOptions(product, klarnaOrderLines);
                }

                if (!orderLine.merchant_data || orderLine.merchant_data !== ORDER_LINE_TYPE.BONUS_PRODUCT) {
                    var createdProductLineItem = basket.createProductLineItem(product, productOptionModel, shipment);
                    createdProductLineItem.setQuantityValue(orderLine.quantity);

                    if (orderLine.merchant_data && orderLine.merchant_data !== ORDER_LINE_TYPE.BONUS_PRODUCT && createdProductLineItem) {
                        var discount = new AmountDiscount(product.priceModel.price.multiply(orderLine.quantity).getValueOrNull());
                        var promoID = 'DiscountBonusProductPriceAdjustment';
                        createdProductLineItem.createPriceAdjustment(promoID, discount);
                        var bonusProductObj = {};
                        bonusProductObj[orderLine.merchant_data] = createdProductLineItem;
                        bonusProducts.push(bonusProductObj);
                    }
                }
            }

            if (orderLine.type === ORDER_LINE_TYPE.SHIPPING_FEE && !klarnaOrderObj.selected_shipping_option) {
                ShippingHelper.selectShippingMethod(shipment, orderLine.reference);
            }

            if (orderLine.type === ORDER_LINE_TYPE.DISCOUNT && orderLine.merchant_data) {
                var merchantData = JSON.parse(orderLine.merchant_data);
                if (merchantData.couponCode) {
                    var campaignBased = true;
                    var couponCode = merchantData.couponCode;

                    try {
                        this.createCouponLineItem(couponCode, campaignBased);
                    } catch (e) {
                        if (e instanceof APIException && e.type === 'CreateCouponLineItemException') {
                            Logger.getLogger('Klarna').debug('CreateCouponLineItemException while restoring basket, error code: {0}', e.errorCode);
                        } else {
                            throw new Error(e.message);
                        }
                    }
                }
            }

            if (orderLine.type === ORDER_LINE_TYPE.GIFT_CARD && orderLine.merchant_data) {
                var amount = orderLine.unit_price / 100;
                var giftData = JSON.parse(orderLine.merchant_data);
                var gc = basket.createGiftCertificateLineItem(amount, giftData.recipientEmail);
                gc.setMessage(giftData.message);
                gc.setSenderName(giftData.senderName);
                gc.setRecipientName(giftData.recipientName);
            }
        }

        if (bonusProducts.length > 0) {
            var basketProducts = basket.getAllProductLineItems().iterator();
            while (basketProducts.hasNext()) {
                var pli = basketProducts.next();
                var key = pli.productID + '__' + pli.position.toFixed(0);
                for (var it = 0; it < bonusProducts.length; it++) {
                    var pliObj = bonusProducts[it];
                    if (pliObj[key]) {
                        pli.custom.bonusProductLineItemUUID = 'bonus';
                        pli.custom.preOrderUUID = pli.UUID;
                        var bonusDiscountItem = pliObj[key];
                        bonusDiscountItem.custom.bonusProductLineItemUUID = pli.UUID;
                    }
                }
            }
        }
    } else {
        throw new Error('No line items found in the Klarna order');
    }
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function restoreBasketGiftCards(basket, klarnaOrderObj) {
    var GiftCertificateMgr = require('dw/order/GiftCertificateMgr');
    var klarnaOrderLines = klarnaOrderObj.order_lines;

    for (var i = 0; i < klarnaOrderLines.length; i++) {
        var orderLine = klarnaOrderLines[i];

        if (orderLine.type === ORDER_LINE_TYPE.STORE_CREDIT) {
            var giftCode = orderLine.reference;
            var gcAmountValue = (orderLine.unit_price * (-1)) / 100;
            var gc = GiftCertificateMgr.getGiftCertificateByCode(giftCode);
            restoreGiftCertificatePaymentInstrument(basket, gc, gcAmountValue);
        }
    }
}

/**
 * @param  {dw.order.OrderAddress} orderAddress basket billing or shipping address
 * @param  {Object} klarnaAdress the address object from the Klarna order
 * @return {void}
 */
function setAddress(orderAddress, klarnaAdress) {
    if (klarnaAdress && klarnaAdress.country) {
        var address = orderAddress;
        address.address1 = klarnaAdress.street_address || '';
        address.address2 = klarnaAdress.street_address2 || '';
        address.city = klarnaAdress.city || '';
        address.countryCode = klarnaAdress.country || '';
        address.stateCode = klarnaAdress.region || '';
        address.postalCode = klarnaAdress.postal_code || '';
        address.firstName = klarnaAdress.given_name || '';
        address.lastName = klarnaAdress.family_name || '';
        address.phone = klarnaAdress.phone || '';
        address.salutation = klarnaAdress.title || '';
    } else {
        throw new Error('Not valid customer address');
    }
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function restoreBillingAddress(basket, klarnaOrderObj) {
    var billingAddress = basket.createBillingAddress();
    var klarnaBillingAddress = klarnaOrderObj.billing_address;

    setAddress(billingAddress, klarnaBillingAddress);
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function setEmail(basket, klarnaOrderObj) {
    var customerEmail = klarnaOrderObj.billing_address.email;

    if (customerEmail) {
        basket.setCustomerEmail(customerEmail);
    } else if (!klarnaOrderObj.selected_shipping_option) {
        // while we are on the checkout page, the customer may change the shipping option, before filling out the email input
        throw new Error('Empty customer email');
    }
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function restoreShipment(basket, klarnaOrderObj) {
    var shipment = basket.getDefaultShipment();
    var shippingAddress = shipment.createShippingAddress();
    var klarnaShippingAddress = klarnaOrderObj.shipping_address;

    setAddress(shippingAddress, klarnaShippingAddress);

    if (klarnaOrderObj.selected_shipping_option && klarnaOrderObj.selected_shipping_option.id) {
        ShippingHelper.selectShippingMethod(shipment, klarnaOrderObj.selected_shipping_option.id);
    }
}

/**
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function setSourceCode(klarnaOrderObj) {
    if (klarnaOrderObj.merchant_data) {
        var sourceCode = klarnaOrderObj.merchant_data;
        session.setSourceCode(sourceCode);
    }
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function restoreCustomerBasedPromotions(basket, klarnaOrderObj) {
    var klarnaOrderLines = klarnaOrderObj.order_lines;

    for (var i = 0; i < klarnaOrderLines.length; i++) {
        var orderLine = klarnaOrderLines[i];
        if (orderLine.type === ORDER_LINE_TYPE.DISCOUNT && orderLine.merchant_data) {
            var merchantData = JSON.parse(orderLine.merchant_data);
            if (merchantData.basedOnCustomerGroups) {
                var KLARNA_CUSTOMER_GROUPS_ADJUSTMENT = require('*/cartridge/scripts/util/klarnaConstants.js').KLARNA_CUSTOMER_GROUPS_ADJUSTMENT;
                var discountAmount = Math.abs(orderLine.unit_price / 100);
                var discount = new AmountDiscount(discountAmount);

                if (orderLine.reference.substring(0, KLARNA_CUSTOMER_GROUPS_ADJUSTMENT.length) === KLARNA_CUSTOMER_GROUPS_ADJUSTMENT) {
                    // order adjustment
                    var orderPromotionID = orderLine.reference.split(KLARNA_CUSTOMER_GROUPS_ADJUSTMENT + '_')[1];
                    if (!basket.getPriceAdjustmentByPromotionID(orderPromotionID)) {
                        basket.createPriceAdjustment(orderLine.reference, discount);
                    }
                } else {
                    // product adjustment
                    var pli = basket.getAllProductLineItems();
                    for (var pi = 0; pi < pli.length; pi++) {
                        var li = pli[pi];
                        var divider = li.productID + '_';
                        if (orderLine.reference.substring(0, divider.length) === divider) {
                            var adjustmetID = orderLine.reference.split(divider)[1];
                            var promotionID = adjustmetID.split(KLARNA_CUSTOMER_GROUPS_ADJUSTMENT + '_')[1];
                            if (!li.getPriceAdjustmentByPromotionID(promotionID)) {
                                li.createPriceAdjustment(adjustmetID, discount);
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * @param  {dw.order.Basket} basket the current basket
 * @param  {Object} klarnaOrderObj the Klarna order
 * @return {void}
 */
function restoreBasket(basket, klarnaOrderObj) {
    clearBasket(basket);
    setCurrency(basket, klarnaOrderObj);
    setSourceCode(klarnaOrderObj);
    restoreBillingAddress(basket, klarnaOrderObj);
    setEmail(basket, klarnaOrderObj);
    restoreLineItems(basket, klarnaOrderObj);
    restoreShipment(basket, klarnaOrderObj);
    BasketCalculationHelpers.calculateTotals(basket);
    restoreCustomerBasedPromotions(basket, klarnaOrderObj);

    if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
        restoreBasketGiftCards(basket, klarnaOrderObj);
    }

    HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD.toLowerCase(),
        'Handle',
        basket
    );

    BasketCalculationHelpers.calculateTotals(basket);
}

/**
 * Set SFCC Order Customer
 *
 * @param  {dw.order.Order} order SFCC order
 * @param  {string} customerNo the customer number
 * @return {void}
 */
function setOrderCustomer(order, customerNo) {
    var CustomerMgr = require('dw/customer/CustomerMgr');
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
    var sfccOrderAmount = Math.round(calculateNonGiftCertificateAmount(basket).value * 100);
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
    var hooksHelper = require('*/cartridge/scripts/helpers/hooks');

    var currentBasket = BasketMgr.getCurrentOrNewBasket();

    Transaction.wrap(function () {
        restoreBasket(currentBasket, klarnaOrderObject);
    });

    var validationResult = hooksHelper(
        'app.validate.basket',
        'validateBasket',
        currentBasket,
        false,
        require('*/cartridge/scripts/hooks/validateBasket').validateBasket
    );

    if (validationResult.error) {
        return null;
    }

    if (currentBasket.defaultShipment.shippingAddress === null) {
        return null;
    }

    if (!currentBasket.billingAddress) {
        return null;
    }

    // We are handling the case when you hit the checkout with a promotion applied.
    // While at checkout, the promotion expires. However, Klarna has no way to know and
    // that's where the two orders' totals start to diverge. Thus we fail to create the order
    // and this will fail Klarna order validation upon order submit
    if (!areKlarnaAndSfccTotalsEqual(klarnaOrderObject, currentBasket)) {
        return null;
    }

    Transaction.begin();

    var calculatedPaymentTransactionTotal = calculatePaymentTransactionTotals(currentBasket);
    if (calculatedPaymentTransactionTotal.error) {
        return null;
    }

    var order = null;

    try {
        if (klarnaOrderObject.merchant_reference1) {
            order = OrderMgr.createOrder(currentBasket, klarnaOrderObject.merchant_reference1);
        } else {
            order = OrderMgr.createOrder(currentBasket);

            var regionOptions;
            if (!localeObject) {
                regionOptions = getLocaleObject();
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
        Logger.getLogger('Klarna').error(e);
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
                if (processor.ID.toUpperCase() === KLARNA_PAYMENT_METHOD) {
                    kcoAuthorizationResult = authorizationResult = HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD.toLowerCase(), 'Authorize', {
                        Order: order,
                        PaymentInstrument: paymentInstrument,
                        KlarnaOrderObj: klarnaOrderObj,
                        LocaleObject: localeObject,
                        isPendingOrder: isPendingOrder
                    });
                } else if (HookMgr.hasHook('app.payment.processor.' + processor.ID.toLowerCase())) {
                    if (!isPendingOrder) {
                        authorizationResult = HookMgr.callHook('app.payment.processor.' + processor.ID.toLowerCase(), 'Authorize', {
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
 * Placing the order in SFCC.
 *
 * @param {Object} context the context object
 * @return {Object} JSON object that is empty, contains error information, or error status information.
 */
function placeOrder(context) {
    var klarnaOrderObj = context.klarnaOrderObject;
    var localeObject = context.localeObject;
    var isPendingOrder = context.isPendingOrder;
    var localeId = context.localeId;

    var order = OrderMgr.getOrder(klarnaOrderObj.merchant_reference1);

    if (!order) {
        order = createOrder(klarnaOrderObj, localeObject);
        if (!order) {
            var URLUtils = require('dw/web/URLUtils');

            return {
                error: true,
                errorKey: 'error.technical',
                redirectURL: URLUtils.https('Cart-Show')
            };
        }
    }

    if (order.status.value !== Order.ORDER_STATUS_CREATED) {
        return {
            Order: order,
            order_created: true
        };
    }

    HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD.toLowerCase(),
        'Handle',
        order
    );

    var handlePaymentsResult = handlePayments(order, klarnaOrderObj, localeObject, isPendingOrder);

    if (handlePaymentsResult.error) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
            session.privacy.klarnaOrderID = null;
            return {
                error: true,
                errorKey: 'error.technical'
            };
        });
    } else if (handlePaymentsResult.missingPaymentInfo) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
            session.privacy.klarnaOrderID = null;
            return {
                error: true,
                errorKey: 'error.technical'
            };
        });
    } else if (handlePaymentsResult.declined) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order, true);
            session.privacy.klarnaOrderID = null;
            return {
                error: true,
                errorKey: 'klarna.checkout.declined'
            };
        });
    } else if (handlePaymentsResult.pending) {
        return {
            order_created: true,
            order: order,
            confirmationSnippet: klarnaOrderObj.html_snippet
        };
    }

    // Places the order
    var placeOrderResult = COHelpers.placeOrder(order, { status: 'success' });
    if (placeOrderResult.error) {
        return {
            error: true,
            errorKey: 'error.technical'
        };
    }

    COHelpers.sendConfirmationEmail(order, localeId);

    return {
        order: order,
        order_created: true,
        confirmationSnippet: klarnaOrderObj.html_snippet
    };
}

/**
 * Handles fraud risk stopped orders.
 *
 * @param {string} orderNo the SFCC order number
 * @return {void}
 */
function handleStoppedOrders(orderNo) {
    var FRAUD_STATUS = require('*/cartridge/scripts/util/klarnaConstants').FRAUD_STATUS;
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

module.exports = {
    getLocaleObject: getLocaleObject,
    calculateNonGiftCertificateAmount: calculateNonGiftCertificateAmount,
    calculatePaymentTransactionTotals: calculatePaymentTransactionTotals,
    placeOrder: placeOrder,
    createOrder: createOrder,
    clearBasket: clearBasket,
    restoreBasket: restoreBasket,
    handleStoppedOrders: handleStoppedOrders
};
