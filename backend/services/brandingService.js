import { query, queryOne, execute } from '../database/database.js';

class BrandingService {
    getBrandingSettings() {
        const settings = query('SELECT key, value FROM branding_settings ORDER BY key ASC');
        return settings.reduce((acc, setting) => {
            acc[setting.key] = setting.value;
            return acc;
        }, {});
    }

    getBrandingSettingsAdmin() {
        return query(`
            SELECT 
                bs.id,
                bs.key,
                bs.value,
                bs.description,
                bs.updated_at,
                bs.updated_by,
                u.username as updated_by_username
            FROM branding_settings bs
            LEFT JOIN users u ON bs.updated_by = u.id
            ORDER BY bs.key ASC
        `);
    }

    updateBrandingSetting(key, value, userId) {
        const existing = queryOne('SELECT id, value FROM branding_settings WHERE key = ?', [key]);
        if (!existing) {
            const err = new Error('Branding setting not found');
            err.statusCode = 404;
            throw err;
        }

        execute(
            `UPDATE branding_settings 
             SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? 
             WHERE key = ?`,
            [value, userId, key]
        );

        return existing.value; // Return old value
    }

    bulkUpdateBrandingSettings(settingsObject, userId) {
        const changes = [];

        for (const [key, value] of Object.entries(settingsObject)) {
            const existing = queryOne('SELECT id, value FROM branding_settings WHERE key = ?', [key]);

            if (existing && existing.value !== value) {
                execute(
                    `UPDATE branding_settings 
                     SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? 
                     WHERE key = ?`,
                    [value, userId, key]
                );

                changes.push({
                    key,
                    old_value: existing.value,
                    new_value: value
                });
            }
        }

        return changes;
    }

    resetBrandingSettings(userId) {
        const defaultBranding = {
            company_name: 'RAF NET',
            company_tagline: 'CCTV Bojonegoro Online',
            company_description: 'RAF NET melayani pemasangan WiFi dan CCTV di wilayah Bojonegoro. Pantau CCTV publik secara gratis melalui website ini.',
            city_name: 'Bojonegoro',
            province_name: 'Jawa Timur',
            hero_title: 'Pantau CCTV Bojonegoro Secara Real-Time',
            hero_subtitle: 'Pantau keamanan wilayah Bojonegoro secara real-time dengan sistem CCTV RAF NET. Akses gratis 24 jam untuk memantau berbagai lokasi di Bojonegoro, Jawa Timur.',
            footer_text: 'Layanan pemantauan CCTV publik oleh RAF NET untuk keamanan dan kenyamanan warga Bojonegoro',
            copyright_text: 'Penyedia Internet & CCTV Bojonegoro',
            meta_title: 'CCTV Bojonegoro Online - RAF NET | Pantau Keamanan Kota Bojonegoro Live',
            meta_description: 'Pantau CCTV Bojonegoro secara online dan live streaming 24 jam. RAF NET menyediakan akses publik untuk memantau keamanan kota Bojonegoro, Jawa Timur. Gratis tanpa login.',
            meta_keywords: 'cctv bojonegoro, cctv bojonegoro online, cctv raf net, pantau cctv bojonegoro, live streaming cctv bojonegoro, keamanan bojonegoro, cctv jawa timur, raf net bojonegoro, cctv kota bojonegoro, monitoring bojonegoro',
            logo_text: 'R',
            primary_color: '#0ea5e9',
            show_powered_by: 'true',
            whatsapp_number: '6289685645956',
        };

        for (const [key, value] of Object.entries(defaultBranding)) {
            execute(
                `UPDATE branding_settings 
                 SET value = ?, updated_at = CURRENT_TIMESTAMP, updated_by = ? 
                 WHERE key = ?`,
                [value, userId, key]
            );
        }
    }
}

export default new BrandingService();
