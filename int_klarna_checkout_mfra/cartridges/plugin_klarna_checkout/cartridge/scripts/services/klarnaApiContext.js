'use strict';

var HashMap = require('dw/util/HashMap');

var KlarnaApiContext = function () {};

KlarnaApiContext.prototype.getFlowApiUrls = function() {

    if (this._flowApiUrls == null) {
        this._flowApiUrls = new HashMap();

        this._flowApiUrls.put('createOrder', 'checkout/v3/orders');
        this._flowApiUrls.put('updateOrder', 'checkout/v3/orders/{0}');
        this._flowApiUrls.put('getOrder', 'checkout/v3/orders/{0}');
        this._flowApiUrls.put('getCompletedOrder', '/ordermanagement/v1/orders/{0}');
        this._flowApiUrls.put('acknowledgeOrder', '/ordermanagement/v1/orders/{0}/acknowledge');
        this._flowApiUrls.put('updateMerchantReferences', '/ordermanagement/v1/orders/{0}/merchant-references');
        this._flowApiUrls.put('cancelOrder', '/ordermanagement/v1/orders/{0}/cancel');
        this._flowApiUrls.put('captureOrder', '/ordermanagement/v1/orders/{0}/captures');
        this._flowApiUrls.put('vcnSettlement', '/merchantcard/v2/settlements');
    }

    return this._flowApiUrls;
};

module.exports = KlarnaApiContext;
