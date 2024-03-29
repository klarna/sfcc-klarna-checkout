var FRAUD_STATUS = {
    ACCEPTED: 'ACCEPTED',
    REJECTED: 'REJECTED',
    PENDING: 'PENDING',
    STOPPED: 'STOPPED',
    ACCEPTED_AFTER_REVIEW: 'ACCEPTED_AFTER_REVIEW',
    REJECTED_AFTER_REVIEW: 'REJECTED_AFTER_REVIEW'
};

var PAYMENT_METHOD = 'KLARNA_CHECKOUT';

var ORDER_LINE_TYPE = {
    DISCOUNT: 'discount',
    SHIPPING_FEE: 'shipping_fee',
    SALES_TAX: 'sales_tax',
    PHYSICAL: 'physical',
    SURCHARGE: 'surcharge',
    BONUS_PRODUCT: 'bonus_product',
    STORE_CREDIT: 'store_credit',
    GIFT_CARD: 'gift_card'
};

var CONTENT_TYPE = 'application/vnd.klarna.internal.emd-v2+json';

var KLARNA_CUSTOMER_GROUPS_ADJUSTMENT = 'klarna_cgbp';

var SERVICE_USER_AGENTS = {
    SG: 'SFCC SG Klarna Checkout 20.1.1',
    SFRA: 'SFCC SFRA Klarna Checkout 20.1.1'
}

module.exports.FRAUD_STATUS = FRAUD_STATUS;
module.exports.PAYMENT_METHOD = PAYMENT_METHOD;
module.exports.ORDER_LINE_TYPE = ORDER_LINE_TYPE;
module.exports.CONTENT_TYPE = CONTENT_TYPE;
module.exports.KLARNA_CUSTOMER_GROUPS_ADJUSTMENT = KLARNA_CUSTOMER_GROUPS_ADJUSTMENT;
module.exports.SERVICE_USER_AGENTS = SERVICE_USER_AGENTS;
