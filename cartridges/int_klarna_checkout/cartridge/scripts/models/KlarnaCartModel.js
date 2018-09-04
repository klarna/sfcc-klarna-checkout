/* globals session:false, APIException:false */

'use strict';

/**
 * @module models/KlarnaCartModel
 */

var STOREFRONT_CARTRIDGE = require('int_klarna_checkout/cartridge/scripts/util/KlarnaConstants.js').STOREFRONT_CARTRIDGE;

/* API Includes */
var BasketMgr = require('dw/order/BasketMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var HookMgr = require('dw/system/HookMgr');
var Currency = require('dw/util/Currency');

var ORDER_LINE_TYPE = require('~/cartridge/scripts/util/KlarnaConstants.js').ORDER_LINE_TYPE;
var KLARNA_PAYMENT_METHOD = require('~/cartridge/scripts/util/KlarnaConstants.js').PAYMENT_METHOD;
var CartModel = require(STOREFRONT_CARTRIDGE.CONTROLLERS + '/cartridge/scripts/models/CartModel');

/**
 * Cart helper providing enhanced cart functionality
 * @class module:models/CartModel~CartModel
 * @extends module:models/AbstractModel
 *
 * @param {dw.order.Basket} obj The basket object to enhance/wrap.
 */
var KlarnaCartModel = CartModel.extend({

    restore: function (klarnaOrderObj) {
        this.clear();
        this.setCurrency(klarnaOrderObj);
        this.restoreBillingAddress(klarnaOrderObj);
        this.setEmail(klarnaOrderObj);
        this.restoreLineItems(klarnaOrderObj);
        this.restoreShipment(klarnaOrderObj);

        if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            this.calculate();
            this.restoreBasketGiftCards(klarnaOrderObj);
        }

        HookMgr.callHook('app.payment.processor.' + KLARNA_PAYMENT_METHOD, 'Handle',
            this.object
        );
        this.calculate();
    },

    clear: function () {
        this.removeAllPaymentInstruments();

        var productLineItems = this.getProductLineItems();
        for (var m = 0; m < productLineItems.length; m++) {
            var productLineItem = productLineItems[m];
            this.removeProductLineItem(productLineItem);
        }

        var couponLineItems = this.getCouponLineItems();
        for (var c = 0; c < couponLineItems.length; c++) {
            var couponLineItem = couponLineItems[c];
            this.removeCouponLineItem(couponLineItem);
        }

        var shipments = this.getShipments();
        for (var l = 0; l < shipments.length; l++) {
            var shipment = shipments[l];

            if (!shipment.isDefault()) {
                this.removeShipment(shipment);
            }
        }

        var giftLineItems = this.getGiftCertificateLineItems();
        for (var g = 0; g < giftLineItems.length; g++) {
            var giftLineItem = giftLineItems[g];
            this.removeGiftCertificateLineItem(giftLineItem);
        }

        this.calculate();
    },

    setCurrency: function (klarnaOrderObj) {
        if (klarnaOrderObj.purchase_currency) {
            var newCurrency = Currency.getCurrency(klarnaOrderObj.purchase_currency);
            session.setCurrency(newCurrency);
            this.updateCurrency();
        } else {
            throw new Error('Could not set basket currency');
        }
    },

    restoreBillingAddress: function (klarnaOrderObj) {
        var billingAddress = this.createBillingAddress();
        var klarnaBillingAddress = klarnaOrderObj.billing_address;

        this.setAddress(billingAddress, klarnaBillingAddress);
    },

    setEmail: function (klarnaOrderObj) {
        var customerEmail = klarnaOrderObj.billing_address.email;

        if (customerEmail) {
            this.setCustomerEmail(customerEmail);
        } else if (!klarnaOrderObj.selected_shipping_option) {
            // while we are on the checkout page, the customer may change the shipping option, before filling out the email input
            throw new Error('Empty customer email');
        }
    },

    restoreLineItems: function (klarnaOrderObj) {
        var klarnaOrderLines = klarnaOrderObj.order_lines;
        var shipment = this.getDefaultShipment();
        var product = null;

        if (klarnaOrderLines && klarnaOrderLines.length > 0) {
            for (var i = 0; i < klarnaOrderLines.length; i++) {
                var orderLine = klarnaOrderLines[i];
                var productOptionModel = null;

                if (orderLine.type === ORDER_LINE_TYPE.PHYSICAL) {
                    product = ProductMgr.getProduct(orderLine.reference);

                    if (!product) {
                        throw new Error('Failed to create productLineItem form Klarna order line');
                    }

                    if (product.optionProduct) {
                        productOptionModel = this.setProductOptions(product, klarnaOrderLines);
                    }

                    if (!orderLine.merchant_data || orderLine.merchant_data !== ORDER_LINE_TYPE.BONUS_PRODUCT) {
                        this.createProductLineItem(product, productOptionModel, shipment).setQuantityValue(orderLine.quantity);
                    }
                }

                if (orderLine.type === ORDER_LINE_TYPE.SHIPPING_FEE && !klarnaOrderObj.selected_shipping_option) {
                    this.updateShipmentShippingMethod(shipment.ID, orderLine.reference);
                }

                if (orderLine.type === ORDER_LINE_TYPE.DISCOUNT && orderLine.merchant_data) {
                    var campaignBased = true;
                    var couponCode = orderLine.merchant_data;

                    try {
                        this.createCouponLineItem(couponCode, campaignBased);
                    } catch (e) {
                        if (e instanceof APIException && e.type === 'CreateCouponLineItemException') {
                            var Logger = require('dw/system/Logger');
                            Logger.getLogger('Klarna').debug('CreateCouponLineItemException while restoring basket, error code: {0}', e.errorCode);
                        } else {
                            throw new Error(e.message);
                        }
                    }
                }

                if (orderLine.type === ORDER_LINE_TYPE.GIFT_CARD && orderLine.merchant_data) {
                    var amount = orderLine.unit_price / 100;
                    var giftData = JSON.parse(orderLine.merchant_data);
                    var gc = this.createGiftCertificateLineItem(amount, giftData.recipientEmail);
                    gc.setMessage(giftData.message);
                    gc.setSenderName(giftData.senderName);
                    gc.setRecipientName(giftData.recipientName);
                }
            }
        } else {
            throw new Error('No line items found in the Klarna order');
        }
    },

    restoreShipment: function (klarnaOrderObj) {
        var shipment = this.getDefaultShipment();
        var shippingAddress = shipment.createShippingAddress();
        var klarnaShippingAddress = klarnaOrderObj.shipping_address;

        this.setAddress(shippingAddress, klarnaShippingAddress);

        if (klarnaOrderObj.selected_shipping_option && klarnaOrderObj.selected_shipping_option.id) {
            this.updateShipmentShippingMethod(shipment.ID, klarnaOrderObj.selected_shipping_option.id);
        }
    },

    restoreBasketGiftCards: function (klarnaOrderObj) {
        var GiftCertificateMgr = require('dw/order/GiftCertificateMgr');
        var klarnaOrderLines = klarnaOrderObj.order_lines;

        for (var i = 0; i < klarnaOrderLines.length; i++) {
            var orderLine = klarnaOrderLines[i];

            if (orderLine.type === ORDER_LINE_TYPE.STORE_CREDIT) {
                var giftCode = orderLine.reference;
                var gcAmountValue = (orderLine.unit_price * (-1)) / 100;
                var gc = GiftCertificateMgr.getGiftCertificateByCode(giftCode);
                this.restoreGiftCertificatePaymentInstrument(gc, gcAmountValue);
            }
        }
    },

    setAddress: function (orderAddress, klarnaAdress) {
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
    },

    setProductOptions: function (product, klarnaOrderLines) {
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
    },

    restoreGiftCertificatePaymentInstrument: function (giftCertificate, gcAmountValue) {
        var Money = require('dw/value/Money');

        // Removes any duplicates.
        // Iterates over the list of payment instruments to check.
        var gcPaymentInstrs = this.getGiftCertificatePaymentInstruments(giftCertificate.getGiftCertificateCode()).iterator();
        var existingPI = null;

        // Removes found gift certificates, to prevent duplicates.
        while (gcPaymentInstrs.hasNext()) {
            existingPI = gcPaymentInstrs.next();
            this.removePaymentInstrument(existingPI);
        }

        // Fetches the balance and the order total.
        var orderTotal = this.getTotalGrossPrice();

        // Sets the amount to redeem.
        var amountToRedeem = new Money(gcAmountValue, this.getCurrencyCode());

        // Since there may be multiple gift certificates, adjusts the amount applied to the current
        // gift certificate based on the order total minus the aggregate amount of the current gift certificates.

        var giftCertTotal = new Money(0.0, this.getCurrencyCode());

        // Iterates over the list of gift certificate payment instruments
        // and updates the total redemption amount.
        gcPaymentInstrs = this.getGiftCertificatePaymentInstruments().iterator();
        var orderPI = null;

        while (gcPaymentInstrs.hasNext()) {
            orderPI = gcPaymentInstrs.next();
            giftCertTotal = giftCertTotal.add(orderPI.getPaymentTransaction().getAmount());
        }

        // Calculates the remaining order balance.
        // This is the remaining open order total that must be paid.
        var orderBalance = orderTotal.subtract(giftCertTotal);

        // The redemption amount exceeds the order balance.
        // use the order balance as maximum redemption amount.
        if (orderBalance < amountToRedeem) {
            // Sets the amount to redeem equal to the order balance.
            amountToRedeem = orderBalance;
        }

        // Creates a payment instrument from this gift certificate.
        return this.object.createGiftCertificatePaymentInstrument(giftCertificate.getGiftCertificateCode(), amountToRedeem);
    }
});

/**
 * Gets a new instance for the current or a given basket.
 *
 * @alias module:models/KlarnaCartModel~KlarnaCartModel/get
 * @param {dw.order.Basket=} parameter The basket object to enhance/wrap. If NULL the basket is retrieved from
 * the current session, if existing.
 * @returns {module:models/KlarnaCartModel~KlarnaCartModel} KlarnaCartModel
 */
KlarnaCartModel.get = function (parameter) {
    var basket = null;

    if (!parameter) {
        var currentBasket = BasketMgr.getCurrentBasket();

        if (currentBasket !== null) {
            basket = currentBasket;
        }
    } else if (typeof parameter === 'object') {
        basket = parameter;
    }
    return (basket !== null) ? new KlarnaCartModel(basket) : null;
};

/**
 * Gets or creates a new instance of a basket.
 *
 * @alias module:models/KlarnaCartModel~KlarnaCartModel/goc
 * @returns {module:models/KlarnaCartModel~KlarnaCartModel} KlarnaCartModel
 */
KlarnaCartModel.goc = function () {
    var obj = null;

    var basket = BasketMgr.getCurrentOrNewBasket();

    if (basket && basket !== null) {
        obj = basket;
    }

    return new KlarnaCartModel(obj);
};


/** The cart class */
module.exports = KlarnaCartModel;
