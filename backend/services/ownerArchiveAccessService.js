/**
 * Purpose: Authorize an OWNER (or admin / owner-issued token) to stream ONE archived (Telegram)
 *          recording segment of their OWN rental camera — the archive counterpart to the local
 *          owner-replay path. Public visitors keep using /api/playback-archive (community + token).
 * Caller: controllers/recordingController.streamOwnerArchiveSegment.
 * Deps: connectionPool (camera row), telegramArchiveLibraryService (upload row), recordingPlaybackService
 *       (the single access decision, resolvePlaybackAccess — reused so the owner/token/billing rules
 *       never fork).
 * MainFuncs: resolveArchiveOwnerAccess.
 * SideEffects: None here; token validation side effects live inside resolvePlaybackAccess.
 *
 * WHY THIS EXISTS: MyRecordings (scope=owner) lists a rental owner's archived segments, but the
 * frontend routed every non-admin archive stream to the public archive route, which requires
 * camera_class='community' + a playback-token cookie. An owner (subscriber camera, JWT, no token)
 * therefore got 404/401 on their OWN footage — and with ~4h local retention almost everything old is
 * archive-only. (Audit v1.2.0, P-01.)
 */

import { queryOne } from '../database/connectionPool.js';
import archiveLibrary from './telegramArchiveLibraryService.js';
import recordingPlaybackService from './recordingPlaybackService.js';
import { resolveAccessBounds } from './playbackRangePolicy.js';

// The full-replay scopes that legitimately include private archive footage. public_preview /
// public_denied never reach it here — those visitors use the token-gated public archive route.
const DEEP_MODES = new Set(['admin_full', 'owner_full', 'token_full']);

/** recorded_at + the resolved bounds are UTC; pin a zoneless "YYYY-MM-DD HH:MM:SS" to UTC before parsing. */
function parseTimestampMs(value) {
    if (!value) return null;
    const text = String(value).trim();
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text)
        ? `${text.replace(' ', 'T')}Z`
        : text;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : null;
}

export function resolveArchiveOwnerAccess(segmentId, request) {
    const upload = archiveLibrary.getUpload(segmentId);
    if (!upload || !upload.file_id) {
        const err = new Error('Segmen arsip tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [upload.camera_id]);
    if (!camera) {
        const err = new Error('Kamera tidak ditemukan');
        err.statusCode = 404;
        throw err;
    }

    // resolvePlaybackAccess owns the whole decision: scope=owner -> ownership + rental + active
    // billing; owner-issued token; admin. A wrong owner throws 401 from inside it. A lapsed rental
    // returns public_denied + deniedReason. Anything short of a DEEP mode cannot reach the bytes.
    const access = recordingPlaybackService.resolvePlaybackAccess(camera, request);
    if (!DEEP_MODES.has(access.accessMode)) {
        const err = new Error(
            access.deniedReason === 'langganan_tidak_aktif'
                ? 'Langganan tidak aktif — pemutaran arsip dihentikan'
                : 'Tidak berwenang memutar arsip ini',
        );
        err.statusCode = request?.user?.id ? 403 : 401;
        throw err;
    }

    // A token_full holder is bound by the token's playback window/range — exactly as the public
    // archive route (publicArchiveAccessService Gate 4) and the local getStreamSegment path enforce
    // it. WITHOUT this, a holder who knows a segment id could pull footage far beyond their
    // entitlement: a 1-hour community trial token streaming a month-old segment (paywall bypass), or
    // an owner-issued 24h "selected" share streaming 10-day-old private footage. admin_full and
    // owner_full stay unbounded (admin / the camera's own owner replaying full history).
    if (access.accessMode === 'token_full') {
        const { fromIso, toIso } = resolveAccessBounds({
            playbackWindowHours: access.playbackWindowHours,
            playbackFrom: access.playbackFrom,
            playbackTo: access.playbackTo,
        });
        if (fromIso || toIso) {
            const recordedAtMs = parseTimestampMs(upload.recorded_at);
            if (recordedAtMs === null
                || (fromIso && recordedAtMs < Date.parse(fromIso))
                || (toIso && recordedAtMs > Date.parse(toIso))) {
                const err = new Error('Segmen di luar jangkauan token ini');
                err.statusCode = 403;
                throw err;
            }
        }
    }

    return { segmentId: upload.segment_id, fileSize: upload.file_size };
}

export default { resolveArchiveOwnerAccess };
