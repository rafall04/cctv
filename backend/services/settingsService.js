import { query, queryOne, execute } from '../database/database.js';
import { getTimezone } from './timezoneService.js';
import { normalizeExternalHealthMode } from '../utils/cameraDelivery.js';

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

const ADS_SETTINGS_KEYS = [
    'ads_enabled',
    'ads_provider',
    'ads_desktop_enabled',
    'ads_mobile_enabled',
    'ads_popup_slots_enabled',
    'ads_popup_preferred_slot',
    'ads_hide_social_bar_on_popup',
    'ads_hide_floating_widgets_on_popup',
    'ads_popup_desktop_max_height',
    'ads_popup_mobile_max_height',
    'ads_playback_native_enabled',
    'ads_playback_native_script',
    'ads_playback_native_desktop_enabled',
    'ads_playback_native_mobile_enabled',
    'ads_playback_popunder_enabled',
    'ads_playback_popunder_script',
    'ads_playback_popunder_desktop_enabled',
    'ads_playback_popunder_mobile_enabled',
    'ads_social_bar_enabled',
    'ads_social_bar_script',
    'ads_top_banner_enabled',
    'ads_top_banner_script',
    'ads_after_cameras_native_enabled',
    'ads_after_cameras_native_script',
    'ads_popup_top_banner_enabled',
    'ads_popup_top_banner_script',
    'ads_popup_bottom_native_enabled',
    'ads_popup_bottom_native_script',
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

const ADS_DEFAULTS = {
    enabled: false,
    provider: 'adsterra',
    devices: {
        desktop: true,
        mobile: true,
    },
    popup: {
        enabled: true,
        preferredSlot: 'bottom',
        hideSocialBarOnPopup: true,
        hideFloatingWidgetsOnPopup: true,
        maxHeight: {
            desktop: 160,
            mobile: 220,
        },
    },
    slots: {
        playbackNative: {
            enabled: false,
            script: '',
            devices: {
                desktop: true,
                mobile: true,
            },
        },
        playbackPopunder: {
            enabled: false,
            script: '',
            devices: {
                desktop: true,
                mobile: true,
            },
        },
        socialBar: {
            enabled: false,
            script: '',
        },
        footerBanner: {
            enabled: false,
            script: '',
        },
        afterCamerasNative: {
            enabled: false,
            script: '',
        },
        popupTopBanner: {
            enabled: false,
            script: '',
        },
        popupBottomNative: {
            enabled: false,
            script: '',
        },
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

function hasScriptValue(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
    }

    return fallback;
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

    getExternalHealthDefaults() {
        const rows = query(
            'SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?)',
            [
                'external_mjpeg_health_default',
                'external_hls_health_default',
                'external_embed_health_default',
                'external_jsmpeg_health_default',
                'external_custom_ws_health_default',
            ]
        );

        const map = new Map(rows.map((row) => [row.key, row.value]));
        return {
            external_mjpeg: normalizeExternalHealthMode(
                map.get('external_mjpeg_health_default') || 'passive_first'
            ),
            external_hls: normalizeExternalHealthMode(
                map.get('external_hls_health_default') || 'hybrid_probe'
            ),
            external_embed: normalizeExternalHealthMode(
                map.get('external_embed_health_default') || 'passive_first'
            ),
            external_jsmpeg: normalizeExternalHealthMode(
                map.get('external_jsmpeg_health_default') || 'disabled'
            ),
            external_custom_ws: normalizeExternalHealthMode(
                map.get('external_custom_ws_health_default') || 'disabled'
            ),
        };
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

    getPublicAdsSettings() {
        const placeholders = ADS_SETTINGS_KEYS.map(() => '?').join(', ');
        const settings = query(
            `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
            ADS_SETTINGS_KEYS
        );

        const result = {
            ...ADS_DEFAULTS,
            devices: { ...ADS_DEFAULTS.devices },
            popup: {
                ...ADS_DEFAULTS.popup,
                maxHeight: { ...ADS_DEFAULTS.popup.maxHeight },
            },
            slots: {
                playbackNative: {
                    ...ADS_DEFAULTS.slots.playbackNative,
                    devices: { ...ADS_DEFAULTS.slots.playbackNative.devices },
                },
                playbackPopunder: {
                    ...ADS_DEFAULTS.slots.playbackPopunder,
                    devices: { ...ADS_DEFAULTS.slots.playbackPopunder.devices },
                },
                socialBar: { ...ADS_DEFAULTS.slots.socialBar },
                footerBanner: { ...ADS_DEFAULTS.slots.footerBanner },
                afterCamerasNative: { ...ADS_DEFAULTS.slots.afterCamerasNative },
                popupTopBanner: { ...ADS_DEFAULTS.slots.popupTopBanner },
                popupBottomNative: { ...ADS_DEFAULTS.slots.popupBottomNative },
            },
        };

        settings.forEach((setting) => {
            switch (setting.key) {
                case 'ads_enabled':
                    result.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_provider':
                    result.provider = setting.value || ADS_DEFAULTS.provider;
                    break;
                case 'ads_desktop_enabled':
                    result.devices.desktop = parseBoolean(setting.value, true);
                    break;
                case 'ads_mobile_enabled':
                    result.devices.mobile = parseBoolean(setting.value, true);
                    break;
                case 'ads_popup_slots_enabled':
                    result.popup.enabled = parseBoolean(setting.value, true);
                    break;
                case 'ads_popup_preferred_slot':
                    result.popup.preferredSlot = setting.value === 'top' ? 'top' : 'bottom';
                    break;
                case 'ads_hide_social_bar_on_popup':
                    result.popup.hideSocialBarOnPopup = parseBoolean(setting.value, true);
                    break;
                case 'ads_hide_floating_widgets_on_popup':
                    result.popup.hideFloatingWidgetsOnPopup = parseBoolean(setting.value, true);
                    break;
                case 'ads_popup_desktop_max_height':
                    result.popup.maxHeight.desktop = parsePositiveInt(
                        setting.value,
                        ADS_DEFAULTS.popup.maxHeight.desktop
                    );
                    break;
                case 'ads_popup_mobile_max_height':
                    result.popup.maxHeight.mobile = parsePositiveInt(
                        setting.value,
                        ADS_DEFAULTS.popup.maxHeight.mobile
                    );
                    break;
                case 'ads_playback_native_enabled':
                    result.slots.playbackNative.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_playback_native_script':
                    result.slots.playbackNative.script = setting.value || '';
                    break;
                case 'ads_playback_native_desktop_enabled':
                    result.slots.playbackNative.devices.desktop = parseBoolean(setting.value, true);
                    break;
                case 'ads_playback_native_mobile_enabled':
                    result.slots.playbackNative.devices.mobile = parseBoolean(setting.value, true);
                    break;
                case 'ads_playback_popunder_enabled':
                    result.slots.playbackPopunder.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_playback_popunder_script':
                    result.slots.playbackPopunder.script = setting.value || '';
                    break;
                case 'ads_playback_popunder_desktop_enabled':
                    result.slots.playbackPopunder.devices.desktop = parseBoolean(setting.value, true);
                    break;
                case 'ads_playback_popunder_mobile_enabled':
                    result.slots.playbackPopunder.devices.mobile = parseBoolean(setting.value, true);
                    break;
                case 'ads_social_bar_enabled':
                    result.slots.socialBar.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_social_bar_script':
                    result.slots.socialBar.script = setting.value || '';
                    break;
                case 'ads_top_banner_enabled':
                    result.slots.footerBanner.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_top_banner_script':
                    result.slots.footerBanner.script = setting.value || '';
                    break;
                case 'ads_after_cameras_native_enabled':
                    result.slots.afterCamerasNative.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_after_cameras_native_script':
                    result.slots.afterCamerasNative.script = setting.value || '';
                    break;
                case 'ads_popup_top_banner_enabled':
                    result.slots.popupTopBanner.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_popup_top_banner_script':
                    result.slots.popupTopBanner.script = setting.value || '';
                    break;
                case 'ads_popup_bottom_native_enabled':
                    result.slots.popupBottomNative.enabled = parseBoolean(setting.value);
                    break;
                case 'ads_popup_bottom_native_script':
                    result.slots.popupBottomNative.script = setting.value || '';
                    break;
                default:
                    break;
            }
        });

        Object.values(result.slots).forEach((slot) => {
            if (!slot.enabled || !hasScriptValue(slot.script)) {
                slot.enabled = false;
                delete slot.script;
            }
        });

        if (!result.popup.enabled) {
            result.slots.popupTopBanner.enabled = false;
            delete result.slots.popupTopBanner.script;
            result.slots.popupBottomNative.enabled = false;
            delete result.slots.popupBottomNative.script;
        }

        if (!result.enabled) {
            Object.values(result.slots).forEach((slot) => {
                slot.enabled = false;
                delete slot.script;
            });
        }

        return result;
    }
}

export default new SettingsService();
