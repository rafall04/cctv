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
            company_name: 'RAF',
            company_tagline: 'Pemantauan CCTV Publik',
            company_description: 'Platform pemantauan CCTV publik secara real-time. Akses gratis melalui website ini.',
            city_name: 'Bojonegoro',
            province_name: 'Jawa Timur',
            hero_title: 'Pantau CCTV Publik Secara Real-Time',
            hero_subtitle: 'Pantau berbagai lokasi CCTV publik secara real-time. Akses gratis 24 jam tanpa login.',
            footer_text: 'Layanan pemantauan CCTV publik',
            copyright_text: 'Pemantauan CCTV Publik',
            meta_title: 'CCTV Publik Online - RAF | Pantau Real-Time',
            meta_description: 'Pantau CCTV publik secara online dan live streaming 24 jam. Akses publik gratis tanpa login.',
            meta_keywords: 'cctv online, cctv publik, pantau cctv, live streaming cctv, monitoring cctv, cctv real-time',
            logo_text: 'R',
            primary_color: '#0ea5e9',
            show_powered_by: 'true',
            whatsapp_number: '6289685645956',
            // Default WA contact text. Admins can override per-deployment;
            // placeholders are substituted client-side by buildWhatsappLink
            // ({{company_name}}, {{city_name}}, {{page}}, {{camera_name}}).
            whatsapp_message_template: 'Halo Admin {{company_name}}, saya ingin tanya soal {{page}}.',
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
