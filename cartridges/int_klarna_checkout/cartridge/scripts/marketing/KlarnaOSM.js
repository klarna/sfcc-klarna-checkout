'use strict';

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Locale = require('dw/util/Locale');

/**
 * Klarna On-Site Messaging Component
 */
var KlarnaOSM = {
    klarnaCountriesObject: null,
    getCountryCode: function () {
        var requestLocale = Locale.getLocale(request.locale); // eslint-disable-line no-undef
        var countryCode = requestLocale.country;
        return countryCode;
    },
    loadKlarnaCountriesObject: function () {
        var countryCode = this.getCountryCode();
        var localeObject = CustomObjectMgr.getCustomObject('KlarnaCountries', countryCode);

        return localeObject;
    },
    getKlarnaCountriesObject: function () {
        if (!this.klarnaCountriesObject) {
            this.klarnaCountriesObject = this.loadKlarnaCountriesObject();
        }

        return this.klarnaCountriesObject;
    },
    isEnabled: function () {
        return (this.isEnabledCartPage() || this.isEnabledPDPPage());
    },
    isEnabledCartPage: function () {
        var localeObject = this.getKlarnaCountriesObject();
        var value = localeObject.custom.osmCartEnabled;

        return value;
    },
    getCartPagePlacementTagId: function () {
        var localeObject = this.getKlarnaCountriesObject();
        var value = localeObject.custom.osmCartTagId;

        return value;
    },
    isEnabledPDPPage: function () {
        var localeObject = this.getKlarnaCountriesObject();
        var value = localeObject.custom.osmPDPEnabled;

        return value;
    },
    getPDPPagePlacementTagId: function () {
        var localeObject = this.getKlarnaCountriesObject();
        var value = localeObject.custom.osmPDPTagId;

        return value;
    },
    getScriptURL: function () {
        var localeObject = this.getKlarnaCountriesObject();
        var value = localeObject.custom.osmLibraryUrl;

        return value;
    },
    formatPurchaseAmount: function (price) {
        var formattedAmount = Math.round(price.value * 100);

        return formattedAmount;
    }
};

module.exports = KlarnaOSM;
