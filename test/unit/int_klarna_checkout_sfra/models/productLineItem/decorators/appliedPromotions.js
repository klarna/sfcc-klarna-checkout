'use strict';

var assert = require('chai').assert;
var proxyquire = require('proxyquire').noCallThru().noPreserveCache();
var collections = require('../../../../../mocks/collections');
var ArrayList = require('../../../../../mocks/dw.util.Collection');
var describe = require('mocha').describe;
var it = require('mocha').it;

describe('product line item applied promotions decorator', function () {
    var appliedPromotions = proxyquire('../../../../../../cartridges/int_klarna_checkout_sfra/cartridge/models/productLineItem/decorators/appliedPromotions', {
        '*/cartridge/scripts/util/collections': collections
    });

    it('should create a property on the passed in object called appliedPromotions', function () {
        var object = {};

        var promotionMock = {
            promotion: {
                calloutMsg: {
                    markup: 'someCallOutMsg'
                },
                name: 'somePromotionName',
                details: {
                    markup: 'someDetails'
                }
            }
        };

        var lineItemMock = { priceAdjustments: new ArrayList([promotionMock]) };
        appliedPromotions(object, lineItemMock);

        assert.equal(object.appliedPromotions.length, 1);
        assert.equal(object.appliedPromotions[0].callOutMsg, 'someCallOutMsg');
        assert.equal(object.appliedPromotions[0].name, 'somePromotionName');
        assert.equal(object.appliedPromotions[0].details, 'someDetails');
    });

    it('should handle no applied promotions', function () {
        var object = {};

        var lineItemMock = { priceAdjustments: new ArrayList([]) };
        appliedPromotions(object, lineItemMock);

        assert.equal(object.appliedPromotions, undefined);
    });

    it('should handle no callout message', function () {
        var object = {};

        var promotionMock = {
            promotion: {
                name: 'somePromotionName',
                details: {
                    markup: 'someDetails'
                }
            }
        };

        var lineItemMock = { priceAdjustments: new ArrayList([promotionMock]) };
        appliedPromotions(object, lineItemMock);

        assert.equal(object.appliedPromotions.length, 1);
        assert.equal(object.appliedPromotions[0].callOutMsg, '');
        assert.equal(object.appliedPromotions[0].name, 'somePromotionName');
        assert.equal(object.appliedPromotions[0].details, 'someDetails');
    });

    it('should handle no details', function () {
        var object = {};

        var promotionMock = {
            promotion: {
                calloutMsg: {
                    markup: 'someCallOutMsg'
                },
                name: 'somePromotionName'
            }
        };

        var lineItemMock = { priceAdjustments: new ArrayList([promotionMock]) };
        appliedPromotions(object, lineItemMock);

        assert.equal(object.appliedPromotions.length, 1);
        assert.equal(object.appliedPromotions[0].callOutMsg, 'someCallOutMsg');
        assert.equal(object.appliedPromotions[0].name, 'somePromotionName');
        assert.equal(object.appliedPromotions[0].details, '');
    });

    it('should have an empty callout message and details if no promotion is available', function () {
        var object = {};

        var lineItemMock = { priceAdjustments: new ArrayList([{}]) };
        appliedPromotions(object, lineItemMock);

        assert.equal(object.appliedPromotions.length, 1);
        assert.equal(object.appliedPromotions[0].callOutMsg, '');
        assert.equal(object.appliedPromotions[0].details, '');
    });
});
