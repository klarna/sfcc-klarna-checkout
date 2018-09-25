'use strict';

/**
 * Builds Extra Merchant Data
 * This is a sample script to help you develop your own extra merchant data.
 *
 * @param {Object} args aguments object
 * @return {string} EMD as JSON string
 */
function BuildEMD(args) {
    var LineItemCtnr = args.LineItemCtnr;
    var orderCustomer = LineItemCtnr.getCustomer();
    var body = {};

    body.customer_account_info = new Array({});

    if (orderCustomer.registered) {
        body.customer_account_info[0].unique_account_identifier = orderCustomer.profile.customerNo;
        body.customer_account_info[0].account_registration_date = orderCustomer.profile.creationDate ? orderCustomer.profile.creationDate.toISOString().slice(0, -5) + 'Z' : '';
        body.customer_account_info[0].account_last_modified = orderCustomer.profile.lastModified ? orderCustomer.profile.lastModified.toISOString().slice(0, -5) + 'Z' : '';
    }

    body.purchase_history_full = new Array({});
    body.purchase_history_full[0].unique_account_identifier = orderCustomer.ID;
    body.purchase_history_full[0].payment_option = 'other';

    if (orderCustomer.getActiveData()) {
        body.purchase_history_full[0].number_paid_purchases = orderCustomer.activeData.orders ? orderCustomer.activeData.orders : 0;
        body.purchase_history_full[0].total_amount_paid_purchases = orderCustomer.activeData.orderValue ? orderCustomer.activeData.orderValue : 0;
        body.purchase_history_full[0].date_of_last_paid_purchase = orderCustomer.activeData.lastOrderDate ? orderCustomer.activeData.lastOrderDate.toISOString().slice(0, -5) + 'Z' : '';
        body.purchase_history_full[0].date_of_first_paid_purchase = '';
    }

    return JSON.stringify(body);
}

/**
 * Module exports
 */
exports.BuildEMD = BuildEMD;
