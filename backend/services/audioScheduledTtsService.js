/*
Purpose: Render a scheduled-TTS schedule's template into a playable clip AT FIRE TIME, so dynamic
         placeholders ({jam}/{hari}/{tanggal}) speak the CURRENT date/time instead of the value baked when
         the schedule was created. synthTtsToTemp -> finalizeClipFromFile -> a short-lived clip the scheduler
         broadcasts like any other. The previous render is deleted on the next fire (restart-safe cleanup),
         and the scheduler also deletes the fresh one shortly after playback finishes.
Caller: audioScheduleService.runDueSchedules (the source_type === 'tts' branch).
Deps: audioTtsService.synthTtsToTemp, audioClipService (finalize/delete/meta), connectionPool.
MainFuncs: renderTtsClipNow.
SideEffects: spawns a TTS synth (short-lived), writes+deletes data/audio clip files + audio_clips rows.
*/

import { randomBytes } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { execute } from '../database/connectionPool.js';
import { synthTtsToTemp } from './audioTtsService.js';
import { finalizeClipFromFile, deleteClip, setClipMeta } from './audioClipService.js';

// Clips rendered for a schedule are tagged with this category so listClips can hide them from the library
// and the source pickers (they are ephemeral auto-renders, not a clip the operator manages).
export const SCHEDULED_TTS_CATEGORY = '_jadwal';

/**
 * Synthesize a schedule's TTS template NOW (current-time placeholders filled by cleanText's expandDynamicVars)
 * and store it as a clip. Deletes the schedule's PREVIOUS render (no longer playing) and records the new one
 * in tts_clip_id. Returns the new clip id, or null if the schedule has no text.
 */
export async function renderTtsClipNow(s) {
    const text = s.tts_text ? String(s.tts_text) : '';
    if (!text.trim()) return null;
    const prefix = `ttssched-${randomBytes(6).toString('hex')}`;
    const { path } = await synthTtsToTemp({ text, engine: s.tts_engine || 'piper', voice: s.tts_voice || undefined, prefix });
    let clip;
    try {
        clip = await finalizeClipFromFile({ name: `⏱ ${s.name}`.slice(0, 120), tempPath: path, sourceType: 'tts', userId: null });
    } finally {
        try { if (existsSync(path)) unlinkSync(path); } catch { /* already consumed/gone */ }
    }
    try { setClipMeta(clip.id, { category: SCHEDULED_TTS_CATEGORY }); } catch { /* meta best-effort */ }
    // Delete the previous day's render (definitely not playing by now) so renders never accumulate even if a
    // restart lost the post-playback delete timer. Then point the schedule at the fresh render.
    const prev = parseInt(s.tts_clip_id, 10);
    if (Number.isInteger(prev) && prev > 0 && prev !== clip.id) { try { deleteClip(prev); } catch { /* already gone */ } }
    execute('UPDATE audio_schedules SET tts_clip_id = ? WHERE id = ?', [clip.id, s.id]);
    return clip.id;
}

export default { renderTtsClipNow, SCHEDULED_TTS_CATEGORY };
