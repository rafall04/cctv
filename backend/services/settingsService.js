import { query, queryOne, execute } from '../database/database.js';
import { getTimezone } from './timezoneService.js';

const LANDING_PAGE_KEYS = [
    'landing_area_coverage',
    'landing_hero_badge',
    'landing_section_title',
    'event_banner_enabled',
    'event_banner_title',
    'event_banner_text',
    'event_banner_theme',
    'event_banner_start_at',
    'event_banner_end_at',
    'event_banner_show_in_full',
    'event_banner_show_in_simple',
    'announcement_enabled',
    'announcement_title',
    'announcement_text',
    'announcement_style',
    'announcement_start_at',
    'announcement_end_at',
    'announcement_show_in_full',
    'announcement_show_in_simple',
];

const LANDING_PAGE_DEFAULTS = {
    area_coverage: 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
    hero_badge: 'LIVE STREAMING 24 JAM',
    section_title: 'CCTV Publik',
    eventBanner: {
        enabled: false,
        title: '',
        text: '',
        theme: 'neutral',
        start_at: '',
        end_at: '',
        show_in_full: true,
        show_in_simple: true,
        isActive: false,
    },
    announcement: {
        enabled: false,
        title: '',
        text: '',
        style: 'info',
        start_at: '',
        end_at: '',
        show_in_full: true,
        show_in_simple: true,
        isActive: false,
    },
};

function parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value === 1;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') {
            return true;
        }
        if (normalized === 'false' || normalized === '0') {
            return false;
        }
    }

    return fallback;
}

function normalizeScheduleValue(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }

    const normalized = value.trim().replace(' ', 'T');

    if (normalized.length === 16) {
        return `${normalized}:00`;
    }

    if (normalized.length === 10) {
        return `${normalized}T00:00:00`;
    }

    return normalized.slice(0, 19);
}

function getComparableNow(timezone) {
    const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}`;
}

function isScheduledContentActive(content, timezone) {
    const text = typeof content?.text === 'string' ? content.text.trim() : '';
    if (!content?.enabled || !text) {
        return false;
    }

    const now = getComparableNow(timezone);
    const start = normalizeScheduleValue(content.start_at);
    const end = normalizeScheduleValue(content.end_at);

    if (start && now < start) {
        return false;
    }

    if (end && now > end) {
        return false;
    }

    return true;
}

class SettingsService {
    getAllSettings() {
        const settings = query('SELECT * FROM settings ORDER BY key');

        const settingsObj = {};
        settings.forEach(s => {
            try {
                settingsObj[s.key] = JSON.parse(s.value);
            } catch {
                settingsObj[s.key] = s.value;
            }
        });

        return settingsObj;
    }

    getSetting(key) {
        const setting = queryOne('SELECT * FROM settings WHERE key = ?', [key]);

        if (!setting) {
            const err = new Error('Setting not found');
            err.statusCode = 404;
            throw err;
        }

        let value;
        try {
            value = JSON.parse(setting.value);
        } catch {
            value = setting.value;
        }

        return {
            key: setting.key,
            value,
            description: setting.description,
        };
    }

    updateSetting(key, value, description) {
        const existing = queryOne('SELECT * FROM settings WHERE key = ?', [key]);

        const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

        if (existing) {
            execute(
                'UPDATE settings SET value = ?, description = COALESCE(?, description), updated_at = CURRENT_TIMESTAMP WHERE key = ?',
                [valueStr, description, key]
            );
        } else {
            execute(
                'INSERT INTO settings (key, value, description) VALUES (?, ?, ?)',
                [key, valueStr, description || null]
            );
        }

        return { key, value };
    }

    getMapDefaultCenter() {
        const setting = queryOne('SELECT value FROM settings WHERE key = ?', ['map_default_center']);

        if (!setting) {
            return {
                latitude: -7.1507,
                longitude: 111.8815,
                zoom: 13,
                name: 'Bojonegoro'
            };
        }

        return JSON.parse(setting.value);
    }

    getLandingPageSettings() {
        const placeholders = LANDING_PAGE_KEYS.map(() => '?').join(', ');
        const settings = query(
            `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
            LANDING_PAGE_KEYS
        );

        const timezone = getTimezone();
        const result = {
            ...LANDING_PAGE_DEFAULTS,
            eventBanner: { ...LANDING_PAGE_DEFAULTS.eventBanner },
            announcement: { ...LANDING_PAGE_DEFAULTS.announcement },
        };

        settings.forEach((setting) => {
            if (setting.key === 'landing_area_coverage') result.area_coverage = setting.value;
            if (setting.key === 'landing_hero_badge') result.hero_badge = setting.value;
            if (setting.key === 'landing_section_title') result.section_title = setting.value;

            if (setting.key === 'event_banner_enabled') result.eventBanner.enabled = parseBoolean(setting.value);
            if (setting.key === 'event_banner_title') result.eventBanner.title = setting.value;
            if (setting.key === 'event_banner_text') result.eventBanner.text = setting.value;
            if (setting.key === 'event_banner_theme') result.eventBanner.theme = setting.value || 'neutral';
            if (setting.key === 'event_banner_start_at') result.eventBanner.start_at = normalizeScheduleValue(setting.value);
            if (setting.key === 'event_banner_end_at') result.eventBanner.end_at = normalizeScheduleValue(setting.value);
            if (setting.key === 'event_banner_show_in_full') result.eventBanner.show_in_full = parseBoolean(setting.value, true);
            if (setting.key === 'event_banner_show_in_simple') result.eventBanner.show_in_simple = parseBoolean(setting.value, true);

            if (setting.key === 'announcement_enabled') result.announcement.enabled = parseBoolean(setting.value);
            if (setting.key === 'announcement_title') result.announcement.title = setting.value;
            if (setting.key === 'announcement_text') result.announcement.text = setting.value;
            if (setting.key === 'announcement_style') result.announcement.style = setting.value || 'info';
            if (setting.key === 'announcement_start_at') result.announcement.start_at = normalizeScheduleValue(setting.value);
            if (setting.key === 'announcement_end_at') result.announcement.end_at = normalizeScheduleValue(setting.value);
            if (setting.key === 'announcement_show_in_full') result.announcement.show_in_full = parseBoolean(setting.value, true);
            if (setting.key === 'announcement_show_in_simple') result.announcement.show_in_simple = parseBoolean(setting.value, true);
        });

        result.eventBanner.isActive = isScheduledContentActive(result.eventBanner, timezone);
        result.announcement.isActive = isScheduledContentActive(result.announcement, timezone);

        return result;
    }
}

export default new SettingsService();
