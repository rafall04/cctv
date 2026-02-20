import { query, queryOne, execute } from '../database/database.js';

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
        const settings = query(
            'SELECT key, value FROM settings WHERE key IN (?, ?, ?)',
            ['landing_area_coverage', 'landing_hero_badge', 'landing_section_title']
        );

        const result = {
            area_coverage: 'Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>',
            hero_badge: 'LIVE STREAMING 24 JAM',
            section_title: 'CCTV Publik'
        };

        settings.forEach(s => {
            if (s.key === 'landing_area_coverage') result.area_coverage = s.value;
            if (s.key === 'landing_hero_badge') result.hero_badge = s.value;
            if (s.key === 'landing_section_title') result.section_title = s.value;
        });

        return result;
    }
}

export default new SettingsService();
