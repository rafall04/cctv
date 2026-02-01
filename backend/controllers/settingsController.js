import { query, queryOne, execute } from '../database/database.js';

// Get all settings
export async function getAllSettings(request, reply) {
    try {
        const settings = query('SELECT * FROM settings ORDER BY key');
        
        // Convert to key-value object
        const settingsObj = {};
        settings.forEach(s => {
            try {
                settingsObj[s.key] = JSON.parse(s.value);
            } catch {
                settingsObj[s.key] = s.value;
            }
        });

        return reply.send({
            success: true,
            data: settingsObj,
        });
    } catch (error) {
        console.error('Get settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get single setting by key
export async function getSetting(request, reply) {
    try {
        const { key } = request.params;
        const setting = queryOne('SELECT * FROM settings WHERE key = ?', [key]);

        if (!setting) {
            return reply.code(404).send({
                success: false,
                message: 'Setting not found',
            });
        }

        let value;
        try {
            value = JSON.parse(setting.value);
        } catch {
            value = setting.value;
        }

        return reply.send({
            success: true,
            data: {
                key: setting.key,
                value,
                description: setting.description,
            },
        });
    } catch (error) {
        console.error('Get setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Update setting
export async function updateSetting(request, reply) {
    try {
        const { key } = request.params;
        const { value, description } = request.body;

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

        return reply.send({
            success: true,
            message: 'Setting updated successfully',
            data: { key, value },
        });
    } catch (error) {
        console.error('Update setting error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get map default center (public endpoint)
export async function getMapDefaultCenter(request, reply) {
    try {
        const setting = queryOne('SELECT value FROM settings WHERE key = ?', ['map_default_center']);
        
        if (!setting) {
            // Return default if not set
            return reply.send({
                success: true,
                data: {
                    latitude: -7.1507,
                    longitude: 111.8815,
                    zoom: 13,
                    name: 'Bojonegoro'
                },
            });
        }

        return reply.send({
            success: true,
            data: JSON.parse(setting.value),
        });
    } catch (error) {
        console.error('Get map center error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

// Get landing page settings (public endpoint)
export async function getLandingPageSettings(request, reply) {
    try {
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

        return reply.send({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Get landing page settings error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
