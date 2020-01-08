'use strict';

var HashMap = require('dw/util/HashMap');

var KlarnaApiContext = function () {};

KlarnaApiContext.prototype.getFlowApiUrls = function () {
    if (this.flowApiUrls == null) {
        this.flowApiUrls = new HashMap();

        this.flowApiUrls.put('createOrder', '/checkout/v3/orders');
        this.flowApiUrls.put('updateOrder', '/checkout/v3/orders/{0}');
        this.flowApiUrls.put('getOrder', '/checkout/v3/orders/{0}');
        this.flowApiUrls.put('getCompletedOrder', '/ordermanagement/v1/orders/{0}');
        this.flowApiUrls.put('acknowledgeOrder', '/ordermanagement/v1/orders/{0}/acknowledge');
        this.flowApiUrls.put('updateMerchantReferences', '/ordermanagement/v1/orders/{0}/merchant-references');
        this.flowApiUrls.put('cancelOrder', '/ordermanagement/v1/orders/{0}/cancel');
        this.flowApiUrls.put('captureOrder', '/ordermanagement/v1/orders/{0}/captures');
        this.flowApiUrls.put('vcnSettlement', '/merchantcard/v3/settlements');
    }

    return this.flowApiUrls;
};

module.exports = KlarnaApiContext;
