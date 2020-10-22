'use strict';

/**
 * Script to process VCN orders with status 'Exported' and remove sensitive card details from server
 */

/* API Includes */
const Status = require('dw/system/Status');
const Logger = require('dw/system/Logger');
const Transaction = require('dw/system/Transaction');

exports.execute = function (parameters) {
    var ordersIterator;
    try {
        var siteID = dw.system.Site.getCurrent().getID();
        ordersIterator = dw.object.SystemObjectMgr.querySystemObjects('Order', 'exportStatus = {0} AND custom.kcIsVCN = {1} ' +
                'AND custom.kcVCNPAN != NULL', 'creationDate asc', dw.order.Order.EXPORT_STATUS_EXPORTED, true);

        if (ordersIterator.getCount() > 0) {
            while (ordersIterator.hasNext()) {
                var order = ordersIterator.next();

                Transaction.wrap(function() {
                    order.custom.kcVCNPAN = null;
                    order.custom.kcVCNCSC = null;
                    order.custom.kcVCNExpirationMonth = null;
                    order.custom.kcVCNExpirationYear = null;
                });
            }

            Logger.debug('[' + siteID + '] Orders processed: ' + ordersIterator.getCount());
        } else {
            Logger.debug('[' + siteID + '] No orders require processing');
        }
    } catch (e) {
        Logger.error('Error: {0}', e.message + e.stack);
        return new Status(Status.ERROR);
    }  finally {
        if (ordersIterator) {
            try {
                ordersIterator.close();
            } catch (e) {
                Logger.error('Failed to close seekable iterator.');
            }
        }
    }

    return new Status(Status.OK);
};