/*
 * Purpose: Turn a count of hours into the phrase an Indonesian operator or buyer would say.
 * Caller: admin playback-product catalogue, public access panel.
 * Deps: none — pure.
 * MainFuncs: hoursToText.
 * SideEffects: None.
 *
 * Extracted because the same number is now printed in three places that must agree: the package
 * card, the coverage summary above it, and the buy card on the public page. A package reading
 * "30 hari" beside a coverage note reading "56 jam" would look like two unrelated facts.
 */

/**
 * @param {number|null|undefined} hours
 * @returns {string} e.g. "4 jam", "2 hari", "-" when there is nothing to say
 *
 * Days only once it is a clean multiple: 56 hours is "56 jam", not "2 hari", because rounding an
 * archive's real depth UP is the exact dishonesty this whole feature exists to prevent.
 */
export function hoursToText(hours) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return '-';
    if (h < 24 || h % 24 !== 0) return `${h} jam`;
    return `${h / 24} hari`;
}

export default hoursToText;
