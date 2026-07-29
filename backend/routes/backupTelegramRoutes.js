/*
 * Purpose: Admin routes for the Telegram database-backup pathway under /api/admin/backup (requireAdmin).
 * Caller: server.js route registration.
 * Deps: authMiddleware, settingsService, backupTelegramService, securityAuditLogger.
 * MainFuncs: GET /telegram (config + status), PUT /telegram (save), POST /telegram/send (send now).
 * SideEffects: Writes two settings keys; a send builds a snapshot and uploads it to Telegram.
 */

import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import settingsService from '../services/settingsService.js';
import backupTelegram, { BACKUP_SETTING_KEYS } from '../services/backupTelegramService.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

const configBody = {
    type: 'object',
    properties: {
        enabled: { type: 'boolean' },
        // Telegram chat ids are numeric and may be negative (groups/supergroups), or an @channel name.
        chatId: { type: 'string', maxLength: 64, pattern: '^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,63})?$' },
    },
    additionalProperties: false,
};

export default async function backupTelegramRoutes(fastify) {
    fastify.addHook('preHandler', authMiddleware);
    fastify.addHook('preHandler', requireAdmin);

    fastify.get('/telegram', async (request, reply) => {
        const config = backupTelegram.getBackupTelegramConfig();
        return reply.send({ success: true, data: config });
    });

    fastify.put('/telegram', { schema: { body: configBody } }, async (request, reply) => {
        const { enabled, chatId } = request.body || {};

        if (enabled !== undefined) {
            settingsService.updateSetting(
                BACKUP_SETTING_KEYS.enabled,
                enabled ? 'true' : 'false',
                'Kirim backup database harian ke Telegram'
            );
        }
        if (chatId !== undefined) {
            settingsService.updateSetting(
                BACKUP_SETTING_KEYS.chatId,
                String(chatId).trim(),
                'Chat/grup Telegram tujuan backup database'
            );
        }

        logAdminAction({
            action: 'backup_telegram_config_updated',
            // The chat id is not a secret, but it identifies a private group — log that it changed,
            // not what it changed to.
            details: { enabled, chatIdSet: Boolean(String(chatId ?? '').trim()) },
            userId: request.user?.id,
        }, request);

        return reply.send({ success: true, message: 'Pengaturan backup disimpan', data: backupTelegram.getBackupTelegramConfig() });
    });

    fastify.post('/telegram/send', async (request, reply) => {
        try {
            const result = await backupTelegram.sendDatabaseBackup({ reason: 'manual (admin)' });
            logAdminAction({
                action: 'backup_telegram_sent',
                details: { bytes: result.bytes, filename: result.filename },
                userId: request.user?.id,
            }, request);
            return reply.send({
                success: true,
                message: `Backup terkirim (${(result.bytes / 1048576).toFixed(1)} MB)`,
                data: result,
            });
        } catch (error) {
            const code = error.statusCode || 500;
            console.error('Send backup to Telegram error:', error);
            return reply.code(code).send({
                success: false,
                message: code === 500 ? 'Gagal mengirim backup' : error.message,
            });
        }
    });
}
