/**
 * Purpose: ONE canonical form for Indonesian phone numbers — '0xxx' (leading zero).
 * Caller: billingPlanService.registerCustomer, userService create/update, voucherService,
 *         playbackOrderService (store + recovery match), zz_*_canonicalize_phone migration.
 * Deps: none.
 * MainFuncs: normalizePhone, phoneLookupVariants.
 *
 * WHY: '0812x', '62812x', '+62812x' used to be three different strings in users.phone, so the
 * "one phone = one account" anti-trial-abuse check was bypassable by reformatting. Canonical
 * form is '0xxx' — the convention voucherService already established — and lookups match the
 * canonical plus its plausible legacy spellings so old rows still resolve.
 */

const ID_MOBILE = /^08\d{7,12}$/;

/**
 * Canonicalize to '0xxx'. Returns null for empty input; returns the cleaned string verbatim
 * when it is not a recognizable Indonesian mobile (never destroys a foreign/other number).
 * @param {string|null|undefined} phone
 * @returns {string|null}
 */
export function normalizePhone(phone) {
    if (phone === null || phone === undefined) return null;
    let clean = String(phone).replace(/[\s-]/g, '');
    if (!clean) return null;
    clean = clean.replace(/^\+62/, '0').replace(/^62/, '0');
    return clean || null;
}

/**
 * Is this a valid Indonesian mobile in canonical form? Registration validates with this BEFORE
 * storing so the unique index only ever sees real mobiles.
 * @param {string|null} phone
 * @returns {boolean}
 */
export function isValidIdMobile(phone) {
    return typeof phone === 'string' && ID_MOBILE.test(phone);
}

/**
 * All spellings a canonical '0xxx' number may have been stored under before normalization —
 * '0xxx', '62xxx', '+62xxx'. Lookups match `IN (variants)` so a legacy row still counts as
 * "already registered" until the migration rewrites it.
 * @param {string|null} phone - any phone input (canonicalized internally)
 * @returns {string[]} deduped candidate values for an IN (...) clause
 */
export function phoneLookupVariants(phone) {
    const canonical = normalizePhone(phone);
    if (!canonical || !canonical.startsWith('0')) {
        return canonical ? [canonical] : [];
    }
    const rest = canonical.slice(1);
    return [...new Set([canonical, `62${rest}`, `+62${rest}`])];
}
