const DEFAULT_SCHEDULED_EVENT_BANNER = {
    enabled: false,
    title: '',
    text: '',
    theme: 'neutral',
    start_at: '',
    end_at: '',
    show_in_full: true,
    show_in_simple: true,
    isActive: false,
};

const DEFAULT_SCHEDULED_ANNOUNCEMENT = {
    enabled: false,
    title: '',
    text: '',
    style: 'info',
    start_at: '',
    end_at: '',
    show_in_full: true,
    show_in_simple: true,
    isActive: false,
};

export const LANDING_SCHEDULE_RECHECK_MS = 30000;

function normalizeText(value) {
    return typeof value === 'string' ? value : '';
}

function normalizeOptionalText(value, fallback) {
    if (typeof value !== 'string') {
        return fallback;
    }

    const normalized = value.trim();
    return normalized || fallback;
}

function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function normalizeScheduleValue(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const normalized = value.trim();
    return normalized || '';
}

function parseScheduleDate(value) {
    const normalized = normalizeScheduleValue(value);
    if (!normalized) {
        return null;
    }

    const parsedAt = Date.parse(normalized);
    return Number.isFinite(parsedAt) ? parsedAt : null;
}

export function isScheduledLandingContentActive(content, now = Date.now()) {
    const text = normalizeText(content?.text).trim();
    if (!content?.enabled || !text) {
        return false;
    }

    const startsAt = parseScheduleDate(content?.start_at);
    const endsAt = parseScheduleDate(content?.end_at);

    if (startsAt !== null && now < startsAt) {
        return false;
    }

    if (endsAt !== null && now > endsAt) {
        return false;
    }

    return true;
}

export function normalizeLandingScheduledContent(content, defaults, now = Date.now()) {
    const base = {
        ...defaults,
        ...(content && typeof content === 'object' ? content : {}),
    };

    const normalized = {
        ...base,
        title: normalizeText(base.title),
        text: normalizeText(base.text),
        theme: normalizeOptionalText(base.theme, defaults.theme),
        style: normalizeOptionalText(base.style, defaults.style),
        start_at: normalizeScheduleValue(base.start_at),
        end_at: normalizeScheduleValue(base.end_at),
        show_in_full: normalizeBoolean(base.show_in_full, defaults.show_in_full),
        show_in_simple: normalizeBoolean(base.show_in_simple, defaults.show_in_simple),
        enabled: normalizeBoolean(base.enabled, defaults.enabled),
    };

    normalized.isActive = isScheduledLandingContentActive(normalized, now);
    return normalized;
}

export function normalizeLandingSettings(settings, now = Date.now()) {
    const source = settings && typeof settings === 'object' ? settings : {};

    return {
        area_coverage: normalizeText(source.area_coverage),
        hero_badge: normalizeText(source.hero_badge),
        section_title: normalizeText(source.section_title),
        eventBanner: normalizeLandingScheduledContent(
            source.eventBanner,
            DEFAULT_SCHEDULED_EVENT_BANNER,
            now
        ),
        announcement: normalizeLandingScheduledContent(
            source.announcement,
            DEFAULT_SCHEDULED_ANNOUNCEMENT,
            now
        ),
    };
}

export const DEFAULT_LANDING_SETTINGS = {
    area_coverage: 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
    hero_badge: 'LIVE STREAMING 24 JAM',
    section_title: 'CCTV Publik',
    eventBanner: DEFAULT_SCHEDULED_EVENT_BANNER,
    announcement: DEFAULT_SCHEDULED_ANNOUNCEMENT,
};
