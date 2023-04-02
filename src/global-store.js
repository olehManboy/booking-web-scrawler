const { GlobalStore } = require('apify-global-store');
const { REVIEWS_ON_DETAIL_PAGE, REVIEWS_RESULTS_PER_REQUEST } = require('./consts');

module.exports.initializeGlobalStore = async (maxPages, maxReviews) => {
    let reviewsRoundedUpToPages = maxReviews;

    while (reviewsRoundedUpToPages % REVIEWS_RESULTS_PER_REQUEST !== 0) {
        reviewsRoundedUpToPages++;
    }

    // If we only want to scrape REVIEWS_ON_DETAIL_PAGE reviews from a detail page, we will set maxReviewsPages to 0
    const maxReviewsPages = maxReviews > REVIEWS_ON_DETAIL_PAGE
        ? reviewsRoundedUpToPages / REVIEWS_RESULTS_PER_REQUEST
        : 0;

    const store = await GlobalStore.init({
        initialState: {
            remainingPages: maxPages,
            maxReviews,
            maxReviewsPages,
            details: {},
            reviewPagesToProcess: {},
            crawledNames: [],
            enqueuedUrls: [],
        },
    });

    return store;
};

module.exports.decrementRemainingPages = () => {
    const store = GlobalStore.summon();
    const remainingPages = store.state.remainingPages - 1;

    store.setPath('remainingPages', remainingPages);
};

module.exports.addDetail = (detailPagename, detail) => {
    const store = GlobalStore.summon();
    const { details } = store.state;

    /**
     * We cannot use raw url directly as the key. We use detailPagename
     * to ensure that store.pushPathToDataset is working correctly
     * (urls include '.html' substring which is interpreted as
     * another nested field named 'html')
     */
    const updatedDetails = {
        ...details,
        [detailPagename]: detail,
    };

    store.setPath('details', updatedDetails);
};

module.exports.addReviews = (detailPagename, reviews) => {
    const store = GlobalStore.summon();

    const detail = store.state.details[detailPagename];
    const detailReviews = detail.userReviews || [];

    const updatedReviews = [
        ...detailReviews,
        ...reviews,
    ];

    store.setPath(`details.${detailPagename}.userReviews`, updatedReviews);
};

module.exports.sliceReviews = (detailPagename, reviewsCount) => {
    const store = GlobalStore.summon();

    const detail = store.state.details[detailPagename];
    const detailReviews = detail.userReviews || [];

    const updatedReviews = detailReviews.slice(0, reviewsCount);

    store.setPath(`details.${detailPagename}.userReviews`, updatedReviews);
};

module.exports.setReviewUrlsToProcess = (detailPagename, reviewUrls) => {
    const store = GlobalStore.summon();

    store.setPath(`reviewPagesToProcess.${detailPagename}`, reviewUrls);
};

module.exports.removeProcessedReviewUrl = (detailPagename, reviewUrl) => {
    const store = GlobalStore.summon();
    const { state: { reviewPagesToProcess } } = store;

    const updatedReviewUrls = reviewPagesToProcess[detailPagename]
        .filter((url) => url !== reviewUrl);

    store.setPath(`reviewPagesToProcess.${detailPagename}`, updatedReviewUrls);
};

module.exports.addCrawledName = (crawledName) => {
    const store = GlobalStore.summon();
    const { state: { crawledNames } } = store;

    const updatedCrawledNames = [
        ...crawledNames,
        crawledName,
    ];

    store.setPath('crawledNames', updatedCrawledNames);
};

module.exports.addEnqueuedUrl = (enqueuedUrl) => {
    const store = GlobalStore.summon();
    const { state: { enqueuedUrls } } = store;

    const updatedEnqueuedUrls = [
        ...enqueuedUrls,
        enqueuedUrl,
    ];

    store.setPath('enqueuedUrls', updatedEnqueuedUrls);
};

/**
 *
 * @returns {number}
 */
module.exports.getRemainingPages = () => {
    const store = GlobalStore.summon();

    return store.state.remainingPages;
};

/**
 *
 * @returns {number}
 */
module.exports.getMaxReviewsPages = () => {
    const store = GlobalStore.summon();

    return store.state.maxReviewsPages;
};

/**
 *
 * @returns {string[]}
 */
module.exports.getEnqueuedUrls = () => {
    const store = GlobalStore.summon();

    return store.state.enqueuedUrls;
};

/**
 *
 * @returns {string[]}
 */
module.exports.getCrawledNames = () => {
    const store = GlobalStore.summon();

    return store.state.crawledNames;
};
