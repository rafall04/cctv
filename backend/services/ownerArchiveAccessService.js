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

// The full-replay scopes that legitimately include private archive footage. public_preview /
// public_denied never reach it here — those visitors use the token-gated public archive route.
const DEEP_MODES = new Set(['admin_full', 'owner_full', 'token_full']);

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

    return { segmentId: upload.segment_id, fileSize: upload.file_size };
}

export default { resolveArchiveOwnerAccess };
