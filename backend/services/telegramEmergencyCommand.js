/*
Purpose: Telegram bot command to FIRE a saved emergency broadcast preset from the operator's phone
         (banjir/kebakaran) without opening the web admin. Two-step (pick preset -> confirm -> fire) so a
         stray tap can't blast the village. Restricted to the bot's admin allowlist: telegramBotService only
         dispatches here AFTER isCommandChat(chatId) passes (message + callback both gated), so no extra
         authorization code is needed. Every trigger is audit-logged.
Caller: telegramBotService (message '/darurat'|'/emergency' + callback 'efire'/'efix').
Deps: audioEmergencyService (listPresets/fireEmergency), securityAuditLogger, telegramBotPresenter (pure).
MainFuncs: handleCommand, handleCallback.
SideEffects: fires a PREEMPTING broadcast + optional siren (REAL sound!) via fireEmergency; writes an audit row.
*/

import { listPresets, fireEmergency } from './audioEmergencyService.js';
import { logAdminAction } from './securityAuditLogger.js';
import { escapeHtml, encodeCallback, buildResult } from './telegramBotPresenter.js';

// Callback action codes (unique vs telegramBotPresenter.ACTIONS). 'non' (DISMISS) is reused for Cancel.
const FIRE = 'efire'; // tapped a preset  -> show the confirm card
const EXEC = 'efix';  // confirmed        -> actually fire
export const EMERGENCY_ACTIONS = [FIRE, EXEC];

function targetLabel(p) {
    const base = p.target_kind === 'area' ? `area #${p.area_id}` : `${(p.camera_ids || []).length} kamera`;
    const dev = (p.device_ids || []).length ? ` + ${p.device_ids.length} titik speaker` : '';
    return base + dev;
}

/** `/darurat` — list emergency presets as one-tap buttons. Caller already verified the chat is admin. */
export async function handleCommand(bot, chatId) {
    let presets = [];
    try { presets = listPresets(); } catch { presets = []; }
    if (presets.length === 0) {
        return bot.sendMessage(chatId, { text: '🚨 Belum ada preset darurat. Buat dulu di panel Darurat pada /admin/audio.' });
    }
    const rows = presets.map((p) => [{ text: `🚨 ${p.label}`, callback_data: encodeCallback(FIRE, p.id) }]);
    rows.push([{ text: '✖️ Batal', callback_data: encodeCallback('non') }]); // reuse DISMISS
    return bot.sendMessage(chatId, {
        text: '🚨 <b>Siaran Darurat</b>\nPilih preset untuk disiarkan SEKARANG — menghentikan siaran lain & mengabaikan jam tenang:',
        reply_markup: { inline_keyboard: rows },
    });
}

/**
 * Callback for 'efire' (show confirm) and 'efix' (fire). Returns undefined for any other action so the
 * caller can fall through to its own default. `actor` feeds the audit row.
 */
export async function handleCallback(bot, cq, chatId, messageId, action, params, actor) {
    if (action !== FIRE && action !== EXEC) return undefined;
    const id = Number(params[0]);
    const preset = listPresets().find((p) => p.id === id);
    if (!preset) return bot.answerCallback(cq.id, 'Preset darurat tidak ditemukan.', { alert: true });

    if (action === FIRE) {
        await bot.answerCallback(cq.id);
        return bot.editMessage(chatId, messageId, {
            text: `🚨 <b>Konfirmasi DARURAT</b>\nSiarkan "<b>${escapeHtml(preset.label)}</b>" ke ${escapeHtml(targetLabel(preset))} SEKARANG?${preset.siren ? '\n🔊 Sirene juga akan MENYALA.' : ''}\n\nMenghentikan siaran lain & mengabaikan jam tenang.`,
            reply_markup: { inline_keyboard: [[
                { text: '✅ YA, SIARKAN', callback_data: encodeCallback(EXEC, preset.id) },
                { text: '✖️ Batal', callback_data: encodeCallback('non') },
            ]] },
        });
    }
    // EXEC — ack the tap first (Telegram expects a prompt answer), then fire, then edit with the result.
    await bot.answerCallback(cq.id, '🚨 Menyiarkan darurat…');
    let r;
    try {
        r = await fireEmergency({
            sourceType: preset.source_type, sourceId: preset.source_id, targetKind: preset.target_kind,
            areaId: preset.area_id, cameraIds: preset.camera_ids, deviceIds: preset.device_ids,
            loop: preset.loop, gainDb: preset.gain_db, siren: Boolean(preset.siren),
        });
    } catch (error) {
        return bot.editMessage(chatId, messageId, buildResult('⚠️', 'Darurat GAGAL', [escapeHtml(error.message || 'Tak ada target')]));
    }
    const total = (r.results || []).length;
    const ok = (r.results || []).filter((x) => x.ok).length;
    const lines = [`📢 "${escapeHtml(preset.label)}"`, `Kamera: ${ok}/${total} berbunyi`];
    if (r.devices) lines.push(`Titik speaker: ${r.devices}`);
    if (r.sirens) lines.push(`Sirene ON: ${r.sirens}`);
    lines.push(`oleh ${escapeHtml(actor?.name || 'telegram')}`);
    try {
        logAdminAction({
            action: 'audio_emergency_via_telegram', targetType: 'audio_emergency', targetId: preset.id,
            label: preset.label, okCameras: ok, totalCameras: total, devices: r.devices || 0, sirens: r.sirens || 0,
            adminUsername: `telegram:${actor?.name || '?'}`,
        }, bot.botRequest ? bot.botRequest(actor) : undefined);
    } catch { /* audit best-effort */ }
    return bot.editMessage(chatId, messageId, buildResult('🚨', 'DARURAT terkirim', lines));
}

export default { handleCommand, handleCallback, EMERGENCY_ACTIONS };
