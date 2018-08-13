'use strict';

/**
 * @module util/klarnaHelpers
 */

 /* API Includes */
var ProductMgr = require('dw/catalog/ProductMgr');
var PaymentMgr = require('dw/order/PaymentMgr');
var PaymentInstrument = require('dw/order/PaymentInstrument');
var ORDER_LINE_TYPE = require('~/cartridge/scripts/util/klarnaConstants').ORDER_LINE_TYPE;
var KLARNA_CHECKOUT = require('~/cartridge/scripts/hooks/payment/processor/klarna_checkout');
var KLARNA_PAYMENT_METHOD = require('~/cartridge/scripts/util/klarnaConstants.js').PAYMENT_METHOD;
var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Money = require('dw/value/Money');
var Logger = require('dw/system/Logger');
var Locale = require('dw/util/Locale');
var BasketMgr = require('dw/order/BasketMgr');
var Transaction = require('dw/system/Transaction');
var HookMgr = require('dw/system/HookMgr');
var OrderMgr = require('dw/order/OrderMgr');
var ShippingMgr = require('dw/order/ShippingMgr');

/* Script Modules */
var COHelpers = require('*/cartridge/scripts/checkout/checkoutHelpers');
var BasketCalculationHelpers = require('*/cartridge/scripts/helpers/basketCalculationHelpers');
var ShippingHelper = require('*/cartridge/scripts/checkout/shippingHelpers');
var KlarnaOrderService = require('~/cartridge/scripts/services/KlarnaOrderService');

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
        Logger.getLogger('Klarna').error(e);
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
    var amount = calculateNonGiftCertificateAmount(basket);

    // now set the non-gift certificate payment instrument total.
    if (amount.value < 0.0) {
        return false;
    }

    nonGCPaymentInstrument.paymentTransaction.setAmount(amount);

    return true;
}

/**
 * The entry point for placing the order in SCC.
 *
 * @return {Object} JSON object that is empty, contains error information, or PlaceOrderError status information.
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
			return {
				error: true,
				errorKey: 'error.technical'
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
                errorKey: 'error.technical' 
            };
        });

    } else if (handlePaymentsResult.missingPaymentInfo) {
        return Transaction.wrap(function () {
            OrderMgr.failOrder(order);
            session.custom.klarnaOrderID = null;
            return {
                error: true,
                errorKey: 'error.technical'
            };
        });

    } else if (handlePaymentsResult.declined) {
		return Transaction.wrap(function () {
			OrderMgr.failOrder(order);
			session.custom.klarnaOrderID = null;
			return {
				error: true,
				errorKey:'klarna.checkout.declined'
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
    var placeOrderResult = COHelpers.placeOrder(order, {status: 'success'});
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
                if (processor.ID.toUpperCase() === KLARNA_PAYMENT_METHOD) {
            		kcoAuthorizationResult = authorizationResult = KLARNA_CHECKOUT.Authorize({
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
 * @param {Object} klarnaOrderObject Klarna order
 * @return  {dw.order.Order} order
 */
function createOrder(klarnaOrderObject, localeObject) {
    var currentBasket = BasketMgr.getCurrentOrNewBasket();

    Transaction.wrap(function () {
        restoreBasket(currentBasket, klarnaOrderObject);
    });

    var validationResult = HookMgr.callHook(
        'app.validate.basket',
        'validateBasket',
        currentBasket,
        false
    );

    if (validationResult.error) {
        return;
    }

    if (currentBasket.defaultShipment.shippingAddress === null) {
        return;
    }

    if (!currentBasket.billingAddress) {
        return;
    }

    Transaction.begin();

    var calculatedPaymentTransactionTotal = calculatePaymentTransactionTotals(currentBasket);
    if (calculatedPaymentTransactionTotal.error) {
        return;
    }

    var order = null;

    try {
        if (klarnaOrderObject.merchant_reference1) {
            order = OrderMgr.createOrder(currentBasket, klarnaOrderObject.merchant_reference1);
        } else {
            order = OrderMgr.createOrder(currentBasket);

            if (!localeObject) {
    			localeObject = getLocaleObject();
            }

            var klarnaOrderService = new KlarnaOrderService();
            klarnaOrderService.updateOrderMerchantReferences(klarnaOrderObj.order_id, localeObject, order.orderNo);
        }

        if (klarnaOrderObject.merchant_reference2) {
            setOrderCustomer(order, klarnaOrderObject.merchant_reference2)
        }

        order.setExternalOrderNo(klarnaOrderObject.order_id);
        order.setExternalOrderStatus(klarnaOrderObject.status);
        order.setExternalOrderText(KLARNA_PAYMENT_METHOD);

    } catch (e) {
        Transaction.rollback();
        Logger.getLogger('Klarna').error(e);
        return;
    }
    Transaction.commit();

    return order;
}

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
                ShippingHelper.selectShippingMethod(shipment, orderLine.reference);
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
        ShippingHelper.selectShippingMethod(shipment, klarnaOrderObj.selected_shipping_option.id);
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
			restoreGiftCertificatePaymentInstrument(basket, gc, gcAmountValue);
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

function restoreBasket(basket, klarnaOrderObj) {
    clearBasket(basket);
    setCurrency(basket, klarnaOrderObj);
    restoreBillingAddress(basket, klarnaOrderObj);
    setEmail(basket, klarnaOrderObj);
    restoreLineItems(basket, klarnaOrderObj);
    restoreShipment(basket, klarnaOrderObj);

    if (PaymentMgr.getPaymentMethod(PaymentInstrument.METHOD_GIFT_CERTIFICATE).isActive()) {
        BasketCalculationHelpers.calculateTotals(basket);
        restoreBasketGiftCards(basket, klarnaOrderObj);
    }

    KLARNA_CHECKOUT.Handle({Basket: basket});
    BasketCalculationHelpers.calculateTotals(basket);
}

function clearBasket(basket) {
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

    BasketCalculationHelpers.calculateTotals(basket);
}

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
 * Set SFCC Order Customer
 *
 * @param  {dw.order.Order} order
 * @param  {String} customerNo
 * @return {void}
 */
function setOrderCustomer(order, customerNo) {
    var CustomerMgr = require('dw/customer/CustomerMgr');
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
 * Calculates the amount to be payed by a non-gift certificate payment instrument based 
 * on the given basket. The method subtracts the amount of all redeemed gift certificates 
 * from the order total and returns this value.
 * 
 * @param {dw.order.LineItemCtnr} lineItemCtnr
 * @returns {dw.value.Money} the non GiftCertificate amount
 */
function calculateNonGiftCertificateAmount(lineItemCtnr) {
	var giftCertTotal = new Money(0.0, lineItemCtnr.currencyCode);

	// get the list of all gift certificate payment instruments 
	var gcPaymentInstrs = lineItemCtnr.getGiftCertificatePaymentInstruments();
	var iter = gcPaymentInstrs.iterator();
	var orderPI = null;

	// sum the total redemption amount
	while( iter.hasNext() )
	{
		orderPI = iter.next();
		giftCertTotal = giftCertTotal.add( orderPI.getPaymentTransaction().getAmount() );
	}

	var orderTotal = lineItemCtnr.totalGrossPrice;

	// calculate the amount to charge for the payment instrument
	// this is the remaining open order total which has to be paid
	var amountOpen = orderTotal.subtract(giftCertTotal);

	return amountOpen;
}

module.exports = {
    getLocaleObject: getLocaleObject,
    calculateNonGiftCertificateAmount: calculateNonGiftCertificateAmount,
    calculatePaymentTransactionTotals: calculatePaymentTransactionTotals,
    placeOrder: placeOrder,
    createOrder: createOrder,
    clearBasket: clearBasket,
    restoreBasket: restoreBasket
};
