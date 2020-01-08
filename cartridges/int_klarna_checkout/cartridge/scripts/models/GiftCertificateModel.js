'use strict';

/**
 * @module models/GiftCertificateModel
 */

/**
 * Create a gift certificate for a gift certificate line item in the order
 * @param {dw.order.GiftCertificateLineItem} giftCertificateLineItem the giftCertificateLineItem
 * @param {string} orderNo the order number of the order to associate gift certificate to
 * @return {dw.order.GiftCertificate} the giftCertificate
 */
function createGiftCertificateFromLineItem(giftCertificateLineItem, orderNo) {
    var GiftCertificateMgr = require('dw/order/GiftCertificateMgr');
    var giftCertificate = GiftCertificateMgr.createGiftCertificate(giftCertificateLineItem.netPrice.value);
    giftCertificate.setRecipientEmail(giftCertificateLineItem.recipientEmail);
    giftCertificate.setRecipientName(giftCertificateLineItem.recipientName);
    giftCertificate.setSenderName(giftCertificateLineItem.senderName);
    giftCertificate.setMessage(giftCertificateLineItem.message);
    giftCertificate.setOrderNo(orderNo);

    return giftCertificate;
}

/**
 * Send an email to recipient of gift certificate
 * @param {dw.order.GiftCertificate} giftCertificate the giftCertificate
 * @returns {void}
 */
function sendGiftCertificateEmail(giftCertificate) {
    var Email = require('*/cartridge/scripts/models/EmailModel');
    var Resource = require('dw/web/Resource');
    Email.sendMail({
        recipient: giftCertificate.getRecipientEmail(),
        template: 'mail/giftcert',
        subject: Resource.msg('resource.ordergcemsg', 'email', null) + ' ' + giftCertificate.getSenderName(),
        context: {
            GiftCertificate: giftCertificate
        }
    });
}

module.exports = {
    createGiftCertificateFromLineItem: createGiftCertificateFromLineItem,
    sendGiftCertificateEmail: sendGiftCertificateEmail
};
