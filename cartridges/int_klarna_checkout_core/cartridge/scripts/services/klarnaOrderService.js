/* eslint no-unused-expressions: 0 */
/* globals session:false */

var Logger = require('dw/system/Logger');
var StringUtils = require('dw/util/StringUtils');

var KlarnaHttpService = require('*/cartridge/scripts/services/klarnaHttpService');
var KlarnaApiContext = require('*/cartridge/scripts/services/klarnaApiContext');
var KlarnaOrderRequestBuilder = require('*/cartridge/scripts/order/klarnaOrderRequestBuilder');
var SERVICE_USER_AGENTS = require('*/cartridge/scripts/util/klarnaConstants').SERVICE_USER_AGENTS;

/**
 * @constructor
 * @classdesc Klarna Checkout API service wrapper
 */
function KlarnaOrderService(params) {
    var userAgent = SERVICE_USER_AGENTS.SFRA;
    if (typeof params === 'object' && params.userAgent) {
        userAgent = params.userAgent;
    }
    this.logger = Logger.getLogger('Klarna');
    this.klarnaHttpService = new KlarnaHttpService({
        userAgent: userAgent
    });
    this.klarnaApiContext = new KlarnaApiContext();

    /**
     * API call to create Klarna order
     *
     * @param  {dw.order.Basket} basket - A CartModel wrapping the current Basket.
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @param  {string} siteLocaleId current site locale id
     * @return {string} Html snippet used for rendering the Klarna checkout
    */
    this.createOrder = function (basket, localeObject, siteLocaleId) {
        var orderRequestBuilder = new KlarnaOrderRequestBuilder();
        var requestBody = orderRequestBuilder.buildRequest({
            basket: basket,
            localeObject: localeObject,
            siteLocaleId: siteLocaleId
        }).get();

        var requestUrl = this.klarnaApiContext.getFlowApiUrls().get('createOrder');
        var response;

        try {
            response = this.klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
        } catch (e) {
            this.logger.error(e);
            return null;
        }

        session.privacy.klarnaCountry = localeObject.custom.country;
        session.privacy.klarnaOrderID = response.order_id;

        return response.html_snippet;
    };

    /**
     * API call to update Klarna order
     *
     * @param  {dw.order.Basket} basket current basket
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {string} siteLocaleId current site locale id
     * @return {string} Html snippet used for rendering the Klarna checkout
    */
    this.updateOrder = function (basket, localeObject, klarnaOrderID, siteLocaleId) {
        var orderRequestBuilder = new KlarnaOrderRequestBuilder();
        var requestBody = orderRequestBuilder.buildRequest({
            basket: basket,
            localeObject: localeObject,
            siteLocaleId: siteLocaleId
        }).get();

        var requestUrl = StringUtils.format(this.klarnaApiContext.getFlowApiUrls().get('updateOrder'), klarnaOrderID);
        var response;

        try {
            response = this.klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
        } catch (e) {
            this.logger.error(e);
            return null;
        }

        return response.html_snippet;
    };

    /**
     * API call to read an order from Klarna
     *
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @param  {boolean} isCompletedOrder whether the order is placed at Klarna end
     * @return {Object} Klarna Order Object
    */
    this.getOrder = function (klarnaOrderID, localeObject, isCompletedOrder) {
        var klarnaApiUrl = isCompletedOrder ? 'getCompletedOrder' : 'getOrder';
        var requestUrl = StringUtils.format(this.klarnaApiContext.getFlowApiUrls().get(klarnaApiUrl), klarnaOrderID);
        var response;

        try {
            response = this.klarnaHttpService.call(requestUrl, 'GET', localeObject.custom.credentialID);
        } catch (e) {
            this.logger.error(e);
            return null;
        }

        return response;
    };

    /**
     * API call to cancel an order in Klarna
     *
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @return {void}
    */
    this.cancelOrder = function (klarnaOrderID, localeObject) {
        var requestUrl = StringUtils.format(this.klarnaApiContext.getFlowApiUrls().get('cancelOrder'), klarnaOrderID);

        try {
            this.klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID);
        } catch (e) {
            this.logger.error(e);
        }
    };

    /**
     * API call to acknowledge the order
     *
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @return {void}
    */
    this.acknowledgeOrder = function (klarnaOrderID, localeObject) {
        try {
            var requestUrl = StringUtils.format(this.klarnaApiContext.getFlowApiUrls().get('acknowledgeOrder'), klarnaOrderID);
            this.klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID);
        } catch (e) {
            this.logger.error(e);
        }
    };

    /**
     * API call to fully capture Klarna order
     *
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @param  {dw.value.Money} amount the amount to be captured
     * @return {boolean} whether the capture was successful
    */
    this.captureOrder = function (klarnaOrderID, localeObject, amount) {
        var requestUrl = StringUtils.format(this.klarnaApiContext.getFlowApiUrls().get('captureOrder'), klarnaOrderID);
        var requestBody = {};

        requestBody.captured_amount = Math.round(amount.value * 100);

        try {
            this.klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
        } catch (e) {
            this.logger.error(e);
            return false;
        }

        return true;
    };

    /**
     * API call to update Klarna Order Merchant References
     *
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @return {Object} the settlement
    */
    this.createVCNSettlement = function (klarnaOrderID, localeObject) {
        var Site = require('dw/system/Site');
        var requestUrl = this.klarnaApiContext.getFlowApiUrls().get('vcnSettlement');

        var requestBody = {
            order_id: klarnaOrderID,
            key_id: Site.getCurrent().getCustomPreferenceValue('kcVCNkeyId')
        };

        var response;

        try {
            response = this.klarnaHttpService.call(requestUrl, 'POST', localeObject.custom.credentialID, requestBody);
        } catch (e) {
            this.logger.error(e);
            return null;
        }

        return response;
    };

    /**
     * API call to update Klarna Order Merchant References
     *
     * @param  {string} klarnaOrderID the ID of the Klarna order
     * @param  {dw.object.CustomObject} localeObject Klara region specific options
     * @param  {string} value the value which has to be set as merchant reference
     * @return {boolean} true if successful, false otherwise
    */
    this.updateOrderMerchantReferences = function (klarnaOrderID, localeObject, value) {
        var requestBodyObject = {};

        requestBodyObject.merchant_reference1 = value;

        var requestUrl = StringUtils.format(this.klarnaApiContext.getFlowApiUrls().get('updateMerchantReferences'), klarnaOrderID);

        try {
            this.klarnaHttpService.call(requestUrl, 'PATCH', localeObject.custom.credentialID, requestBodyObject);
        } catch (e) {
            return false;
        }

        return true;
    };
}

module.exports = KlarnaOrderService;
