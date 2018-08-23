/* global empty, dw */
/* eslint no-control-regex: 0 */

(function () {
    'use strict';

    var Builder = require('../util/Builder');
    var ORDER_LINE_TYPE = require('../util/KlarnaConstants.js').ORDER_LINE_TYPE;
    var KlarnaOrderUpdateModel = require('./KlarnaOrderUpdateModel').KlarnaOrderUpdateModel;
    var LineItem = require('./KlarnaOrderUpdateModel').LineItem;
    var ShippingOption = require('./KlarnaOrderUpdateModel').ShippingOption;
    var CheckoutUtils = require('../checkout/Utils.ds');
    var ShippingMgr = require('dw/order/ShippingMgr');
    var TaxMgr = require('dw/order/TaxMgr');
    var Transaction = require('dw/system/Transaction');
    var Site = require('dw/system/Site');
    var ArrayList = require('dw/util/ArrayList');

     /**
    * Calculates the current basket
    *
    * @param {dw.order.basket} basket current basket
    * @returns {void}
    */
    function calculateBasket(basket) {
        dw.system.HookMgr.callHook('dw.ocapi.shop.basket.calculate', 'calculate', basket);
    }

    /**
    * Validate response builder params
    *
    * @param {Object} params response builder params
    * @returns {void}
    */
    function handleRequire(params) {
        if (empty(params) ||
            empty(params.basket) ||
            empty(params.showShippingMethods) ||
            empty(params.basket.defaultShipment.shippingAddress)) {
            throw new Error('Error when generating OrderUpdateResponseBuilder. Not valid params.');
        }
    }

    /**
    * Gets product category path
    *
    * @param {dw.catalog.Product} product the product
    * @returns {string} the category path
    */
    function getProductCategoryPath(product) {
        var path;
        // get category from products primary category
        var category = product.primaryCategory;

        // get category from product master if not set at variant
        if (category === null && product.variant) {
            category = product.variationModel.master.primaryCategory;
        }

        if (category !== null) {
            path = new ArrayList();
            while (category.parent != null) {
                if (category.online) path.addAt(0, category.displayName);
                category = category.parent;
            }
            path = path.join(' > ').substring(0, 749); // Maximum 750 characters per Klarna's documentation
        }

        return path;
    }

    /**
    * Builds price adjustements as order lines
    *
    * @param {array} adjusments the price adjustments
    * @param {string} pid the product id
    * @param {string} oid option the product id
    * @param {Object} context object context
    */
    function addPriceAdjustments(adjusments, pid, oid, context) {
        var adjusmentPrice = 0;
        var promoName = '';
        var promoId = '';

        for (var i = 0; i < adjusments.length; i++) {
            var adj = adjusments[i];
            var adjustment = new LineItem();
            adjusmentPrice = (adj.priceValue) * 100;
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
            adjustment.tax_rate = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET || adj.tax.value === 0) ? 0 : Math.round(adj.taxRate * 10000);
            adjustment.total_amount = adjustment.unit_price;
            adjustment.total_tax_amount = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : Math.round(adj.tax.value * 100);

            context.order_lines.push(adjustment);
        }
    }

    /**
    * Builds Klarna order lines
    *
    * @param {array} items line items
    * @param {Object} context object context
    */
    function buildItems(items, context) {
        var brand;
        var categoryPath;
        var itemPrice = 0;
        var itemID = '';
        var itemType = '';

        for (var i = 0; i < items.length; i++) {
            var li = items[i];

            if (li.bundledProductLineItem) {
                continue; // eslint-disable-line no-continue
            }

            if (li.optionProductLineItem) {
                itemType = ORDER_LINE_TYPE.SURCHARGE;
                itemID = li.parent.productID + '_' + li.optionID + '_' + li.optionValueID;
                brand = !empty(li.parent.product) ? li.parent.product.brand : null;
                categoryPath = !empty(li.parent.product) ? getProductCategoryPath(li.parent.product) : null;
            } else {
                itemType = ORDER_LINE_TYPE.PHYSICAL;
                itemID = li.productID;
                brand = !empty(li.product) ? li.product.brand : null;
                categoryPath = !empty(li.product) ? getProductCategoryPath(li.product) : null;
            }

            itemPrice = (li.priceValue) * 100;

            var item = new LineItem();
            item.quantity = li.quantityValue;
            item.type = itemType;
            item.name = li.productName.replace(/[^\x00-\x7F]/g, '');
            item.reference = itemID;
            item.unit_price = Math.round(itemPrice / li.quantityValue);
            item.tax_rate = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : Math.round(li.taxRate * 10000);
            item.total_amount = Math.round(itemPrice);
            item.total_tax_amount = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : Math.round(li.tax.value * 100);

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
                addPriceAdjustments(li.shippingLineItem.priceAdjustments.toArray(), li.productID, null, context);
            }

            if (!empty(li.priceAdjustments) && li.priceAdjustments.length > 0) {
                addPriceAdjustments(li.priceAdjustments.toArray(), li.productID, li.optionID, context);
            }

            if (Site.getCurrent().getCustomPreferenceValue('kcSendProductAndImageURLs')) {
                if (!empty(li.productID)) {
                    item.product_url = dw.web.URLUtils.http('Product-Show', 'pid', li.productID).toString();
                }

                if (!empty(li.product)) {
                    item.image_url = li.product.getImage('small', 0).getImageURL({}).toString();
                }
            }

            context.order_lines.push(item);
        }
    }

    /**
    * Builds Klarna gift order lines
    *
    * @param {array} items line items
    * @param {Object} context object context
    */
    function buildGiftItems(items, context) {
        var giftData = {};
        var itemPrice = 0;

        for (var i = 0; i < items.length; i++) {
            var li = items[i];
            giftData.message = li.getMessage() ? li.getMessage().replace(/[^\x00-\x7F]/g, '') : '';
            giftData.senderName = li.getSenderName().replace(/[^\x00-\x7F]/g, '');
            giftData.recipientEmail = li.getRecipientEmail();
            giftData.recipientName = li.getRecipientName().replace(/[^\x00-\x7F]/g, '');

            itemPrice = (li.priceValue) * 100;

            var item = new LineItem();
            item.quantity = 1;
            item.type = ORDER_LINE_TYPE.GIFT_CARD;
            item.name = 'Gift Certificate';
            item.reference = li.getGiftCertificateID();
            item.unit_price = Math.round(itemPrice);
            item.merchant_data = JSON.stringify(giftData);
            item.tax_rate = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : Math.round(li.taxRate * 10000);
            item.total_amount = Math.round(itemPrice);
            item.total_tax_amount = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : Math.round(li.tax.value * 100);

            context.order_lines.push(item);
        }
    }

    /**
    * Gets product category path
    *
    * @param {dw.order.Shipment} shipment current basket shipment
    * @returns {Array} the applicable shipping methods
    */
    function getApplicableShippingMethods(shipment) {
        var address = shipment.shippingAddress;

        var addressObj = {};
        addressObj.address1 = address.address1;
        addressObj.address2 = address.address2;
        addressObj.countryCode = address.countryCode.value;
        addressObj.stateCode = address.stateCode;
        addressObj.postalCode = address.postalCode;
        addressObj.city = address.city;

        if (!addressObj.countryCode) {
            addressObj.countryCode = 'US';
        }

        if (!addressObj.stateCode) {
            addressObj.stateCode = 'NY';
        }
        // Retrieve the list of applicable shipping methods for the given shipment and address.
        return ShippingMgr.getShipmentShippingModel(shipment).getApplicableShippingMethods(addressObj).toArray();
    }

    /**
    * Builds Klarna shipping order lines
    *
    * @param {array} shipments basket shipments
    * @param {Object} context object context
    */
    function buildShipments(shipments, context) {
        var shipmentUnitPrice = 0;
        var shipmentTaxRate = 0;

        for (var i = 0; i < shipments.length; i++) {
            var shipment = shipments[i];
            shipmentUnitPrice = (shipment.shippingTotalPrice.value) * 100;
            shipmentTaxRate = 0;

            if (shipment.shippingTotalTax.available && shipment.shippingTotalNetPrice.available && shipment.shippingTotalTax.value > 0 && shipment.shippingTotalNetPrice.value > 0) {
                shipmentTaxRate = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : (shipment.shippingTotalTax.value / shipment.shippingTotalNetPrice.value) * 10000;
            }

            if (!empty(shipment.shippingMethod)) {
                var shippingLineItem = new LineItem();
                shippingLineItem.quantity = 1;
                shippingLineItem.type = ORDER_LINE_TYPE.SHIPPING_FEE;
                shippingLineItem.name = shipment.shippingMethod.displayName.replace(/[^\x00-\x7F]/g, '');
                shippingLineItem.reference = shipment.shippingMethod.ID;
                shippingLineItem.unit_price = Math.round(shipmentUnitPrice);
                shippingLineItem.tax_rate = Math.round(shipmentTaxRate);
                shippingLineItem.total_amount = shippingLineItem.unit_price;
                shippingLineItem.total_tax_amount = (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) ? 0 : Math.round(shipment.shippingTotalTax.value * 100);

                addPriceAdjustments(shipment.shippingPriceAdjustments.toArray(), null, null, context);

                context.order_lines.push(shippingLineItem);
            }
        }
    }

    /**
    * Klarna order update response builder
    */
    function OrderUpdateResponseBuilder() {
        this.context = null;
    }

    OrderUpdateResponseBuilder.prototype = new Builder();
    OrderUpdateResponseBuilder.prototype.get = function () {
        return this.context;
    };

    /*
        Build request here
    */
    OrderUpdateResponseBuilder.prototype.buildResponse = function (params) {
        try {
            handleRequire(params);
        } catch (e) {
            throw new Error(e);
        }

        var basket = params.basket;
        var showShippingMethods = params.showShippingMethods;

        var responseBodyObject = this.init()
            .buildCurrency(basket)
            .buildOrderLines(basket, showShippingMethods)
            .buildGiftPayments(basket)
            .buildTotalAmount(basket)
            .buildTotalTax(basket);

        if (showShippingMethods) {
            this.buildShippingMethods(basket);
        }

        return responseBodyObject;
    };

    OrderUpdateResponseBuilder.prototype.init = function () {
        this.context = new KlarnaOrderUpdateModel();

        return this;
    };

    OrderUpdateResponseBuilder.prototype.buildCurrency = function (basket) {
        var currency = basket.getCurrencyCode();
        this.context.purchase_currency = currency;

        return this;
    };

    OrderUpdateResponseBuilder.prototype.buildOrderLines = function (basket) {
        var lineItems = basket.getAllProductLineItems().toArray();
        var giftLineItems = basket.getGiftCertificateLineItems().toArray();
        var shipments = basket.shipments;

        buildItems(lineItems, this.context);
        buildGiftItems(giftLineItems, this.context);
        buildShipments(shipments, this.context);

        return this;
    };

    OrderUpdateResponseBuilder.prototype.buildGiftPayments = function (basket) {
        var gcPIIter = basket.getGiftCertificatePaymentInstruments().iterator();

        while (gcPIIter.hasNext()) {
            var gcPaymentInstrument = gcPIIter.next();

            var adjustment = new LineItem();
            var adjusmentPrice = gcPaymentInstrument.getPaymentTransaction().amount.value * -100;

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

    OrderUpdateResponseBuilder.prototype.buildTotalAmount = function (basket) {
        var orderAmount = CheckoutUtils.calculateNonGiftCertificateAmount(basket).value * 100;

        this.context.order_amount = Math.round(orderAmount);

        // Set order discount line items
        addPriceAdjustments(basket.priceAdjustments, null, null, this.context);

        return this;
    };

    OrderUpdateResponseBuilder.prototype.buildTotalTax = function (basket) {
        var totalTax = basket.totalTax.value * 100;
        this.context.order_tax_amount = Math.round(totalTax);

        if (TaxMgr.taxationPolicy === TaxMgr.TAX_POLICY_NET) {
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

    OrderUpdateResponseBuilder.prototype.buildShippingMethods = function (basket) {
        var shippingMethodPrice;
        var shipment = basket.defaultShipment;
        var applicableShippingMethods = getApplicableShippingMethods(shipment);

        if (!empty(applicableShippingMethods) && applicableShippingMethods.length > 0) {
            var currentShippingMethod = basket.getDefaultShipment().getShippingMethod() || ShippingMgr.getDefaultShippingMethod();

            // Transaction controls are for fine tuning the performance of the data base interactions when calculating shipping methods
            Transaction.begin();
            for (var i = 0; i < applicableShippingMethods.length; i++) {
                var shippingMethod = applicableShippingMethods[i];

                if (shippingMethod.custom.storePickupEnabled) {
                    continue; // eslint-disable-line no-continue
                }

                shipment.setShippingMethod(shippingMethod);
                calculateBasket(basket);
                shippingMethodPrice = (basket.adjustedShippingTotalPrice.value) * 100;

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

    module.exports = OrderUpdateResponseBuilder;
}());
