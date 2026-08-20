/*
 * Purpose: Decide whether an operator-supplied OUTBOUND link (an affiliate partner's shop or
 *          product page) is safe to store, and safe to hand a visitor's browser as a 302.
 * Caller: affiliateOfferService — on write (create/update partner + offer) and again on read
 *         (the /go redirector re-validates whatever the row actually holds today).
 * Deps: WHATWG URL (Node global). No I/O, no DB, no env.
 * MainFuncs: isSafeOutboundUrl, assertSafeOutboundUrl.
 * SideEffects: None. Pure functions.
 *
 * WHY A PARSER AND NOT A REGEX
 * ----------------------------
 * The consumer of this value is a browser following `Location:`. A `^https://` prefix test
 * agrees with a human reading the string but NOT with the browser: it happily passes
 * `https://toko-asli.example@evil.test` (real host: evil.test), or a string carrying a raw
 * newline. The only check that cannot disagree with the consumer is the same WHATWG
 * algorithm the consumer runs — `new URL()`. Modelled on utils/rtspUrlPolicy.js, which
 * parses for the same reason.
 *
 * WHY EXACTLY 'https:' AND NOTHING ELSE
 * -------------------------------------
 * A 302 from this domain is this domain vouching for the destination. `http:` would put a
 * visitor of a public-institution-adjacent site onto plaintext; and a non-http scheme in a
 * Location header (`javascript:`, `data:`, `intent://`, `market://`, `tel:`) hands the
 * visitor's browser or an installed app a payload that arrives under our name. No partner
 * shop needs any of those, so the allow-list is one entry long.
 *
 * WHY CREDENTIALS ARE REJECTED
 * ----------------------------
 * `https://tokopedia.example@evil.test/x` reads as the trusted brand to the admin approving
 * the deal in the panel, and resolves to evil.test in the browser. The point of the admin
 * review is that what was reviewed is what ships, so a URL whose apparent host and real host
 * differ is refused rather than normalised.
 *
 * WHY THE RAW STRING IS SCANNED FOR CONTROL CHARS AND SPACES
 * ----------------------------------------------------------
 * `new URL()` SILENTLY STRIPS tab/CR/LF from anywhere in the input before parsing. So a
 * stored string of `https://toko-asli.example` + newline + `.evil.test` parses to host
 * `toko-asli.example.evil.test` — parser and reviewing human end up with two different
 * destinations from one string. Outer whitespace is trimmed (a textarea paste is not an
 * attack); anything left at or below 0x20, plus 0x7F, is a refusal, not a repair.
 *
 * WHY A CHAR-CODE LOOP AND NOT A CHARACTER-CLASS REGEX
 * ----------------------------------------------------
 * Spelling that class needs `\u`-escapes, and an escape is one careless bulk edit away from
 * becoming the literal control byte it denotes — at which point the class silently turns into
 * a range that matches every ASCII character and this policy rejects every URL. (The repo has
 * already paid for that lesson once: guardrails.test.js scans these folders byte-level for
 * literal-vs-escape corruption after a bulk edit mangled 32 files.) A charCodeAt loop has no
 * escapes to corrupt and states the bound in numbers.
 *
 * WHY THERE IS DELIBERATELY NO PRIVATE-IP / SSRF BLOCKLIST HERE
 * -------------------------------------------------------------
 * rtspUrlPolicy blocks loopback and link-local because THE BACKEND dials that host — the
 * customer's string becomes our outbound TCP connection, a textbook SSRF primitive. Nothing
 * in this feature ever fetches an affiliate URL: the backend only echoes it into a Location
 * header and the visitor's own browser does the fetching, from the visitor's own network.
 * Copying the rtsp blocklist over here would protect nobody, and would quietly break an
 * operator whose shop sits behind a hostname that resolves privately. Do not add it back
 * without a caller that actually opens the socket.
 */

const MAX_URL_LENGTH = 1000;

// C0 controls and space (<= 0x20) plus DEL (0x7F). See the WHY above for the numbers.
const MAX_FORBIDDEN_LOW_CODE = 0x20;
const DEL_CODE = 0x7F;

function hasForbiddenChar(value) {
    for (let i = 0; i < value.length; i += 1) {
        const code = value.charCodeAt(i);
        if (code <= MAX_FORBIDDEN_LOW_CODE || code === DEL_CODE) {
            return true;
        }
    }
    return false;
}

/**
 * Single evaluator behind both public functions, so the boolean and the thrown 400 can never
 * disagree about what "safe" means.
 *
 * @param {*} value raw operator input
 * @returns {{ok: boolean, url?: string, message?: string}}
 */
function inspectOutboundUrl(value) {
    if (typeof value !== 'string') {
        return { ok: false, message: 'wajib diisi' };
    }

    const url = value.trim();
    if (!url) {
        return { ok: false, message: 'wajib diisi' };
    }
    if (url.length > MAX_URL_LENGTH) {
        return { ok: false, message: `maksimal ${MAX_URL_LENGTH} karakter` };
    }
    if (hasForbiddenChar(url)) {
        return { ok: false, message: 'tidak boleh memuat spasi atau karakter kontrol' };
    }

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, message: 'formatnya tidak valid' };
    }

    if (parsed.protocol !== 'https:') {
        return { ok: false, message: 'harus diawali https://' };
    }
    if (parsed.username || parsed.password) {
        return { ok: false, message: 'tidak boleh memuat username/password' };
    }
    if (!parsed.hostname) {
        return { ok: false, message: 'harus memuat nama domain' };
    }

    return { ok: true, url };
}

/**
 * @param {*} value
 * @returns {boolean} true when `value` may be stored and redirected to.
 */
export function isSafeOutboundUrl(value) {
    return inspectOutboundUrl(value).ok;
}

/**
 * Validating form of the above, for write paths.
 *
 * @param {*} value raw operator input
 * @param {string} label field name used in the operator-facing message, e.g. 'URL produk'
 * @returns {string} the TRIMMED url — callers must store this return value, not their own
 *                   input, so the stored row is byte-identical to what was validated
 * @throws {Error} with statusCode 400
 */
export function assertSafeOutboundUrl(value, label = 'URL') {
    const result = inspectOutboundUrl(value);
    if (!result.ok) {
        const err = new Error(`${label} ${result.message}`);
        err.statusCode = 400;
        throw err;
    }
    return result.url;
}

export default { isSafeOutboundUrl, assertSafeOutboundUrl };
