var Logger = require('dw/system/Logger');
var StringUtils = require('dw/util/StringUtils');

var KlarnaHttpService = require('~/cartridge/scripts/services/KlarnaHttpService');
var KlarnaApiContext = require('~/cartridge/scripts/services/KlarnaApiContext');
var KlarnaOrderRequestBuilder = require('~/cartridge/scripts/order/klarnaOrderRequestBuilder');


function KlarnaOrderService() {
    this._logger = Logger.getLogger('Klarna'),
    this._klarnaHttpService = new KlarnaHttpService(),
    this._klarnaApiContext = new KlarnaApiContext(),

    /**
     * API call to create Klarna order
     *
     * @param  {dw.order.Basket} basket - A CartModel wrapping the current Basket.
     * @param  {dw.object.CustomObject} localeObject
     * @return {string} Html snippet used for rendering the Klarna checkout
    */
    this.createOrder = function (basket, localeObject, req) {
        var orderRequestBuilder = new KlarnaOrderRequestBuilder();
        var requestBody = orderRequestBuilder.buildRequest({
            basket: basket,
            localeObject: localeObject
        }).get();

        var requestUrl = this._klarnaApiContext.getFlowApiUrls().get('createOrder');
        var response;

        try {
            response = this._klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
        } catch (e) {
            this._logger.error(e);
            return null;
        }

        req.session.privacyCache.set('klarnaOrderID', response.order_id);

        return response.html_snippet;
    },

    /**
     * API call to update Klarna order
     *
     * @param  {dw.order.Basket} basket
     * @param  {dw.object.CustomObject} localeObject
     * @return {string} Html snippet used for rendering the Klarna checkout
    */
    this.updateOrder = function (basket, localeObject, klarnaOrderID) {
        var orderRequestBuilder = new KlarnaOrderRequestBuilder();
        var requestBody = orderRequestBuilder.buildRequest({
            basket: basket,
            localeObject: localeObject
        }).get();

        var requestUrl = StringUtils.format(this._klarnaApiContext.getFlowApiUrls().get('updateOrder'), klarnaOrderID);
        var response;

        try {
            response = this._klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
        } catch (e) {
            this._logger.error(e);
            return null;
        }

        return response.html_snippet;
    },

    /**
     * API call to read an order from Klarna
     *
     * @param  {string} klarnaOrderID
     * @param  {dw.object.CustomObject} localeObject
     * @param  {boolean} isCompletedOrder
     * @return {Object} Klarna Order Object
    */
    this.getOrder = function (klarnaOrderID, localeObject, isCompletedOrder) {
        var klarnaApiUrl = isCompletedOrder ? 'getCompletedOrder' : 'getOrder';
        var requestUrl = StringUtils.format(this._klarnaApiContext.getFlowApiUrls().get(klarnaApiUrl), klarnaOrderID);
        var response;

        try {
            response = this._klarnaHttpService.call(requestUrl, 'GET', localeObject.custom.credentialID);
        } catch (e) {
            this._logger.error(e);
            return null;
        }

        return response;
    },

    /**
     * API call to acknowledge the order
     *
     * @param  {string} klarnaOrderID
     * @param  {dw.object.CustomObject} localeObject
     * @return {void}
    */
    this.acknowledgeOrder = function (klarnaOrderID, localeObject) {
        try {
            var requestUrl = StringUtils.format(this._klarnaApiContext.getFlowApiUrls().get('acknowledgeOrder'), klarnaOrderID);
            this._klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID);
        } catch (e) {
            this._logger.error(e);
        }
    },

    /**
     * API call to fully capture Klarna order
     *
     * @param  {String} klarnaOrderID
     * @param  {dw.object.CustomObject} localeObject
     * @param  {dw.order.Order} order
     * @param  {dw.order.PaymentInstrument} paymentInstrument
     * @return {boolean} whether the capture was successful
    */
    this.captureOrder = function (klarnaOrderID, localeObject, amount) {
        var requestUrl = StringUtils.format(this._klarnaApiContext.getFlowApiUrls().get('captureOrder'), klarnaOrderID);
        var requestBody = new Object();

        requestBody['captured_amount'] = Math.round(amount.value*100);

        try {
            response = this._klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);

        } catch (e) {
            this._logger.error(e);
            return false;
        }

        return true;
    },

    /**
     * API call to update Klarna Order Merchant References
     *
     * @param  {string} klarnaOrderID
     * @param  {dw.object.CustomObject} localeObject
     * @param  {string} value
     * @return {boolean} true if successful, false otherwise
    */
    this.updateOrderMerchantReferences = function (klarnaOrderID, localeObject, value) {
        var requestBodyObject = new Object();

        requestBodyObject.merchant_reference1 = value;

        var requestUrl = StringUtils.format(this._klarnaApiContext.getFlowApiUrls().get('updateMerchantReferences'), klarnaOrderID);

        try {
            this._klarnaHttpService.call(requestUrl, 'PATCH', localeObject.custom.credentialID, requestBodyObject);
        } catch (e) {
            return false;
        }

        return true;
    }
};

module.exports = KlarnaOrderService;
