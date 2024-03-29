'use strict';

var collections = require('*/cartridge/scripts/util/collections');

/**
 * get the promotions applied to the product line item
 * @param {dw.order.ProductLineItem} lineItem - API ProductLineItem instance
 * @returns {Object[]|undefined} an array of objects containing the promotions applied to the
 *                               product line item.
 */
function getAppliedPromotions(lineItem) {
    var priceAdjustments;
    if (lineItem.priceAdjustments.getLength() > 0) {
        priceAdjustments = collections.map(lineItem.priceAdjustments, function (priceAdjustment) {
            return {
                callOutMsg: priceAdjustment.promotion && priceAdjustment.promotion.calloutMsg ?
                    priceAdjustment.promotion.calloutMsg.markup : '',
                name: priceAdjustment.promotion && priceAdjustment.promotion.name,
                details: priceAdjustment.promotion && priceAdjustment.promotion.details ?
                    priceAdjustment.promotion.details.markup : ''
            };
        });
    }

    return priceAdjustments;
}

module.exports = function (object, lineItem) {
    Object.defineProperty(object, 'appliedPromotions', {
        enumerable: true,
        value: getAppliedPromotions(lineItem)
    });
};
