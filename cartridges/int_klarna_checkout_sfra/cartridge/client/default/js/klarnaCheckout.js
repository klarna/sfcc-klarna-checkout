/* eslint no-underscore-dangle: 0 */

(function ($) {
    var $checkoutMain = $('#checkout-main');
    var $shippingMethodList = $('#shipping-method-list');

    /**
	 * @function
	 * @description Adds appends param to an url
     * @param {string} url the url
     * @param {string} name  param name
     * @param {string} value param value
     * @returns {string} the builded url
	 */
    function appendParamToURL(url, name, value) {
        if (url.indexOf(name + '=') !== -1) {
            return url;
        }

        var separator = url.indexOf('?') !== -1 ? '&' : '?';
        return url + separator + name + '=' + encodeURIComponent(value);
    }

    /**
	 * @function
	 * @description Adds given params to an url
     * @param {string} url the url
     * @param {Object} params  the params to append to the url
     * @returns {string} the builded url
	 */
    function appendParamsToUrl(url, params) {
        var newUrl = url;
        Object.keys(params).forEach(function (name) {
            var value = params[name];
            newUrl = appendParamToURL(newUrl, name, value);
        });

        return newUrl;
    }

    /**
	 * @function
	 * @description pause Klarna Checkout
	 */
    function suspendKlarna() {
        window._klarnaCheckout(function (api) {
            api.suspend();
        });
    }

    /**
	 * @function
	 * @description resume Klarna Checkout
	 */
    function resumeKlarna() {
        window._klarnaCheckout(function (api) {
            api.resume();
        });
    }

    /**
	 * @function
	 * @description updates the Klarna order with the new shipping method
	 */
    function updateKlarna() {
        $.ajax({
            url: $checkoutMain.data('update-klarna')
        }).done(function () {
            resumeKlarna();
        });
    }

    /**
	 * @function
	 * @description updates the totals summary
	 * @param {Array} totals - the totals data
	 */
    function updateTotals(totals) {
        $('.shipping-total-cost').text(totals.totalShippingCost);
        $('.tax-total').text(totals.totalTax);
        $('.sub-total').text(totals.subTotal);
        $('.grand-total-sum').text(totals.grandTotal);

        if (totals.orderLevelDiscountTotal.value > 0) {
            $('.order-discount').show();
            $('.order-discount-total').text('- ' + totals.orderLevelDiscountTotal.formatted);
        } else {
            $('.order-discount').hide();
        }

        if (totals.shippingLevelDiscountTotal.value > 0) {
            $('.shipping-discount').show();
            $('.shipping-discount-total').text('- ' +
                totals.shippingLevelDiscountTotal.formatted);
        } else {
            $('.shipping-discount').hide();
        }
    }

    /**
     * @function
     * @description selects a shipping method for the default shipment and updates the summary section on the right hand side
     * @param {string} shippingMethodID the id of the shipping method
     */
    function selectShippingMethod(shippingMethodID) {
        if (!shippingMethodID) {
            return;
        }

        var url = appendParamToURL($checkoutMain.data('select-shipping'), 'shippingMethodID', shippingMethodID);
        $.ajax({
            url: url
        }).done(function (data) {
            if (!data.success) {
                return false;
            }

            if (data.redirect) {
                window.location = data.redirect;
                return false;
            }

            if ($shippingMethodList.length > 0) {
                updateKlarna();
            }

            updateTotals(data.order.totals);
            return true;
        });
    }

    /**
	 * @function
	 * @description updates the shipping methods
	 * @param {Object} address current shipping address
	 */
    function updateShippingMethods(address) {
        var data = address;
        data.format = 'ajax';

        var url = appendParamsToUrl($shippingMethodList.data('update-shippingmethods'), data);

        $.ajax({
            url: url
        }).done(function (res) {
            if (!res.success) {
                return false;
            }

            $shippingMethodList.html(res.shippingMethodsHtml);

            // if nothing is selected in the shipping methods select the first one
            if ($shippingMethodList.find('.form-check-input:checked').length === 0) {
                $shippingMethodList.find('.form-check-input:first').prop('checked', 'checked');
            }

            updateKlarna();
            updateTotals(res.order.totals);
            return true;
        });
    }

    /**
     * @function
     * @description updates shipment shipping address and updates the summary section on the right hand side
     * @param {Object} address the new shipping address
     */
    function updateShipmentShippingAddress(address) {
        if (!address) {
            return;
        }

        var url = appendParamsToUrl($checkoutMain.data('update-address'), address);
        $.ajax({
            url: url
        }).done(function (data) {
            if (!data.success) {
                return false;
            }

            if (data.redirect) {
                window.location = data.redirect;
                return false;
            }

            suspendKlarna();

            if ($shippingMethodList.length > 0 && data.address) {
                updateShippingMethods(data.address);
            } else {
                updateKlarna();
                updateTotals(data.order.totals);
            }
            return true;
        });
    }

    // Update Klarna Checkout when a shipping method is selected or the delivery address is changed
    $('body').on('change', "input[name='shipping_method']", function () {
        suspendKlarna();
        selectShippingMethod($(this).val());
    });

    if (window._klarnaCheckout) {
        window._klarnaCheckout(function (api) {
            api.on({
                shipping_option_change: function (data) {
                    if (data.id) {
                        selectShippingMethod(data.id);
                    }
                },
                shipping_address_change: function (data) {
                    if (data) {
                        updateShipmentShippingAddress(data);
                    }
                }
            });
        });
    }
}(window.jQuery));
