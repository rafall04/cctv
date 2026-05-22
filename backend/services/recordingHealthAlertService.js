// Purpose: Edge-triggered Telegram alerts when the recording pipeline's health
//          level changes (ok ⇄ warning ⇄ critical). One message per transition —
//          a level that stays critical for hours does not re-spam.
// Caller: server.js registers checkAndAlert as a recordingScheduler task.
// Deps: recordingHealthDashboardService (snapshot), telegramService (monitoring
//        chat), config.telegram.healthAlertsEnabled. All injectable for tests.
// MainFuncs: createRecordingHealthAlertService → checkAndAlert.
// SideEffects: Sends a Telegram message to the monitoring chat on a level change.

import { config } from '../config/config.js';
import recordingHealthDashboardService from './recordingHealthDashboardService.js';
import { sendMonitoringMessage, isTelegramConfigured } from './telegramService.js';

const LEVEL_LABEL = {
    ok: 'Sehat',
    warning: 'Perlu Perhatian',
    critical: 'Kritis',
};
const LEVEL_ICON = {
    ok: '✅',
    warning: '⚠️',
    critical: '🔴',
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function createRecordingHealthAlertService({
    healthService = recordingHealthDashboardService,
    sendMessage = sendMonitoringMessage,
    telegramConfigured = isTelegramConfigured,
    isEnabled = () => config.telegram?.healthAlertsEnabled !== false,
    logger = console,
} = {}) {
    // Start at 'ok' so booting into a healthy state stays silent, but booting
    // straight into warning/critical still fires one alert.
    let lastLevel = 'ok';

    function buildMessage(snapshot, previousLevel) {
        const level = snapshot.status?.level || 'ok';
        const reasons = snapshot.status?.reasons || [];
        const scheduler = snapshot.scheduler || {};
        const diagnostics = snapshot.recovery?.diagnostics || {};
        const lines = [];

        if (level === 'ok') {
            lines.push(`${LEVEL_ICON.ok} <b>Recording Pipeline Pulih</b>`);
            lines.push(`Status kembali normal (sebelumnya: ${LEVEL_LABEL[previousLevel] || previousLevel}).`);
        } else {
            lines.push(`${LEVEL_ICON[level] || ''} <b>Recording Pipeline — ${LEVEL_LABEL[level] || level}</b>`);
            if (reasons.length > 0) {
                lines.push('');
                reasons.forEach((reason) => lines.push(`• ${escapeHtml(reason)}`));
            }
            lines.push('');
            lines.push(`Sebelumnya: ${LEVEL_LABEL[previousLevel] || previousLevel}`);
        }

        lines.push(
            `Scheduler: ${scheduler.running ? 'jalan' : 'mati'}`
            + ` · Recovery aktif: ${diagnostics.activeTotal || 0}`
            + ` · Tidak terselamatkan: ${diagnostics.terminalTotal || 0}`
        );
        return lines.join('\n');
    }

    /**
     * Compute the current health level and alert if it changed since the last
     * notification. Safe to call on a short interval — it is a no-op unless the
     * level actually transitioned.
     */
    async function checkAndAlert(nowMs = Date.now()) {
        if (!isEnabled()) {
            return { skipped: 'disabled' };
        }
        if (!telegramConfigured()) {
            return { skipped: 'telegram_not_configured' };
        }

        let snapshot;
        try {
            snapshot = healthService.getSnapshot(nowMs);
        } catch (error) {
            logger.error?.('[HealthAlert] snapshot failed:', error?.message || error);
            return { skipped: 'snapshot_error' };
        }

        const level = snapshot.status?.level || 'ok';
        if (level === lastLevel) {
            return { changed: false, level };
        }

        const previousLevel = lastLevel;
        lastLevel = level;

        try {
            const sent = await sendMessage(buildMessage(snapshot, previousLevel));
            return { changed: true, level, previousLevel, sent: sent !== false };
        } catch (error) {
            logger.error?.('[HealthAlert] send failed:', error?.message || error);
            return { changed: true, level, previousLevel, sent: false };
        }
    }

    /** Test hook — reset the remembered level. */
    function _setLastLevel(level) {
        lastLevel = level;
    }

    return { checkAndAlert, buildMessage, _setLastLevel };
}

export default createRecordingHealthAlertService();
