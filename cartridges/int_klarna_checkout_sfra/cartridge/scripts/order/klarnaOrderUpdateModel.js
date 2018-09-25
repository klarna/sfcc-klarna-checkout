(function () {
    'use strict';

    /**
    * Klarna order update model
    */
    function KlarnaOrderUpdateModel() {
        this.order_lines = [];
        this.order_tax_amount = 0;
        this.order_amount = 0;
        this.shipping_options = [];
    }

    /*
     * Define references Model
     *
     * Hoisting functions
    */

    /**
    * Klarna order line object
    */
    function LineItem() {
        this.type = '';
        this.name = '';
        this.reference = '';
        this.quantity = 0;
        this.merchant_data = '';
        this.unit_price = 0;
        this.tax_rate = 0;
        this.total_amount = 0;
        this.total_tax_amount = 0;
        this.total_discount_amount = 0;
    }

    /**
    * Klarna order shipping_options object
    */
    function ShippingOption() {
        this.id = '';
        this.name = '';
        this.description = '';
        this.price = 0;
        this.tax_amount = 0;
        this.tax_rate = 0;
        this.preselected = false;
        this.shipping_method = 'Home';
    }

    module.exports.KlarnaOrderUpdateModel = KlarnaOrderUpdateModel;
    module.exports.LineItem = LineItem;
    module.exports.ShippingOption = ShippingOption;
}());
