/* global empty, dw */

(function () {
    'use strict';

    var builder = require('../util/builder');
    var ORDER_LINE_TYPE = require('../util/klarnaConstants.js').ORDER_LINE_TYPE;
    var CONTENT_TYPE = require('../util/klarnaConstants.js').CONTENT_TYPE;
    var KlarnaOrderModel = require('./klarnaOrderModel').KlarnaOrderModel;
    var LineItem = require('./klarnaOrderModel').LineItem;
    var ShippingOption = require('./klarnaOrderModel').ShippingOption;
    var ShippingMgr = require('dw/order/ShippingMgr');
    var Transaction = require('dw/system/Transaction');
    var URLUtils = require('dw/web/URLUtils');
    var Site = require('dw/system/Site');
    var HookMgr = require('dw/system/HookMgr');
    var ArrayList = require('dw/util/ArrayList');
    var OrderMgr = require('dw/order/OrderMgr');

    function KlarnaOrderRequestBuilder() {
        this.context = null;
    }

    KlarnaOrderRequestBuilder.prototype = new builder();
    KlarnaOrderRequestBuilder.prototype.get = function () {
        return this.context;
    };

    /*
        Build request here
    */
    KlarnaOrderRequestBuilder.prototype.buildRequest = function (params) {
        try {
            handleRequired(params);
        } catch (e) {
            throw new Error(e);
        }

        var basket = params.basket;
        var localeObject = params.localeObject.custom;

        var requestBodyObject = this.init()
            .buildCustomerReference(basket)
            .buildOrderReferences()
        	.buildLocale(basket, localeObject)
            .buildBilling(basket, localeObject)
            .buildOptions(localeObject)
            .buildGui()
            .buildExternalPaymentProviders()
            .buildOrderLines(basket, localeObject)
            .buildGiftPayments(basket)
            .buildTotalAmount(basket, localeObject)
            .buildTotalTax(basket, localeObject)
            .buildAdditionalCustomerInfo(basket)
            .buildMerchantInformation(basket, localeObject);

        if (localeObject.showShippingOptions === true) {
    		this.buildShippingMethods(basket);
        }

        if (Site.getCurrent().getCustomPreferenceValue('kcAllowSeparateShippingAddress') && localeObject.showShippingCountries === true) {
        	this.buildShippingCountries(localeObject);
        }

        return requestBodyObject;
    };

    KlarnaOrderRequestBuilder.prototype.init = function () {
        this.context = new KlarnaOrderModel();
        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildOrderReferences = function () {
    	this.context.merchant_reference1 = OrderMgr.createOrderSequenceNo();

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildCustomerReference = function (basket) {
    	var currentCustomer = basket.getCustomer();

    	if (empty(currentCustomer) || empty(currentCustomer.profile)) {
    		this.context.merchant_reference2 = '';
    } else {
        	this.context.merchant_reference2 = currentCustomer.profile.customerNo;
    }

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildBilling = function (basket, localeObject) {
    	var currentCustomer = basket.getCustomer();
    	var prefillCheckoutFields = Site.getCurrent().getCustomPreferenceValue('kcPrefillCheckoutFields');
    	var country = localeObject.country;

    	this.context.billing_address.email = basket.customerEmail || '';

    	if (!prefillCheckoutFields || empty(currentCustomer) || empty(currentCustomer.profile)) {
    		return this;
    }

    	this.context.billing_address.email = currentCustomer.profile.email;
        this.context.billing_address.phone = currentCustomer.profile.phoneMobile;
        this.context.billing_address.given_name = currentCustomer.profile.firstName;
        this.context.billing_address.family_name = currentCustomer.profile.lastName;

        var customerPreferredAddress = currentCustomer.addressBook.preferredAddress;
    	if (!empty(customerPreferredAddress) && customerPreferredAddress.countryCode.value.toUpperCase() === country) {
    		buildAddress.bind(this)(customerPreferredAddress);
    }

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildLocale = function (basket, localeObject) {
        var currency = basket.getCurrencyCode();

        this.context.purchase_country = localeObject.country;
        this.context.purchase_currency = currency;
        this.context.locale = localeObject.klarnaLocale;

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildOrderLines = function (basket, localeObject) {
        var lineItems = basket.getAllProductLineItems().toArray();
        var giftLineItems = basket.getGiftCertificateLineItems().toArray();
        var shipments = basket.shipments;
        var country = localeObject.country;

        buildItems(lineItems, country, this.context);
        buildGiftItems(giftLineItems, country, this.context);
    	buildShipments(shipments, country, this.context);

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildMerchantInformation = function (basket, localeObject) {
    	var country = localeObject.country;

    	this.context.merchant_urls.terms = Site.getCurrent().getCustomPreferenceValue('kcTermsAndConditionsUrl');
    	this.context.merchant_urls.checkout = URLUtils.https('Checkout-Begin').toString();
    	this.context.merchant_urls.confirmation = URLUtils.https('Order-Confirm', 'klarna_country', country, 'klarna_order_id', '{checkout.order.id}').toString();
    	this.context.merchant_urls.push = URLUtils.https('KlarnaCheckoutServices-Push', 'klarna_country', country, 'klarna_order_id', '{checkout.order.id}').toString();
    	this.context.merchant_urls.validation = URLUtils.https('KlarnaCheckoutServices-Validation').toString();
        this.context.merchant_urls.shipping_option_update = URLUtils.https('KlarnaCheckoutServices-Update').toString();
    	this.context.merchant_urls.address_update = URLUtils.https('KlarnaCheckoutServices-Update').toString();
    	this.context.merchant_urls.notification = URLUtils.https('KlarnaCheckoutServices-Notification', 'klarna_country', country).toString();

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildOptions = function (localeObject) {
    	var country = localeObject.country;
    	var additionalCheckbox = Site.getCurrent().getCustomPreferenceValue('kcAdditionalCheckbox');

    	if (!empty(additionalCheckbox)) {
    		this.context.options.additional_checkbox = JSON.parse(additionalCheckbox);
    	}

    	if (country !== 'US') {
    		this.context.options.date_of_birth_mandatory = Site.getCurrent().getCustomPreferenceValue('kcDateOfBirthMandatory');
    	}

    	if (country === 'GB') {
    		this.context.options.title_mandatory = Site.getCurrent().getCustomPreferenceValue('kcTitleMandatory');
    	}

        this.context.options.shipping_details = Site.getCurrent().getCustomPreferenceValue('kcShippingDetails');
        this.context.options.show_subtotal_detail = Site.getCurrent().getCustomPreferenceValue('kcShowSubtotalDetail');
        this.context.options.allow_separate_shipping_address = Site.getCurrent().getCustomPreferenceValue('kcAllowSeparateShippingAddress');
        this.context.options.require_validate_callback_success = Site.getCurrent().getCustomPreferenceValue('kcRequireValidateCallbackSuccess');
        this.context.options.radius_border = Site.getCurrent().getCustomPreferenceValue('kcRadiusBorder');
        this.context.options.color_button = Site.getCurrent().getCustomPreferenceValue('kcColorButton');
        this.context.options.color_button_text = Site.getCurrent().getCustomPreferenceValue('kcColorButtonText');
        this.context.options.color_checkbox = Site.getCurrent().getCustomPreferenceValue('kcColorCheckbox');
        this.context.options.color_checkbox_checkmark = Site.getCurrent().getCustomPreferenceValue('kcColorCheckboxCheckmark');
        this.context.options.color_header = Site.getCurrent().getCustomPreferenceValue('kcColorHeader');
        this.context.options.color_link = Site.getCurrent().getCustomPreferenceValue('kcColorLink');

    	return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildGui = function () {
    	if (Site.getCurrent().getCustomPreferenceValue('kcGuiDisable_autofocus')) {
    		this.context.gui.options.push('disable_autofocus');
    	}

    	if (Site.getCurrent().getCustomPreferenceValue('kcGuiMinimal_confirmation')) {
    		this.context.gui.options.push('minimal_confirmation');
    	}

    	return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildGiftPayments = function (basket) {
    	var gcPIIter = basket.getGiftCertificatePaymentInstruments().iterator();

        while (gcPIIter.hasNext()) {
        	var gcPaymentInstrument = gcPIIter.next();

        	var adjustment = new LineItem();
            adjusmentPrice = gcPaymentInstrument.getPaymentTransaction().amount.value * -100;

            adjustment.quantity = 1;
            adjustment.type = ORDER_LINE_TYPE.STORE_CREDIT;
            adjustment.name = 'Gift Certificate';
            adjustment.reference = gcPaymentInstrument.getGiftCertificateCode();
            adjustment.unit_price = Math.round(adjusmentPrice);
            adjustment.tax_rate = 0;
            adjustment.total_amount = adjustment.unit_price;
            adjustment.total_tax_amount = 0;

            this.context.order_lines.push(adjustment);
        }

    	return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildTotalAmount = function (basket, localeObject) {
        var KlarnaHelpers = require('~/cartridge/scripts/util/klarnaHelpers');
        var country = localeObject.country;

        var orderAmount = KlarnaHelpers.calculateNonGiftCertificateAmount(basket).value*100;

    	this.context.order_amount = Math.round(orderAmount);

    	// Set order discount line items
        addPriceAdjustments(basket.priceAdjustments, null, null, country, this.context);

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildTotalTax = function (basket, localeObject) {
    	var country = localeObject.country;
        var totalTax = basket.totalTax.value * 100;

        this.context.order_tax_amount = Math.round(totalTax);

        if (country === 'US') {
            var usTotalTax = (basket.totalTax.available) ? basket.totalTax.value * 100 : 0;
        	var salesTaxItem = new LineItem();
        	salesTaxItem.quantity = 1;
        	salesTaxItem.type = ORDER_LINE_TYPE.SALES_TAX;
        	salesTaxItem.name = 'Sales Tax';
        	salesTaxItem.reference = 'Sales Tax';
        	salesTaxItem.unit_price = usTotalTax;
        	salesTaxItem.tax_rate = 0;
        	salesTaxItem.total_amount = usTotalTax;
        	salesTaxItem.total_tax_amount = 0;

        	this.context.order_lines.push(salesTaxItem);
        }

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildAdditionalCustomerInfo = function (basket) {
        if (Site.getCurrent().getCustomPreferenceValue('kcAttachments') && HookMgr.hasHook('extra.merchant.data')) {
            this.context.attachment = new Object();
            this.context.attachment.content_type = CONTENT_TYPE;
            this.context.attachment.body = 	HookMgr.callHook('extra.merchant.data', 'BuildEMD', {
	            LineItemCtnr: basket
	        });
        }

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildShippingMethods = function (basket) {
        var shippingHelpers = require('*/cartridge/scripts/checkout/shippingHelpers');
    	var shipment = basket.defaultShipment;
        var applicableShippingMethods = shippingHelpers.getApplicableShippingMethods(shipment);

        if (!empty(applicableShippingMethods) && applicableShippingMethods.length > 0) {
        	var currentShippingMethod = basket.getDefaultShipment().getShippingMethod() || ShippingMgr.getDefaultShippingMethod();

            // Transaction controls are for fine tuning the performance of the data base interactions when calculating shipping methods
            Transaction.begin();
        	for (var i = 0; i < applicableShippingMethods.length; i++) {
        		var shippingMethod = applicableShippingMethods[i];

        		if (shippingMethod.custom.storePickupEnabled) {
        			continue;
        		}

        		shipment.setShippingMethod(shippingMethod);
        		calculateBasket(basket);
        		var shippingMethodPrice = (basket.adjustedShippingTotalPrice.value) * 100;

        		var shippingOption = new ShippingOption();
        		shippingOption.id = shippingMethod.ID;
        		shippingOption.name = shippingMethod.displayName.replace(/[^\x00-\x7F]/g, '');
        		shippingOption.description = shippingMethod.description;
        		shippingOption.price = Math.round(shippingMethodPrice);
        		shippingOption.tax_rate = 0;
        		shippingOption.preselected = (shippingMethod.ID === currentShippingMethod.ID);

    			this.context.shipping_options.push(shippingOption);
        	}

        	Transaction.rollback();

        	Transaction.wrap(function () {
    	    	shipment.setShippingMethod(currentShippingMethod);
    	    	calculateBasket(basket);
    	    });
        }

        return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildShippingCountries = function (localeObject) {
    	var countryCode = '';
    	var shippingCountries = localeObject.shippingCountries;

    	if (!empty(shippingCountries) && shippingCountries.length > 0) {
	    	for (var i = 0; i < shippingCountries.length; i++) {
	    		countryCode = shippingCountries[i].value;
	    		this.context.shipping_countries.push(countryCode);
	    	}
    	}

    	return this;
    };

    KlarnaOrderRequestBuilder.prototype.buildExternalPaymentProviders = function () {
    	var externalPaymentMethods = Site.getCurrent().getCustomPreferenceValue('kcExternalPaymentMethods');
    	var externalCheckouts = Site.getCurrent().getCustomPreferenceValue('kcExternalCheckouts');

    	if (!empty(externalPaymentMethods)) {
    		this.context.external_payment_methods = JSON.parse(externalPaymentMethods);
    	}

    	if (!empty(externalCheckouts)) {
    		this.context.external_checkouts = JSON.parse(externalCheckouts);
    	}

    	return this;
    };

    function buildItems(items, country, context) {
    	var brand, 
categoryPath;
    	var itemPrice = 0,
    		itemID = '',
    		itemType = '';

    	for (var i = 0; i < items.length; i++) {
    		var li = items[i];

    		if (li.bundledProductLineItem) {
    			continue;
    }

        if (li.optionProductLineItem) {
            	itemType = ORDER_LINE_TYPE.SURCHARGE;
            	itemID = li.parent.productID + '_' + li.optionID + '_' + li.optionValueID;
            	brand = !empty(li.parent.product) ? li.parent.product.brand : null;
            categoryPath = !empty(li.parent.product) ? _getProductCategoryPath(li.parent.product) : null;
        } else {
            	itemType = ORDER_LINE_TYPE.PHYSICAL;
            	itemID = li.productID;
            	brand = !empty(li.product) ? li.product.brand : null;
            categoryPath = !empty(li.product) ? _getProductCategoryPath(li.product) : null;
        }

        itemPrice = (li.grossPrice.available && country != 'US' ? li.grossPrice.value : li.netPrice.value) * 100;

        var item = new LineItem();
        item.quantity = li.quantityValue;
        item.type = itemType;
        item.name = li.productName.replace(/[^\x00-\x7F]/g, '');
        item.reference = itemID;
        item.unit_price = Math.round(itemPrice / li.quantityValue);
        item.tax_rate = (country === 'US') ? 0 : Math.round(li.taxRate * 10000);
        item.total_amount = Math.round(itemPrice);
        item.total_tax_amount = (country === 'US') ? 0 : Math.round(li.tax.value * 100);

        if (!empty(brand)) {
            	item.product_identifiers = item.product_identifiers || {};
            item.product_identifiers.brand = brand;
        }

        if (!empty(categoryPath)) {
            	item.product_identifiers = item.product_identifiers || {};
            item.product_identifiers.category_path = categoryPath;
        }

        if (li.bonusProductLineItem) {
            	item.merchant_data = ORDER_LINE_TYPE.BONUS_PRODUCT;
        }

            // Add product-specific shipping line adjustments
        if (!empty(li.shippingLineItem)) {
            addPriceAdjustments(li.shippingLineItem.priceAdjustments.toArray(), li.productID, null, country, context);
        }

        if (!empty(li.priceAdjustments) && li.priceAdjustments.length > 0) {
            addPriceAdjustments(li.priceAdjustments.toArray(), li.productID, li.optionID, country, context);
        }

        if (Site.getCurrent().getCustomPreferenceValue('kcSendProductAndImageURLs')) {
            if (!empty(li.productID)) {
        item.product_url = URLUtils.http('Product-Show', 'pid', li.productID).toString();
    }

            if (!empty(li.product)) {
        item.image_url = li.product.getImage('small', 0).getImageURL({}).toString();
    }
        }

        context.order_lines.push(item);
    	}
    }

    function buildGiftItems(items, country, context) {
    	var giftData = {};
    	var itemPrice = 0,
    		itemID = '',
    		itemType = '';

    	for (var i = 0; i < items.length; i++) {
    		var li = items[i];
        giftData.message = li.getMessage() ? li.getMessage().replace(/[^\x00-\x7F]/g, '') : '';
        giftData.senderName = li.getSenderName().replace(/[^\x00-\x7F]/g, '');
        giftData.recipientEmail = li.getRecipientEmail();
        giftData.recipientName = li.getRecipientName().replace(/[^\x00-\x7F]/g, '');

        itemPrice = (li.grossPrice.available && country != 'US' ? li.grossPrice.value : li.netPrice.value) * 100;

        var item = new LineItem();
        item.quantity = 1;
        item.type = ORDER_LINE_TYPE.GIFT_CARD;
        item.name = 'Gift Certificate';
        item.reference = li.getGiftCertificateID();
        item.unit_price = Math.round(itemPrice);
        item.merchant_data = JSON.stringify(giftData);
        item.tax_rate = (country === 'US') ? 0 : Math.round(li.taxRate * 10000);
        item.total_amount = Math.round(itemPrice);
        item.total_tax_amount = (country === 'US') ? 0 : Math.round(li.tax.value * 100);

        context.order_lines.push(item);
    	}
    }

    function _getProductCategoryPath(product) {
        var path;
		// get category from products primary category
        var category = product.primaryCategory;

		// get category from product master if not set at variant
        if (category === null && product.variant) {
            category = product.variationModel.master.primaryCategory;
        }

        if (category !== null) {
            path = new ArrayList();
            while (category.parent != null)			{
        if (category.online) path.addAt(0, category.displayName);
        category = category.parent;
    }
            path = path.join(' > ').substring(0, 749); // Maximum 750 characters per Klarna's documentation
        }

        return path;
    }

    function buildShipments(shipments, country, context) {
    	var shipment_unit_price = 0;
        var shipment_tax_rate = 0;

    	for (var i = 0; i < shipments.length; i++) {
    		var shipment = shipments[i];
        shipment_unit_price = (shipment.shippingTotalGrossPrice.available && country !== 'US' ? shipment.shippingTotalGrossPrice.value : shipment.shippingTotalNetPrice.value) * 100;
        shipment_tax_rate = 0;

        if (shipment.shippingTotalTax.available && shipment.shippingTotalNetPrice.available && shipment.shippingTotalTax.value > 0 && shipment.shippingTotalNetPrice.value > 0) {
            shipment_tax_rate = (country === 'US') ? 0 : (shipment.shippingTotalTax.value / shipment.shippingTotalNetPrice.value) * 10000;
        }

        if (!empty(shipment.shippingMethod)) {
            var shippingLineItem = new LineItem();
            shippingLineItem.quantity = 1;
            shippingLineItem.type = ORDER_LINE_TYPE.SHIPPING_FEE;
            shippingLineItem.name = shipment.shippingMethod.displayName.replace(/[^\x00-\x7F]/g, '');
            shippingLineItem.reference = shipment.shippingMethod.ID;
            shippingLineItem.unit_price = Math.round(shipment_unit_price);
            shippingLineItem.tax_rate = Math.round(shipment_tax_rate);
            shippingLineItem.total_amount = shippingLineItem.unit_price;
            shippingLineItem.total_tax_amount = (country === 'US') ? 0 : Math.round(shipment.shippingTotalTax.value * 100);

            addPriceAdjustments(shipment.shippingPriceAdjustments.toArray(), null, null, country, context);

            context.order_lines.push(shippingLineItem);
        }
    }
    }

    function addPriceAdjustments(adjusments, pid, oid, country, context) {
    	var adjusmentPrice = 0;
        var promoName = '';
    	var promoId = '';

    	for (var i = 0; i < adjusments.length; i++) {
    		var adj = adjusments[i];
    		var adjustment = new LineItem();
        adjusmentPrice = (adj.grossPrice.available && country != 'US' ? adj.grossPrice.value : adj.netPrice.value) * 100;
        promoName = !empty(adj.promotion) && !empty(adj.promotion.name) ? adj.promotion.name : ORDER_LINE_TYPE.DISCOUNT;
        	promoId = adj.promotionID;

			// Include product ID with promotion ID if available
        if (!empty(pid)) {
            promoId = pid + '_' + promoId;
        }
			// Include option ID with promotion ID if available
        if (!empty(oid)) {
            promoId = oid + '_' + promoId;
        }

        adjustment.quantity = 1;
        adjustment.type = ORDER_LINE_TYPE.DISCOUNT;
        adjustment.name = promoName.replace(/[^\x00-\x7F]/g, '');
        adjustment.reference = promoId;
        adjustment.unit_price = Math.round(adjusmentPrice);
        adjustment.merchant_data = adj.couponLineItem ? adj.couponLineItem.couponCode : '';
        adjustment.tax_rate = (country === 'US' || adj.tax.value === 0) ? 0 : Math.round(adj.taxRate * 10000);
        adjustment.total_amount = adjustment.unit_price;
        adjustment.total_tax_amount = (country === 'US') ? 0 : Math.round(adj.tax.value * 100);

        context.order_lines.push(adjustment);
    	}
    }

    function buildAddress(address) {
    	this.context.billing_address.phone = address.phone;
        this.context.billing_address.given_name = address.firstName;
        this.context.billing_address.family_name = address.lastName;
        this.context.billing_address.street_address = address.address1 || '';
        this.context.billing_address.street_address2 = address.address2 || '';
        this.context.billing_address.postal_code = address.postalCode || '';
        this.context.billing_address.city = address.city || '';
        this.context.billing_address.region = address.stateCode || '';
        this.context.billing_address.country = address.countryCode.value || '';
    }

    function calculateBasket(basket) {
        HookMgr.callHook('dw.order.calculate', 'calculate', basket);
    }

    function handleRequired(params) {
        if (empty(params) ||
                empty(params.basket) ||
                empty(params.basket.defaultShipment.shippingAddress) ||
                empty(params.localeObject) ||
                empty(params.localeObject.custom.country) ||
                empty(params.localeObject.custom.klarnaLocale)) {
            throw new Error('Error when generating KlarnaOrderRequestBuilder. Not valid params.');
        }
    }

    module.exports = KlarnaOrderRequestBuilder;
}());
