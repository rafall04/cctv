/*
 * Purpose: Turn a raw User-Agent string into something an operator can read at a glance.
 * Caller: components/admin/playback-tokens/PlaybackTokenAuditLog.jsx.
 * MainFuncs: summarizeUserAgent.
 * SideEffects: None; pure string parsing.
 *
 * WHY THIS MATTERS HERE
 * A playback token is shared — every viewer holds the SAME code. The device string is the only
 * thing that separates one viewer from another, so without it a log of 60 activations cannot tell
 * you whether that was one person reloading or fifteen people.
 *
 * WHAT THE REAL DATA LOOKS LIKE (sampled from production, and the basis of the tests)
 *   - Android often reports model "K": Chrome's UA reduction replaces the real model. Printing
 *     "Android 10 · K" is worse than printing nothing, so meaningless models are dropped.
 *   - Vendor browsers (MIUI, Vivo, Samsung) all ALSO carry "Chrome/", so they must be matched
 *     first or every Xiaomi phone is mislabelled as Chrome.
 *   - iOS Safari puts the browser version in `Version/`, not in `Safari/`.
 *   - Windows NT 10.0 covers BOTH Windows 10 and 11 — the UA genuinely cannot tell them apart, so
 *     the label says so rather than picking one and being wrong half the time.
 *   - Not every agent is a browser: `curl/7.81.0` shows up from scripts and probes.
 *
 * Anything unrecognised falls back to a trimmed raw string. A wrong guess is worse than an honest
 * "I do not know" in a log people use to work out who did what.
 */

/** Android model strings that carry no information — Chrome's UA reduction, or a WebView marker. */
const MEANINGLESS_MODELS = new Set(['k', 'wv', 'unknown', 'android', 'build']);

/**
 * Vendor browsers first: each also contains "Chrome/", so a naive Chrome check swallows them all.
 * Order within the list is significant.
 */
const BROWSERS = [
    [/EdgiOS\/([\d.]+)/, 'Edge'],
    [/EdgA\/([\d.]+)/, 'Edge'],
    [/Edg\/([\d.]+)/, 'Edge'],
    [/MiuiBrowser\/([\d.]+)/, 'MIUI Browser'],
    [/VivoBrowser\/([\d.]+)/, 'Vivo Browser'],
    [/HeyTapBrowser\/([\d.]+)/, 'Oppo Browser'],
    [/HuaweiBrowser\/([\d.]+)/, 'Huawei Browser'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/UCBrowser\/([\d.]+)/, 'UC Browser'],
    [/YaBrowser\/([\d.]+)/, 'Yandex'],
    [/OPiOS\/([\d.]+)/, 'Opera'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/FxiOS\/([\d.]+)/, 'Firefox'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
];

function majorVersion(value) {
    return String(value || '').split('.')[0] || '';
}

/** The OS half of the label, e.g. "Android 16", "iOS 18.7", "Windows 10/11". */
function describeOs(ua) {
    const android = /Android (\d+(?:\.\d+)?)/.exec(ua);
    if (android) return `Android ${android[1]}`;

    const ios = /(iPhone|iPad|iPod).*?OS (\d+)[._](\d+)/.exec(ua);
    if (ios) return `${ios[1] === 'iPad' ? 'iPadOS' : 'iOS'} ${ios[2]}.${ios[3]}`;
    if (/(iPhone|iPad|iPod)/.test(ua)) return 'iOS';

    if (/CrOS/.test(ua)) return 'ChromeOS';

    const windows = /Windows NT ([\d.]+)/.exec(ua);
    if (windows) {
        // 10.0 is Windows 10 AND Windows 11 — Microsoft never bumped it. Saying "Windows 10" would
        // be a coin flip, so the ambiguity is shown instead of hidden.
        const names = { '10.0': '10/11', 6.3: '8.1', 6.2: '8', 6.1: '7' };
        const name = names[windows[1]];
        return name ? `Windows ${name}` : 'Windows';
    }

    const mac = /Mac OS X (\d+)[._](\d+)/.exec(ua);
    if (mac) return `macOS ${mac[1]}.${mac[2]}`;
    if (/Macintosh/.test(ua)) return 'macOS';

    if (/Linux/.test(ua)) return 'Linux';
    return '';
}

/** The phone model, when Android actually reports a real one. */
function describeModel(ua) {
    // Third field of the platform parens: (Linux; Android 16; POCO F7 Build/…)
    const match = /\(Linux; Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?\)/.exec(ua);
    if (!match) return '';
    const model = match[1].trim();
    if (!model || MEANINGLESS_MODELS.has(model.toLowerCase())) return '';
    return model;
}

/** The browser or client half, e.g. "Chrome 151", "Safari 26", "curl 7.81.0". */
function describeClient(ua) {
    // An Electron app is a program, not a browser — name the app, since "Chrome" would be a lie
    // about what the person was actually using.
    if (/Electron\//.test(ua)) {
        const app = /(?:\)\s)([A-Za-z][A-Za-z0-9]*)\/[\d.]+ Chrome\//.exec(ua);
        return app ? `Aplikasi ${app[1]}` : 'Aplikasi desktop';
    }

    for (const [pattern, name] of BROWSERS) {
        const match = pattern.exec(ua);
        if (match) return `${name} ${majorVersion(match[1])}`.trim();
    }

    // iOS Safari carries its version in Version/, and has no Chrome/ token at all.
    const safari = /Version\/([\d.]+).*Safari/.exec(ua);
    if (safari) return `Safari ${majorVersion(safari[1])}`;
    if (/Safari\//.test(ua)) return 'Safari';

    // Command-line and library clients: curl/7.81.0, Wget/1.21, python-requests/2.31
    const tool = /^([A-Za-z][A-Za-z0-9_-]*)\/([\d.]+)/.exec(ua.trim());
    if (tool) return `${tool[1]} ${tool[2]}`;

    return '';
}

/**
 * Short human label for a User-Agent, or null when there is nothing to say.
 *
 * @param {string|null|undefined} userAgent
 * @returns {string|null} e.g. "Android 16 · POCO F7 · MIUI Browser"
 */
export function summarizeUserAgent(userAgent) {
    const ua = String(userAgent || '').trim();
    if (!ua) return null;

    const parts = [describeOs(ua), describeModel(ua), describeClient(ua)].filter(Boolean);
    if (parts.length) return parts.join(' · ');

    // Unrecognised: show the start of the raw string rather than invent a device. Truncated because
    // a 200-character agent would wreck the row it sits in.
    return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua;
}

export default summarizeUserAgent;
