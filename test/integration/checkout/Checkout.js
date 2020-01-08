'use strict';

var describe = require('mocha').describe;
var it = require('mocha').it;
var assert = require('chai').assert;
var request = require('request-promise');
var config = require('../it.config');


describe('Checkout-Begin', function () {
    this.timeout(25000);
    var cookieJar = request.jar();

    it('redirects to Cart-Show when basket is empty', function () {
        var checkoutRequest = {
            url: config.baseUrl + '/Checkout-Begin',
            method: 'GET',
            rejectUnauthorized: false,
            resolveWithFullResponse: true,
            jar: cookieJar,
            simple: false,
            followRedirect: false
        };
        return request(checkoutRequest)
            .then(function (response) {
                assert.equal(response.statusCode, 302);
                assert.match(response.toJSON().headers.location, /cart/, 'redirects to Cart Show');
            });
    });

    it('checks out', function () {
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
                var checkoutRequest = {
                    url: config.baseUrl + '/Checkout-Begin',
                    method: 'GET',
                    rejectUnauthorized: false,
                    resolveWithFullResponse: true,
                    jar: cookieJar
                };

                return request(checkoutRequest);
            })
            .then(function (checkoutResponse) {
                assert.equal(checkoutResponse.statusCode, 200);
                var match = checkoutResponse.body.match('/orders/(.*?)/');
                assert.isNotNull(match[1]);
            });
    });
});
