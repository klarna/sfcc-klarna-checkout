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
        svc.setURL(svc.getURL() + requestObj.urlPath);

	    if (!empty(requestObj.method)) {
	    	svc.setRequestMethod(requestObj.method);
	    };

	    var requestBody = requestObj.body ? requestObj.body : '';
        return JSON.stringify(requestBody);
    },

    parseResponse: function (svc, response) {
        if (!empty(response.getText())){
            var jsonResponse = response.getText().replace(/\r?\n|\r/g, ' ');
            return JSON.parse(jsonResponse);
        }
        return response.statusCode;
    },

    filterLogMessage: function (msg) {
        return msg;
    }
});


function KlarnaHttpService() {
    this._logger = Logger.getLogger('Klarna'),

    this.call = function (urlPath, httpVerb, credentialID, requestBody) {
        var requestObject = {};

        if (!empty(credentialID)) {
        	requestObject.credentialID = credentialID;
        } else {
        	throw new Error('Not valid or empty credentialID - ' + credentialID);
        }

        if (!empty(urlPath)) {
        	requestObject.urlPath = urlPath;
        } else {
        	throw new Error('Not valid or empty urlPath - ' + urlPath);
        }

        if (!empty(requestBody)) {
        	requestObject.body = requestBody;
        }

        if (!empty(httpVerb) && this.isValidHttpVerb(httpVerb)) {
            requestObject.method = httpVerb;
        }

        var result;
        try {
            result = klarnaService.call(requestObject);
        } catch (ex) {
            var exception = ex;
            this._logger.error(exception.message);
        }

        this.logResponseData(urlPath, httpVerb, requestBody, result);
        this.detectErrorResponse(result, httpVerb, klarnaService.URL, requestBody);

        return result.object;
    },

    this.isValidHttpVerb = function(httpVerb) {
    	var validHttpVerbs = ['GET', 'PUT', 'POST',  'DELETE', 'PATCH'];
    	
    	if (validHttpVerbs.indexOf(httpVerb) !== -1) {
    		return true;
    	}
    	throw new Error('Not valid HTTP verb defined - ' + httpVerb);
    },

    this.detectErrorResponse = function(result, httpVerb, requestUrl, requestBody) {
        if (empty(result)) {
            this._logger.error('result was empty');
            throw new Error(this.getErrorResponse('default'));
        }
        else if (result.error != 0 || result.status == 'ERROR' || result.status == "SERVICE_UNAVAILABLE") {
            this.logErrorResponse(result, requestUrl, requestBody);
            throw new Error(result.errorMessage);
        }
    },

    this.getErrorResponse = function(errorCode) {

        var errorResource = 'apierror.flow.' + errorCode;
        var defaultMessage = Resource.msg('apierror.flow.default', 'klarna', null);
        var errorMessage = Resource.msg(errorResource, 'klarna', defaultMessage);

        if (!empty(errorMessage)) {
            return errorMessage;
        }
        else {
            return defaultMessage;
        }
    },

    this.logErrorResponse = function(result, requestUrl, requestBody) {

        var content = 'result.error=[' + result.error;
        content += '], result.status=[' + result.status;
        content += '], result.errorMessage=[' + result.errorMessage + ']';

        if (!empty(result.object) && !empty(result.object.text)) {
            content += '], result.object.text=[' + result.object.text + ']';
        }

        if (!empty(requestUrl)) {
            content += ', requestUrl=[' + requestUrl + ']';
        }

        if (!empty(requestBody)) {
            content += ', requestBody=[' + JSON.stringify(requestBody) + ']';
        }

        this._logger.error(content);
    },

    this.logResponseData = function(urlPath, httpVerb, requestBody, result) {

        try {
            var message = '';
            var requestBodyJson = JSON.stringify(requestBody);

            if (!empty(result.object)) {
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

        	this._logger.info(message);

        } catch (e) {
            var exception = e;
            this._logger.error(exception);
        }
    }
};

module.exports = KlarnaHttpService;
