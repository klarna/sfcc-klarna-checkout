'use strict';
/**
 * Model for cart functionality. Creates a CartModel class with payment, shipping, and product
 * helper methods.
 * @module models/CartModel
 */

/* API Includes */
var BasketMgr = require('dw/order/BasketMgr');
var ProductMgr = require('dw/catalog/ProductMgr');
var ShippingMgr = require('dw/order/ShippingMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var ArrayList = require('dw/util/ArrayList');

var ORDER_LINE_TYPE = require('~/cartridge/scripts/util/klarnaConstants').ORDER_LINE_TYPE;
var KLARNA_CHECKOUT = require('~/cartridge/scripts/hooks/payment/processor/klarna_checkout');
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var CartModel = require('*/cartridge/models/cart');


function setCurrency(basket, klarnaOrderObj) {
	if (klarnaOrderObj.purchase_currency) {
		var newCurrency = dw.util.Currency.getCurrency(klarnaOrderObj.purchase_currency);
		session.setCurrency(newCurrency);
        basket.updateCurrency();
	} else {
		throw new Error('Could not set basket currency');
	}
}

function restoreBillingAddress(basket, klarnaOrderObj) {
    var billingAddress = basket.createBillingAddress();
	var klarnaBillingAddress = klarnaOrderObj.billing_address;

	setAddress(billingAddress, klarnaBillingAddress);
}

function setAddress(orderAddress, klarnaAdress) {
	if (klarnaAdress && klarnaAdress.country) {
		orderAddress.address1 = klarnaAdress.street_address || '';
		orderAddress.address2 = klarnaAdress.street_address2 || '';
		orderAddress.city = klarnaAdress.city || '';
		orderAddress.countryCode = klarnaAdress.country || '';
		orderAddress.stateCode = klarnaAdress.region || '';
		orderAddress.postalCode = klarnaAdress.postal_code || '';
		orderAddress.firstName = klarnaAdress.given_name || '';
		orderAddress.lastName = klarnaAdress.family_name || '';
		orderAddress.phone = klarnaAdress.phone || '';
		orderAddress.salutation = klarnaAdress.title || '';
	} else {
		throw new Error('Not valid customer address');
	}
}

function setEmail(basket, klarnaOrderObj) {
	var customerEmail = klarnaOrderObj.billing_address.email;

	if (customerEmail) {
		basket.setCustomerEmail(customerEmail);
	} else {
		//while we are on the checkout page, the customer may change the shipping option, before filling out the email input
		if (!klarnaOrderObj.selected_shipping_option) { 
			throw new Error('Empty customer email');
		}
	}
}

function restoreLineItems(basket, klarnaOrderObj) {
    var klarnaOrderLines = klarnaOrderObj.order_lines;
    var shipment = basket.getDefaultShipment();
	var product = null;

	if (klarnaOrderLines && klarnaOrderLines.length > 0) {
		for (var i=0; i < klarnaOrderLines.length; i++) {
			var orderLine = klarnaOrderLines[i];
			var productOptionModel = null;

			if (orderLine.type === ORDER_LINE_TYPE.PHYSICAL) {
				product = ProductMgr.getProduct(orderLine.reference);

				if (!product) {
					throw new Error('Failed to create productLineItem form Klarna order line');
				}

				if (product.optionProduct) {
					productOptionModel = setProductOptions(product, klarnaOrderLines);
				}

				if (!orderLine.merchant_data || orderLine.merchant_data !== ORDER_LINE_TYPE.BONUS_PRODUCT) {
					basket.createProductLineItem(product, productOptionModel, shipment).setQuantityValue(orderLine.quantity);
				}
			}

			if (orderLine.type === ORDER_LINE_TYPE.SHIPPING_FEE && !klarnaOrderObj.selected_shipping_option) {
				this.updateShipmentShippingMethod(shipment.ID, orderLine.reference);
			}

			if (orderLine.type === ORDER_LINE_TYPE.DISCOUNT && orderLine.merchant_data) {
				var campaignBased = true;
				var couponCode = orderLine.merchant_data;
				basket.createCouponLineItem(couponCode, campaignBased);
			}

			if (orderLine.type === ORDER_LINE_TYPE.GIFT_CARD && orderLine.merchant_data) {
				var amount = orderLine.unit_price / 100;
				var giftData = JSON.parse(orderLine.merchant_data);
				var gc = basket.createGiftCertificateLineItem(amount, giftData.recipientEmail);
				gc.setMessage(giftData.message);
				gc.setSenderName(giftData.senderName);
				gc.setRecipientName(giftData.recipientName)
			}
		}
	} else {
		throw new Error('No line items found in the Klarna order');
	}
}

function restoreShipment(basket, klarnaOrderObj) {
	var shipment = basket.getDefaultShipment();
	var shippingAddress = shipment.createShippingAddress();
	var klarnaShippingAddress = klarnaOrderObj.shipping_address;

	setAddress(shippingAddress, klarnaShippingAddress);

	if (klarnaOrderObj.selected_shipping_option && klarnaOrderObj.selected_shipping_option.id) {
		this.updateShipmentShippingMethod(shipment.ID, klarnaOrderObj.selected_shipping_option.id);
	}
}

function restoreBasketGiftCards(basket, klarnaOrderObj) {
	var klarnaOrderLines = klarnaOrderObj.order_lines;

	for (var i=0; i < klarnaOrderLines.length; i++) {
		var orderLine = klarnaOrderLines[i];

		if (orderLine.type === ORDER_LINE_TYPE.STORE_CREDIT) {
			var giftCode = orderLine.reference;
			var gcAmountValue = (orderLine.unit_price * (-1)) / 100;
			var gc = dw.order.GiftCertificateMgr.getGiftCertificateByCode(giftCode);
			this.restoreGiftCertificatePaymentInstrument(gc, gcAmountValue);
		}
	}
}

function setProductOptions(product, klarnaOrderLines) {
	var productID = product.ID, 
		productOptionModel = product.optionModel,
		options = productOptionModel.getOptions().iterator();

	for (var i=0; i < klarnaOrderLines.length; i++) {
		var orderLine = klarnaOrderLines[i];
		if (orderLine.type === ORDER_LINE_TYPE.SURCHARGE && productID === orderLine.reference.slice(0, productID.length)) {
			while(options.hasNext())
			{
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
 * Cart helper providing enhanced cart functionality
 * @class module:models/CartModel~CartModel
 *
 * @param {dw.order.Basket} obj The basket object to enhance/wrap.
 */
function KlarnaCartModel(basket) {
	CartModel.call(this, basket);
    this.object = basket,

	this.restore = function (klarnaOrderObj) {
		this.clear();
		setCurrency(basket, klarnaOrderObj);
		restoreBillingAddress(basket, klarnaOrderObj);
		setEmail(basket, klarnaOrderObj);
		restoreLineItems(basket, klarnaOrderObj);
		restoreShipment(basket, klarnaOrderObj);

		if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
            COHelpers.recalculateBasket(basket);
			restoreBasketGiftCards(basket, klarnaOrderObj);
		}

		KLARNA_CHECKOUT.Handle({Basket: basket});
        COHelpers.recalculateBasket(basket);
    },

    this.clear = function () {
        basket.removeAllPaymentInstruments();

        var productLineItems = basket.getProductLineItems();
        var productLineItem;
        for (var m = 0; m < productLineItems.length; m++) {
            productLineItem = productLineItems[m];
            basket.removeProductLineItem(productLineItem);
        }

        var shipments = basket.getShipments();
        var shipment;
        for (var l = 0; l < shipments.length; l++) {
            shipment = shipments[l];
            
            if (!shipment.isDefault()) {
                basket.removeShipment(shipment);
            }
        }

        var giftLineItems = basket.getGiftCertificateLineItems();
        var giftLineItem;
        for (var g = 0; g < giftLineItems.length; g++) {
            giftLineItem = giftLineItems[g];
            basket.removeGiftCertificateLineItem(giftLineItem);
        }

        COHelpers.recalculateBasket(basket);
    },

    this.restoreGiftCertificatePaymentInstrument = function (giftCertificate, gcAmountValue) {
        // Removes any duplicates.
        // Iterates over the list of payment instruments to check.
        var gcPaymentInstrs = basket.getGiftCertificatePaymentInstruments(giftCertificate.getGiftCertificateCode()).iterator();
        var existingPI = null;

        // Removes found gift certificates, to prevent duplicates.
        while (gcPaymentInstrs.hasNext()) {
            existingPI = gcPaymentInstrs.next();
            basket.removePaymentInstrument(existingPI);
        }

        // Fetches the balance and the order total.
        var orderTotal = basket.getTotalGrossPrice();

        // Sets the amount to redeem.
        var amountToRedeem = new dw.value.Money(gcAmountValue, basket.getCurrencyCode());

        // Since there may be multiple gift certificates, adjusts the amount applied to the current
        // gift certificate based on the order total minus the aggregate amount of the current gift certificates.

        var giftCertTotal = new dw.value.Money(0.0, basket.getCurrencyCode());

        // Iterates over the list of gift certificate payment instruments
        // and updates the total redemption amount.
        gcPaymentInstrs = basket.getGiftCertificatePaymentInstruments().iterator();
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
        return basket.createGiftCertificatePaymentInstrument(giftCertificate.getGiftCertificateCode(), amountToRedeem);
    },

    this.createShipmentShippingAddress = function (shipmentID) {

        var shipment = basket.getShipment(shipmentID);
        var shippingAddress = shipment.getShippingAddress();

        // If the shipment has no shipping address yet, create one.
        if (shippingAddress === null) {
            shippingAddress = shipment.createShippingAddress();
        }

        return shippingAddress;

    },

    this.updateShipmentShippingMethod = function (shipmentID, shippingMethodID, shippingMethod, shippingMethods) {

        var shipment = basket.getShipment(shipmentID);

        if (!shippingMethods) {
            shippingMethods = ShippingMgr.getShipmentShippingModel(shipment).getApplicableShippingMethods();
        }

        // Tries to set the shipment shipping method to the passed one.
        for (var i = 0; i < shippingMethods.length; i++) {
            var method = shippingMethods[i];

            if (!shippingMethod) {
                if (!method.ID.equals(shippingMethodID)) {
                    continue;
                }
            } else {
                if (method !== shippingMethod) {
                    continue;
                }

            }

            // Sets this shipping method.
            shipment.setShippingMethod(method);
            return;
        }

        var defaultShippingMethod = ShippingMgr.getDefaultShippingMethod();
        if (shippingMethods.contains(defaultShippingMethod)) {
            // Sets the default shipping method if it is applicable.
            shipment.setShippingMethod(defaultShippingMethod);
        } else if (shippingMethods.length > 0) {
            // Sets the first shipping method in the applicable list.
            shipment.setShippingMethod(shippingMethods.iterator().next());
        } else {
            // Invalidates the current shipping method selection.
            shipment.setShippingMethod(null);
        }

        return;
    }
};

/**
 * Gets a new instance for the current or a given basket.
 *
 * @alias module:models/CartModel~CartModel/get
 * @param parameter {dw.order.Basket} The basket object to enhance/wrap. If NULL the basket is retrieved from
 * the current session, if existing.
 * @returns {module:models/CartModel~CartModel}
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
 * @alias module:models/CartModel~CartModel/goc
 * @returns {module:models/CartModel~CartModel}
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
