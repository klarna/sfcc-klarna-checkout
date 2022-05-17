(function () {
    'use strict';

    /*
     * Define references Model
     *
     * Hoisting functions
    */

    /**
    * Klarna order billing_address object
    */
    function BillingAddress() {
        this.title = '';
        this.given_name = '';
        this.family_name = '';
        this.email = '';
        this.phone = '';
        this.street_address = '';
        this.street_address2 = '';
        this.postal_code = '';
        this.city = '';
        this.region = '';
        this.country = '';
    }

    /**
    * Klarna order line object
    */
    function LineItem() {
        this.type = '';
        this.name = '';
        this.reference = '';
        this.quantity = 0;
        this.unit_price = 0;
        this.tax_rate = 0;
        this.total_amount = 0;
        this.total_tax_amount = 0;
        this.total_discount_amount = 0;
    }

    /**
    * Klarna order merchant_urls object
    */
    function MerchantUrls() {
        this.terms = '';
        this.checkout = '';
        this.confirmation = '';
        this.push = '';
        this.validation = '';
        this.shipping_option_update = '';
        this.address_update = '';
        this.notification = '';
    }

    /**
    * Klarna order UI options object
    */
    function Options() {
        this.title_mandatory = true;
        this.date_of_birth_mandatory = false;
        this.shipping_details = '';
        this.show_subtotal_detail = false;
        this.allow_separate_shipping_address = false;
        this.require_validate_callback_success = false;
        this.radius_border = '2';
        this.color_button = '#FF9900';
        this.color_button_text = '#FF9900';
        this.color_checkbox = '#FF9900';
        this.color_checkbox_checkmark = '#FF9900';
        this.color_header = '#FF9900';
        this.color_link = '#FF9900';
        this.vat_removed = false;
    }

    /**
    * Klarna order Gui object
    */
    function Gui() {
        this.options = [];
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

    /**
    * Klarna order model
    */
    function KlarnaOrderModel() {
        this.billing_address = new BillingAddress();
        this.order_lines = [];
        this.order_tax_amount = 0;
        this.order_amount = 0;
        this.merchant_urls = new MerchantUrls();
        this.shipping_options = [];
        this.shipping_countries = [];
        this.options = new Options();
        this.gui = new Gui();
    }

    module.exports.KlarnaOrderModel = KlarnaOrderModel;
    module.exports.LineItem = LineItem;
    module.exports.ShippingOption = ShippingOption;
}());
