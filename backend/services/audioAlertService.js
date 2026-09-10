/*
Purpose: Telegram alert when an AUTOMATIC audio broadcast (adzan / qori / scheduled announcement) fails to
         reach ANY speaker. The operator is offline-first and does not watch pm2 logs, so a 0-of-N delivery
         (e.g. the area's modem is down when adzan is due) must surface somewhere they actually look —
         the monitoring chat. Manual play already shows a per-camera receipt on screen; this covers the
         UNATTENDED paths, where nobody is watching the result.
Caller: audioPrayerService (adzan/qori), audioScheduleService (scheduled play).
Deps: telegramService.sendMonitoringMessage + isTelegramConfigured.
MainFuncs: alertBroadcastResult.
SideEffects: sends one Telegram line (best-effort). NEVER throws into the play path.
*/

/**
 * Alert when an automatic broadcast reached 0 of N speakers (total failure). A partial/full success sends
 * nothing (the routine case). Guarded so alerting can never disrupt or slow the broadcast itself.
 * telegramService is imported LAZILY (only on an actual outage) so the play hot-path stays light and the
 * scheduler modules don't pull the Telegram stack at load time.
 * @param {{label:string, okCount:number, total:number}} r
 */
export async function alertBroadcastResult({ label, okCount, total } = {}) {
    try {
        if (!Number.isFinite(total) || total <= 0) return;
        if (okCount > 0) return; // reached at least one speaker — not an outage
        const { sendMonitoringMessage, isTelegramConfigured } = await import('./telegramService.js');
        if (!isTelegramConfigured()) return;
        await sendMonitoringMessage(`🔇 Siaran otomatis GAGAL: ${label} — 0 dari ${total} speaker berbunyi. Periksa koneksi/kamera area tersebut.`);
    } catch (e) {
        console.error('[AudioAlert] gagal kirim alert:', e.message);
    }
}

export default { alertBroadcastResult };
