/* eslint no-underscore-dangle: 0 */

(function ($) {
    var klarnaUrls = window.KlarnaUrls;

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
	 * @description shows loading spinner
     * @param {jQuery} target where to append the spinner
	 */
    function showProgress(target) {
        var $loader = $('.loader');

        if ($loader.length === 0) {
            $loader = $('<div/>').addClass('loader')
                .append($('<div/>').addClass('loader-indicator'), $('<div/>').addClass('loader-bg'));
        }

        $loader.appendTo(target).show();
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
            url: klarnaUrls.klarnaUpdate
        }).done(function () {
            resumeKlarna();
        });
    }

    /**
     * @function
     * @description updates the order summary based on a possibly recalculated basket
     */
    function updateSummary() {
        var $summary = $('#secondary.summary');
        // indicate progress
        showProgress($summary);

        // load the updated summary area
        $summary.load(window.KlarnaUrls.updateSummary, function () {
            // hide edit shipping method link
            $summary.fadeIn('fast');
            $summary.find('.checkout-mini-cart .minishipment .header a').hide();
            $summary.find('.order-totals-table .order-shipping .label a').hide();
        });
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

        var url = appendParamToURL(klarnaUrls.selectShippingMethod, 'shippingMethodID', shippingMethodID);
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

            if ($('#shipping-method-list').length > 0) {
                updateKlarna();
            }

            updateSummary();
            return true;
        });
    }

    /**
	 * @function
	 * @description updates the shipping methods
	 * @param {Object} address current shipping address
	 */
    function updateShippingMethods(address) {
        var $shippingMethodList = $('#shipping-method-list');
        var url = appendParamsToUrl(klarnaUrls.updateShippingMethodList, address);

        showProgress($shippingMethodList);
        $.ajax({
            url: url
        }).done(function (data) {
            $shippingMethodList.html(data);

            // if nothing is selected in the shipping methods select the first one
            if ($shippingMethodList.find('.input-radio:checked').length === 0) {
                $shippingMethodList.find('.input-radio:first').prop('checked', 'checked');
            }
            updateKlarna();
            updateSummary();
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

        var url = appendParamsToUrl(klarnaUrls.updateShippingAddress, address);
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

            if ($('#shipping-method-list').length > 0 && data.address) {
                updateShippingMethods(data.address);
            } else {
                updateKlarna();
                updateSummary();
            }
            return true;
        });
    }

    // Update Klarna Checkout when a shipping method is selected
    $('body').on('change', "input[name$='_shippingMethodID']", function () {
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
