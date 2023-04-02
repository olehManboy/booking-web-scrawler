const Apify = require('apify');
const Puppeteer = require('puppeteer'); // eslint-disable-line
const moment = require('moment');

const { GlobalStore } = require('apify-global-store');
const {
    DATE_FORMAT,
    PROPERTY_TYPE_IDS,
    PLACE_URL_NAME_REGEX,
    LOCALIZATION_REGEX,
} = require('./consts');
const { sliceReviews } = require('./global-store');

const { log } = Apify.utils;

/**
 * @param {Puppeteer.ElementHandle} element
 * @param {string} attr
 * @param {any} [fallback]
 * @returns {Promise<string>}
 */
const getAttribute = async (element, attr, fallback = '') => {
    try {
        const prop = await element.getProperty(attr);
        return (await prop.jsonValue()).trim();
    } catch (e) {
        return fallback;
    }
};

module.exports.getAttribute = getAttribute;

/**
 * Adds URL parameters to a Booking.com Hotel Detail URL (timespan, language and currency).
 * @param {string} url - Booking.com URL to add the parameters to.
 * @param {Object} input - The Actor input data object.
 */
const addUrlParametersForHotelDetailUrl = (url, input) => {
    const { currency, language, checkIn, checkOut, adults, children, rooms } = input;
    if (checkIn && checkOut) {
        const ci = checkIn.split(/-|\//);
        const co = checkOut.split(/-|\//);

        const coAdd = `;checkout=${co[0]}-${co[1]}-${co[2]}`;
        const ciAdd = `;checkin=${ci[0]}-${ci[1]}-${ci[2]}`;

        if (url.includes(';checkin=')) {
            url = url.replace(/;checkin=[\d-]*/, ciAdd);
        } else {
            url = url.replace(';', `${ciAdd};`);
        }

        if (url.includes(';checkout=')) {
            url = url.replace(/;checkout=[\d-]*/, coAdd);
        } else {
            url = url.replace(';', `${coAdd};`);
        }
    }

    if (currency) {
        const curAdd = `;selected_currency=${currency.toUpperCase()};changed_currency=1;top_currency=1`;
        if (url.includes(';selected_currency=')) {
            url = url.replace(/;selected_currency=\w*/, `;selected_currency=${currency.toUpperCase()}`);
        } else {
            url = url.replace(';', `${curAdd};`);
        }
    }

    if (language) {
        const lng = language.replace('_', '-');
        const lngAdd = `;lang=${lng}`;

        if (url.includes(';lang=')) {
            url = url.replace(/;lang=[\w-]*/, lngAdd);
        } else {
            url = url.replace(';', `${lngAdd};`);
        }
    }

    if (adults) {
        const adAdd = `;group_adults=${adults}`;

        if (url.includes(';group_adults=')) {
            url = url.replace(/;group_adults=\d*/, adAdd);
        } else {
            url = url.replace(';', `${adAdd};`);
        }
    }

    if (children) {
        const cdAdd = `;group_children=${children}`;
        if (url.includes(';group_children=')) {
            url = url.replace(/;group_children=\d*/, cdAdd);
        } else {
            url = url.replace(';', `${cdAdd};`);
        }
    }

    if (rooms) {
        const rmAdd = `;no_rooms=${rooms}`;
        if (url.includes(';no_rooms=')) {
            url = url.replace(/;no_rooms=\d*/, rmAdd);
        } else {
            url = url.replace(';', `${rmAdd};`);
        }
    }

    return url;
};

const addPropertyTypeParameter = (propertyType, queryParameters) => {
    const setParameter = propertyType && propertyType !== 'none';

    queryParameters.push({ isSet: setParameter, name: 'ht_id', value: PROPERTY_TYPE_IDS[propertyType] });
};

const addMinMaxPriceParameter = (minMaxPrice, currency, queryParameters) => {
    const setParameter = minMaxPrice && minMaxPrice !== 'none';

    if (setParameter) {
        // handles "200+" price format
        const minMaxParsed = minMaxPrice.includes('+') ? `${parseInt(minMaxPrice, 10)}-max` : minMaxPrice;

        // sets min max price using custom filter rather than pre-defined price category (categories have different ranges for some currencies)
        queryParameters.push({ isSet: setParameter, name: 'price', value: `${currency}-${minMaxParsed}-1` });
    }
};

const addCheckInCheckOutParameters = (checkIn, checkOut, queryParameters) => {
    if (checkIn && checkOut) {
        const ci = checkIn.split(/-|\//);
        const co = checkOut.split(/-|\//);

        queryParameters.push({ isSet: true, name: 'checkin', value: `${ci[0]}-${ci[1]}-${ci[2]}` });
        queryParameters.push({ isSet: true, name: 'checkout', value: `${co[0]}-${co[1]}-${co[2]}` });
    }
};

const addUrlParametersForHotelListingUrl = (url, input) => {
    const {
        currency,
        language,
        adults,
        children,
        rooms,
        minScore,
        minMaxPrice,
        propertyType,
        checkIn,
        checkOut,
    } = input;

    const extendedUrl = new URL(url);

    const queryParameters = [
        { isSet: currency, name: 'selected_currency', value: currency.toUpperCase() },
        { isSet: currency, name: 'changed_currency', value: 1 },
        { isSet: currency, name: 'top_currency', value: 1 },
        { isSet: language, name: 'lang', value: language.replace('_', '-') },
        { isSet: adults, name: 'group_adults', value: adults },
        { isSet: children, name: 'group_children', value: children },
        { isSet: rooms, name: 'no_rooms', value: rooms },
        { isSet: true, name: 'review_score', value: minScore ? parseFloat(minScore) * 10 : undefined },
    ];

    const currencyValue = extendedUrl.searchParams.get('selected_currency') || 'USD';

    addPropertyTypeParameter(propertyType, queryParameters);
    addMinMaxPriceParameter(minMaxPrice, currencyValue, queryParameters);
    addCheckInCheckOutParameters(checkIn, checkOut, queryParameters);

    queryParameters.forEach((parameter) => {
        const { isSet, name, value } = parameter;
        if (isSet && value && !extendedUrl.searchParams.has(name) && !url.includes(`nflt=${name}`)) {
            /* we need to check for url.includes besides searchParams.has because if startUrl is specified,
            it might use nflt=param_name which can not be checked by searchParams.has effectively due to URI encoding */
            extendedUrl.searchParams.set(name, value);
        }
    });

    return extendedUrl.toString();
};

/**
 * Adds URL parameters to a Booking.com URL (timespan, language and currency).
 * @param {string} url - Booking.com URL to add the parameters to.
 * @param {Object} input - The Actor input data object.
 */
const addUrlParameters = (url, input) => {
    if (url.includes('/hotel/') && url.includes(';')) {
        return addUrlParametersForHotelDetailUrl(url, input);
    }

    return addUrlParametersForHotelListingUrl(url, input);
};

module.exports.addUrlParameters = addUrlParameters;

/**
 * Creates a function to make sure the URL contains all necessary attributes from INPUT.
 * @param {string} s - The URL attribute separator (& or ;).
 */
module.exports.fixUrl = (s, input) => (href) => {
    href = href.replace(/#([a-zA-Z_]+)/g, '');
    if (input.language && href.indexOf('lang') < 0) {
        const lng = input.language.replace('_', '-');
        if (href.indexOf(s)) {
            href.replace(s, `${s}lang=${lng}${s}`);
        } else {
            href += `${s}lang=${lng}`;
        }
    }
    if (input.currency && href.indexOf('currency') < 0) {
        href += `${s}selected_currency=${input.currency.toUpperCase()}${s}changed_currency=1${s}top_currency=1`;
    }
    return href.replace(/&{n,}/g, '&').replace('?&', '?');
};

/**
 * @param {string} date
 */
module.exports.checkDate = (date) => {
    if (date) {
        const dateMatch = moment(date, DATE_FORMAT);

        if (dateMatch.format(DATE_FORMAT) !== date) {
            throw new Error(`WRONG INPUT: Date should be in format ${DATE_FORMAT}`);
        }

        /**
         * We can only compare moments as dates since there's no way to specify time in the input.
         */
        const specifiedDate = convertMomentToDate(dateMatch);
        const todayDate = convertMomentToDate(moment());

        if (specifiedDate < todayDate) {
            throw new Error(`WRONG INPUT: You can't use a date in the past: ${dateMatch.format(DATE_FORMAT)}`);
        }

        return dateMatch;
    }

    return null;
};

/**
 * Returns true if the gap between two dates is considered ok
 * for using as checkIn / checkOut dates. For larger gaps Booking
 * won't return any room results
 *
 * @param {null | moment.Moment} checkIn
 * @param {null | moment.Moment} checkOut
 */
module.exports.checkDateGap = (checkIn, checkOut) => {
    if (checkIn && checkOut) {
        if (!checkOut.isSameOrAfter(checkIn)) {
            // eslint-disable-next-line max-len
            throw new Error(
                `WRONG INPUT: checkOut ${checkOut.format(
                    DATE_FORMAT,
                )} date should be greater than checkIn ${checkIn.format(DATE_FORMAT)} date`,
            );
        }

        return checkOut.diff(checkIn, 'days', true);
    }

    return -1;
};

module.exports.isObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

/**
 *
 * @param {moment.Moment} time
 * @returns {Date}
 */
const convertMomentToDate = (time) => {
    return time.toDate().setHours(0, 0, 0, 0);
};

/**
 *
 * @param {string} detailPageUrl
 * @returns
 */
const getPagename = (detailPageUrl) => {
    const placeNameMatches = PLACE_URL_NAME_REGEX.exec(detailPageUrl);
    const placeNameMatch = placeNameMatches ? placeNameMatches[1] : '';

    return placeNameMatch;
};

module.exports.getPagename = getPagename;

const getLocalizedUrl = (url, language) => {
    const localizedUrl = language
        ? url.replace(LOCALIZATION_REGEX, `.${language}.html`)
        : url;

    return localizedUrl;
};

module.exports.getLocalizedUrl = getLocalizedUrl;

module.exports.validateProxy = (page, session, startUrls, requiredQueryParam) => {
    const pageUrl = page.url();

    if (!startUrls && pageUrl.indexOf(requiredQueryParam) < 0) {
        session.retire();
        throw new Error(`Page was not opened correctly`);
    }
};

module.exports.saveDetailIfComplete = async (detailPagename) => {
    const store = GlobalStore.summon();

    if (store.state.reviewPagesToProcess[detailPagename].length === 0) {
        sliceReviews(detailPagename, store.state.maxReviews);

        log.info('Extracted all reviews, pushing result to the dataset...', { detailPagename });
        await store.pushPathToDataset(`details.${detailPagename}`);
    }
};

module.exports.setHtmlDebugValue = async (page, valueName) => {
    if (log.getLevel() === log.LEVELS.DEBUG) {
        const html = await page.content();
        await Apify.setValue(valueName, html, { contentType: 'text/html' });
    }
};
