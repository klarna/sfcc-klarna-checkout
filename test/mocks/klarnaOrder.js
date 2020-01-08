'use strict';

var config = require('../integration/it.config');

var klarnaOrderMock = {
    name: "Women's Fashion",
    purchase_country: 'US',
    purchase_currency: 'USD',
    locale: 'en-US',
    billing_address: {
        organization_name: 'string',
        reference: 'string',
        attention: 'string',
        given_name: 'John',
        family_name: 'Doe',
        email: 'john@doe.com',
        title: 'Mr',
        street_address: '1215 Daylene Drive',
        street_address2: 'Apt 214',
        street_name: 'Daylene Drive',
        street_number: '1215',
        house_extension: 'B',
        postal_code: '48075',
        city: 'Southfield',
        region: 'MI',
        phone: '734-573-6613',
        country: 'US',
        care_of: 'C/O'
    },
    shipping_address: {
        organization_name: 'string',
        reference: 'string',
        attention: 'string',
        given_name: 'John',
        family_name: 'Doe',
        email: 'john@doe.com',
        title: 'Mr',
        street_address: 'Lombard St 10',
        street_address2: 'Apt 214',
        street_name: 'Lombard St',
        street_number: '10',
        house_extension: 'B',
        postal_code: '90210',
        city: 'Beverly Hills',
        region: 'CA',
        phone: '333444555',
        country: 'US',
        care_of: 'C/O'
    },
    order_amount: 50000,
    order_tax_amount: 4545,
    order_lines: [
        {
            type: 'physical',
            reference: config.testProductId,
            name: 'Red T-Shirt',
            quantity: 1,
            quantity_unit: 'pcs',
            unit_price: 10000,
            tax_rate: 1000,
            total_amount: 50000,
            total_discount_amount: 0,
            total_tax_amount: 4545,
            merchant_data: "{\"marketplace_seller_info\":[{\"product_category\":\"Women's Fashion\",\"product_name\":\"Women Sweatshirt\"}]}",
            product_url: 'https://www.example.com/products/f2a8d7e34',
            image_url: 'https://www.exampleobjects.com/logo.png',
            product_identifiers: {
                category_path: 'Electronics Store > Computers & Tablets > Desktops',
                global_trade_item_number: '735858293167',
                manufacturer_part_number: 'BOXNUC5CPYH',
                brand: 'Intel'
            },
            shipping_attributes: {
                weight: 1000,
                dimensions: 'height: 100, width: 100, length: 100',
                tags: '["dangerous_goods", "bulky"]'
            }
        }
    ],
    customer: {
        date_of_birth: '1995-10-20',
        type: 'person',
        organization_registration_id: '556737-0431',
        gender: 'male'
    },
    merchant_urls: {
        terms: 'https://www.example.com/terms.html',
        cancellation_terms: 'https://www.example.com/terms/cancellation.html',
        checkout: 'https://www.example.com/checkout.html',
        confirmation: 'https://www.example.com/confirmation.html',
        push: 'https://www.example.com/api/push',
        validation: 'https://www.example.com/api/validation',
        shipping_option_update: 'https://www.example.com/api/shipment',
        address_update: 'https://www.example.com/api/address',
        notification: 'https://www.example.com/api/pending',
        country_change: 'https://www.example.com/api/country'
    },
    html_snippet: "<div id='klarna-checkout-container'><script>alert('Initializing Klarna Checkout');</script></div>",
    merchant_reference1: config.orderNumber,
    merchant_reference2: config.orderNumber,
    started_at: '2019-10-22T09:48:17.100Z',
    completed_at: '2019-10-22T09:48:17.100Z',
    last_modified_at: '2019-10-22T09:48:17.100Z',
    options: {
        acquiring_channel: 'eCommerce',
        allow_separate_shipping_address: false,
        color_button: '#FF9900',
        color_button_text: '#FF9900',
        color_checkbox: '#FF9900',
        color_checkbox_checkmark: '#FF9900',
        color_header: '#FF9900',
        color_link: '#FF9900',
        date_of_birth_mandatory: false,
        shipping_details: 'Delivered within 1-3 working days',
        title_mandatory: false,
        additional_checkbox: {
            text: 'Please add me to the newsletter list, read more here link',
            checked: false,
            required: false
        },
        national_identification_number_mandatory: false,
        additional_merchant_terms: 'string',
        phone_mandatory: false,
        radius_border: '5',
        allowed_customer_types: '["person", "organization"]',
        show_subtotal_detail: false,
        additional_checkboxes: [
            {
                id: 'newsletter_opt_in',
                text: 'Please add me to the newsletter list, read more here link',
                checked: false,
                required: false
            }
        ],
        require_validate_callback_success: false,
        vat_removed: false,
        verify_national_identification_number: false,
        show_vat_registration_number_field: false
    },
    attachment: {
        content_type: 'application/vnd.klarna.internal.emd-v2+json',
        body: "{\"marketplace_seller_info\":[{\"product_category\":\"Women's Fashion\",\"product_name\":\"Women Sweatshirt\"}]}"
    },
    external_payment_methods: [
        {
            name: 'PayhereUs',
            redirect_url: 'https://www.example.com/us/start',
            image_url: 'https://www.exampleobjects.com/logo.png',
            fee: 0,
            description: 'an American company operating a worldwide online payments system',
            countries: [
                'us',
                'gb'
            ],
            label: 'continue'
        }
    ],
    external_checkouts: [
        {
            name: 'PayhereUs',
            redirect_url: 'https://www.example.com/us/start',
            image_url: 'https://www.exampleobjects.com/logo.png',
            fee: 0,
            description: 'an American company operating a worldwide online payments system',
            countries: [
                'us',
                'gb'
            ],
            label: 'continue'
        }
    ],
    shipping_countries: [
        'us',
        'gb'
    ],
    shipping_options: [
        {
            id: 'express_priority',
            name: 'EXPRESS 1-2 Days',
            description: 'Delivery by 4:30 pm',
            promo: 'Christmas Promotion',
            price: 0,
            tax_amount: 0,
            tax_rate: 0,
            preselected: false,
            shipping_method: 'PickUpStore',
            delivery_details: {
                carrier: 'string',
                class: 'string',
                product: {
                    name: 'string',
                    identifier: 'string'
                },
                pickup_location: {
                    id: 'string',
                    name: 'string',
                    address: {
                        organization_name: 'string',
                        reference: 'string',
                        attention: 'string',
                        given_name: 'John',
                        family_name: 'Doe',
                        email: 'john@doe.com',
                        title: 'Mr',
                        street_address: 'Lombard St 10',
                        street_address2: 'Apt 214',
                        street_name: 'Lombard St',
                        street_number: '10',
                        house_extension: 'B',
                        postal_code: '90210',
                        city: 'Beverly Hills',
                        region: 'CA',
                        phone: '333444555',
                        country: 'US',
                        care_of: 'C/O'
                    }
                },
                timeslot: {
                    id: 'string',
                    start: 'string',
                    end: 'string'
                }
            },
            tms_reference: 'a1b2c3d4-e4f6-g7h8-i9j0-k1l2m3n4o5p6'
        }
    ],
    merchant_data: "{\"marketplace_seller_info\":[{\"product_category\":\"Women's Fashion\",\"product_name\":\"Women Sweatshirt\"}]}",
    gui: {
        options: [
            'disable_autofocus'
        ]
    },
    merchant_requested: {
        additional_checkbox: false,
        additional_checkboxes: [
            {
                id: 'string',
                checked: false
            }
        ]
    },
    selected_shipping_option: {
        id: 'express_priority',
        name: 'EXPRESS 1-2 Days',
        description: 'Delivery by 4:30 pm',
        promo: 'Christmas Promotion',
        price: 0,
        tax_amount: 0,
        tax_rate: 0,
        preselected: false,
        shipping_method: 'PickUpStore',
        delivery_details: {
            carrier: 'string',
            class: 'string',
            product: {
                name: 'string',
                identifier: 'string'
            },
            pickup_location: {
                id: 'string',
                name: 'string',
                address: {
                    organization_name: 'string',
                    reference: 'string',
                    attention: 'string',
                    given_name: 'John',
                    family_name: 'Doe',
                    email: 'john@doe.com',
                    title: 'Mr',
                    street_address: 'Lombard St 10',
                    street_address2: 'Apt 214',
                    street_name: 'Lombard St',
                    street_number: '10',
                    house_extension: 'B',
                    postal_code: '90210',
                    city: 'Beverly Hills',
                    region: 'CA',
                    phone: '333444555',
                    country: 'US',
                    care_of: 'C/O'
                }
            },
            timeslot: {
                id: 'string',
                start: 'string',
                end: 'string'
            }
        },
        tms_reference: 'a1b2c3d4-e4f6-g7h8-i9j0-k1l2m3n4o5p6'
    },
    recurring: false,
    recurring_token: 'string',
    recurring_description: 'string',
    billing_countries: [
        'us',
        'gb'
    ],
    tags: '["dangerous_goods", "bulky"]'
};

module.exports.klarnaOrderMock = klarnaOrderMock;
