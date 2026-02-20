import os from 'os';
import { query, queryOne } from '../database/database.js';
import adminDashboardService from '../services/adminDashboardService.js';
import mediaMtxService from '../services/mediaMtxService.js';
import viewerSessionService from '../services/viewerSessionService.js';
import {
    sendTestNotification,
    getTelegramStatus,
    isTelegramConfigured,
    saveTelegramSettings
} from '../services/telegramService.js';
import cache from '../services/cacheService.js';
import { getTimezone, setTimezone, TIMEZONE_MAP, formatDateTime } from '../services/timezoneService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';
import backupService from '../services/backupService.js';

export async function getDashboardStats(request, reply) {
    try {
        const data = await adminDashboardService.getDashboardStats();

        return reply.send({
            success: true,
            data
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}


/**
 * Get today's quick stats with comparison to yesterday
 * For dashboard mini cards
 * Supports period parameter: 'today', 'yesterday', '7days', '30days'
 */
export async function getTodayStats(request, reply) {
    try {
        const { period = 'today' } = request.query;

        const data = await adminDashboardService.getTodayStats(period);

        return reply.send({
            success: true,
            data
        });
    } catch (error) {
        console.error('Get today stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Test Telegram notification
 */
export async function testTelegramNotification(request, reply) {
    try {
        const { type = 'monitoring' } = request.body || {};

        if (type === 'monitoring' && !isTelegramConfigured()) {
            return reply.code(400).send({
                success: false,
                message: 'Telegram monitoring belum dikonfigurasi',
            });
        }

        const sent = await sendTestNotification(type);

        if (sent) {
            return reply.send({
                success: true,
                message: 'Notifikasi test berhasil dikirim ke Telegram',
            });
        } else {
            return reply.code(500).send({
                success: false,
                message: 'Gagal mengirim notifikasi test. Periksa konfigurasi bot token dan chat ID.',
            });
        }
    } catch (error) {
        console.error('Test Telegram notification error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get Telegram configuration status
 */
export async function getTelegramConfig(request, reply) {
    try {
        const status = getTelegramStatus();

        return reply.send({
            success: true,
            data: status,
        });
    } catch (error) {
        console.error('Get Telegram config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Update Telegram configuration
 */
export async function updateTelegramConfig(request, reply) {
    try {
        const { botToken, monitoringChatId, feedbackChatId } = request.body;

        const settings = {
            botToken: botToken || '',
            monitoringChatId: monitoringChatId || '',
            feedbackChatId: feedbackChatId || '',
            enabled: !!(botToken && (monitoringChatId || feedbackChatId))
        };

        const saved = saveTelegramSettings(settings);

        if (saved) {
            return reply.send({
                success: true,
                message: 'Konfigurasi Telegram berhasil disimpan',
                data: getTelegramStatus(),
            });
        } else {
            return reply.code(500).send({
                success: false,
                message: 'Gagal menyimpan konfigurasi',
            });
        }
    } catch (error) {
        console.error('Update Telegram config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get viewer analytics data
 * Query params: period (today, yesterday, 7days, 30days, all, or date:YYYY-MM-DD)
 */
export async function getViewerAnalytics(request, reply) {
    try {
        const { period = '7days' } = request.query;

        // Validate period - allow standard periods or custom date format
        const validPeriods = ['today', 'yesterday', '7days', '30days', 'all'];
        const isCustomDate = period.startsWith('date:') && /^date:\d{4}-\d{2}-\d{2}$/.test(period);

        if (!validPeriods.includes(period) && !isCustomDate) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid period. Use: today, yesterday, 7days, 30days, all, or date:YYYY-MM-DD',
            });
        }

        const analytics = viewerSessionService.getAnalytics(period);

        return reply.send({
            success: true,
            data: analytics,
        });
    } catch (error) {
        console.error('Get viewer analytics error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get real-time viewer data (for live dashboard updates)
 */
export async function getRealTimeViewers(request, reply) {
    try {
        const data = viewerSessionService.getRealTimeData();

        return reply.send({
            success: true,
            data,
        });
    } catch (error) {
        console.error('Get real-time viewers error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}


/**
 * Get cache statistics (admin only)
 */
export async function getCacheStats(request, reply) {
    try {
        const stats = cache.stats();

        return reply.send({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error('Get cache stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Clear all cache (admin only)
 */
export async function clearCache(request, reply) {
    try {
        const cleared = cache.clear();

        return reply.send({
            success: true,
            message: `Cache cleared successfully. ${cleared} entries removed.`,
            data: { cleared },
        });
    } catch (error) {
        console.error('Clear cache error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get timezone configuration
 */
export async function getTimezoneConfig(request, reply) {
    try {
        const timezone = getTimezone();
        const shortName = Object.keys(TIMEZONE_MAP).find(
            key => TIMEZONE_MAP[key] === timezone
        ) || 'WIB';

        return reply.send({
            success: true,
            data: {
                timezone,
                shortName
            }
        });
    } catch (error) {
        console.error('Get timezone config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Update timezone configuration
 */
export async function updateTimezoneConfig(request, reply) {
    try {
        const { timezone } = request.body;

        if (!['WIB', 'WITA', 'WIT'].includes(timezone)) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid timezone. Use: WIB, WITA, or WIT',
            });
        }

        setTimezone(timezone);

        logAdminAction({
            action: 'timezone_updated',
            details: { timezone },
            userId: request.user?.id
        }, request);

        return reply.send({
            success: true,
            message: 'Timezone berhasil diupdate',
            data: { timezone }
        });
    } catch (error) {
        console.error('Update timezone config error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Export database backup
 */
export async function exportDatabaseBackup(request, reply) {
    try {
        const result = backupService.exportBackup();

        if (!result.success) {
            return reply.code(500).send({
                success: false,
                message: 'Gagal export backup: ' + result.error,
            });
        }

        const stats = backupService.getBackupStats(result.backup);

        logAdminAction({
            action: 'backup_exported',
            details: { stats },
            userId: request.user?.id
        }, request);

        // Return as downloadable JSON
        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', `attachment; filename="rafnet-cctv-backup-${new Date().toISOString().split('T')[0]}.json"`);

        return reply.send(result.backup);
    } catch (error) {
        console.error('Export database backup error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Import database backup
 */
export async function importDatabaseBackup(request, reply) {
    try {
        const { backup, mode = 'merge', tables = null } = request.body;

        if (!backup || !backup.version || !backup.data) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid backup format',
            });
        }

        const result = backupService.importBackup(backup, { mode, tables });

        if (!result.success) {
            return reply.code(500).send({
                success: false,
                message: 'Gagal import backup: ' + result.error,
            });
        }

        logAdminAction({
            action: 'backup_imported',
            details: {
                mode,
                imported: result.imported,
                skipped: result.skipped,
                errors: result.errors
            },
            userId: request.user?.id
        }, request);

        return reply.send({
            success: true,
            message: 'Backup berhasil diimport',
            data: result
        });
    } catch (error) {
        console.error('Import database backup error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Get backup preview/stats
 */
export async function getBackupPreview(request, reply) {
    try {
        const { backup } = request.body;

        if (!backup || !backup.version || !backup.data) {
            return reply.code(400).send({
                success: false,
                message: 'Invalid backup format',
            });
        }

        const stats = backupService.getBackupStats(backup);

        return reply.send({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get backup preview error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
