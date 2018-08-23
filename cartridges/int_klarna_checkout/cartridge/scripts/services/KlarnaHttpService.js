/* eslint no-unused-expressions: 0 */

var Logger = require('dw/system/Logger');
var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var StringUtils = require('dw/util/StringUtils');
var Site = require('dw/system/Site');
var Resource = require('dw/web/Resource');

var klarnaService = LocalServiceRegistry.createService(Site.getCurrent().getCustomPreferenceValue('kcServiceName'), {
    createRequest: function (svc, requestObj) {
        svc.addHeader('Content-Type', 'application/json');
        svc.addHeader('Accept', 'application/json');
        svc.setCredentialID(requestObj.credentialID);
        svc.setURL(null);
        svc.setURL(svc.getURL().replace(/\/$/, '') + requestObj.urlPath);

        if (requestObj.method) {
            svc.setRequestMethod(requestObj.method);
        }

        var requestBody = requestObj.body ? requestObj.body : '';
        return JSON.stringify(requestBody);
    },

    parseResponse: function (svc, response) {
        if (response.getText()) {
            var jsonResponse = response.getText().replace(/\r?\n|\r/g, ' ');
            return JSON.parse(jsonResponse);
        }
        return response.statusCode;
    },

    filterLogMessage: function (msg) {
        return msg;
    }
});

/**
 * @constructor
 * @classdesc Klarna HTTP service wrapper
 */
function KlarnaHttpService() {
    this.logger = Logger.getLogger('Klarna');

    this.call = function (urlPath, httpVerb, credentialID, requestBody) {
        var requestObject = {};

        if (credentialID) {
            requestObject.credentialID = credentialID;
        } else {
            throw new Error('Not valid or empty credentialID - ' + credentialID);
        }

        if (urlPath) {
            requestObject.urlPath = urlPath;
        } else {
            throw new Error('Not valid or empty urlPath - ' + urlPath);
        }

        if (requestBody) {
            requestObject.body = requestBody;
        }

        if (httpVerb && this.isValidHttpVerb(httpVerb)) {
            requestObject.method = httpVerb;
        }

        var result;
        try {
            result = klarnaService.call(requestObject);
        } catch (ex) {
            var exception = ex;
            this.logger.error(exception.message);
        }

        this.logResponseData(urlPath, httpVerb, requestBody, result);
        this.detectErrorResponse(result, klarnaService.URL, requestBody);

        return result.object;
    };

    this.isValidHttpVerb = function (httpVerb) {
        var validHttpVerbs = ['GET', 'PUT', 'POST', 'DELETE', 'PATCH'];

        if (validHttpVerbs.indexOf(httpVerb) !== -1) {
            return true;
        }
        throw new Error('Not valid HTTP verb defined - ' + httpVerb);
    };

    this.detectErrorResponse = function (result, requestUrl, requestBody) {
        if (!result) {
            this.logger.error('result was empty');
            throw new Error(this.getErrorResponse('default'));
        } else if (result.error !== 0 || result.status === 'ERROR' || result.status === 'SERVICE_UNAVAILABLE') {
            this.logErrorResponse(result, requestUrl, requestBody);
            throw new Error(result.errorMessage);
        }
    };

    this.getErrorResponse = function (errorCode) {
        var errorResource = 'apierror.flow.' + errorCode;
        var defaultMessage = Resource.msg('apierror.flow.default', 'klarna', null);
        var errorMessage = Resource.msg(errorResource, 'klarna', defaultMessage);

        if (errorMessage) {
            return errorMessage;
        }
        return defaultMessage;
    };

    this.logErrorResponse = function (result, requestUrl, requestBody) {
        var content = 'result.error=[' + result.error;
        content += '], result.status=[' + result.status;
        content += '], result.errorMessage=[' + result.errorMessage + ']';

        if (result.object && result.object.text) {
            content += '], result.object.text=[' + result.object.text + ']';
        }

        if (requestUrl) {
            content += ', requestUrl=[' + requestUrl + ']';
        }

        if (requestBody) {
            content += ', requestBody=[' + JSON.stringify(requestBody) + ']';
        }

        this.logger.error(content);
    };

    this.logResponseData = function (urlPath, httpVerb, requestBody, result) {
        try {
            var message = '';
            var requestBodyJson = JSON.stringify(requestBody);

            if (result.object) {
                message = StringUtils.format('Response for request urlPath={0}, httpVerb={1}, requestBody=[{2}], responseBody=[{3}]',
                            urlPath,
                            httpVerb,
                            requestBodyJson,
                            JSON.stringify(result.object));
            } else {
                message = StringUtils.format('Response for EMPTY request urlPath={0}, httpVerb={1}, requestBody=[{2}]',
                            urlPath,
                            httpVerb,
                            requestBodyJson);
            }

            this.logger.info(message);
        } catch (e) {
            var exception = e;
            this.logger.error(exception);
        }
    };
}

module.exports = KlarnaHttpService;
