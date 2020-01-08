'use strict';

var describe = require('mocha').describe;
var it = require('mocha').it;
var assert = require('chai').assert;
var request = require('request-promise');
var config = require('../it.config');

describe('KlarnaCheckoutServices-UpdateCheckout', function () {
    this.timeout(25000);
    var cookieJar = request.jar();

    it('redirects to Cart-Show when basket is empty', function () {
        var updateCheckoutRequest = {
            url: config.baseUrl + '/KlarnaCheckoutServices-UpdateCheckout',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            jar: cookieJar,
            followRedirect: false,
            simple: false,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            }
        };

        return request(updateCheckoutRequest)
            .then(function (response) {
                assert.equal(response.statusCode, 302);
                assert.match(response.toJSON().headers.location, /cart/, 'redirects to Cart Show');
            });
    });

    it('updates Klarna CO iFrame', function () {
        var addProductRequest = {
            url: config.baseUrl + '/Cart-AddProduct',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            jar: cookieJar,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            form: {
                pid: config.testProductId,
                quantity: 1
            }
        };

        return request(addProductRequest)
            .then(function () {
                var updateShippingMethodListRequest = {
                    url: config.baseUrl + '/CheckoutShippingServices-UpdateShippingMethodsList',
                    method: 'POST',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    jar: cookieJar,
                    form: {
                        stateCode: 'MA',
                        postalCode: '09876'
                    }
                };

                return request(updateShippingMethodListRequest);
            })
            .then(function () {
                var updateCheckoutRequest = {
                    url: config.baseUrl + '/KlarnaCheckoutServices-UpdateCheckout',
                    method: 'GET',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    jar: cookieJar,
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                };

                return request(updateCheckoutRequest);
            })
            .then(function (updateCheckoutResponse) {
                assert.equal(updateCheckoutResponse.statusCode, 200);
                assert.equal(JSON.parse(updateCheckoutResponse.body).success, true);
            });
    });
});

describe('KlarnaCheckoutServices-Update', function () {
    this.timeout(25000);

    it('updates Klarna for checkout changes', function () {
        var cookieJar = request.jar();
        var klarnaUpdateOrder = require('../../mocks/klarnaOrder').klarnaOrderMock;

        var updateCheckoutRequest = {
            url: config.baseUrl + '/KlarnaCheckoutServices-Update',
            method: 'POST',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            jar: cookieJar,
            body: klarnaUpdateOrder,
            headers: {
                'X-Requested-With': 'XMLHttpRequest'
            },
            json: true
        };

        return request(updateCheckoutRequest)
            .then(function (updateCheckoutResponse) {
                assert.equal(updateCheckoutResponse.statusCode, 200);

                var body = updateCheckoutRequest.body;
                var physicalProduct = body.order_lines.filter(function (item) {
                    return item.type === 'physical';
                })[0];

                assert.equal(physicalProduct.reference, config.testProductId);
            });
    });
});
