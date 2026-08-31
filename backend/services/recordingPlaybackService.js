/**
 * Purpose: Coordinate recording controls, public/admin playback policy, token access, and MP4 segment delivery.
 * Caller: recordingController playback and recording handlers.
 * Deps: database connection helpers, camera delivery policy, recording services, segment repository, settings, playback tokens, fs, path safety policy.
 * MainFuncs: startRecording, stopRecording, getSegments, getStreamSegment, generatePlaylist, updateRecordingSettings.
 * SideEffects: Starts/stops recordings, writes camera settings, logs admin actions, reads segment files.
 */

import { query, queryOne, execute } from '../database/connectionPool.js';
import { getEffectiveDeliveryType } from '../utils/cameraDelivery.js';
import { recordingService } from './recordingService.js';
import recordingControl from './recordingControlService.js';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import { logAdminAction } from './securityAuditLogger.js';
import settingsService from './settingsService.js';
import playbackTokenService from './playbackTokenService.js';
import { existsSync, statSync } from 'fs';
import { isSafeRecordingFilePath } from './recordingPathSafetyPolicy.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import archivedSegmentSourceService from './archivedSegmentSourceService.js';
import { resolveOwnerScopeAccess, resolveOwnerIssuedTokenAccess } from './rentalPlaybackAccessPolicy.js';
import recordingCoverageRunsService from './recordingCoverageRunsService.js';
import { intersectWithAccessWindow, isWithinRange, parsePlaybackRange, resolveAccessBounds } from './playbackRangePolicy.js';
import { noteTokenRefusal } from './playbackTokenRefusalLog.js';

/**
 * Scopes that reach past the public preview: they may name a date range, they get archived segments
 * merged in, and they are shown the whole-span coverage map. Kept as one set because these three
 * decisions must never drift apart — a scope that can browse days but gets no coverage map would be
 * narrowed with nothing left to say which days are missing.
 */
const DEEP_PLAYBACK_MODES = new Set(['admin_full', 'owner_full', 'token_full']);
const PUBLIC_PLAYBACK_MODES = new Set(['inherit', 'disabled', 'preview_only', 'admin_only']);
const VALID_PREVIEW_MINUTES = new Set([0, 10, 20, 30, 60]);
const RECORDABLE_DELIVERY_TYPES = new Set(['internal_hls', 'external_hls']);

/**
 * Strip server-internal fields before sending a segment row over HTTP.
 *
 * `file_path` is the absolute filesystem path on the server (e.g.
 * `/var/www/rafnet-cctv/recordings/cameraN/20260517_010000.mp4`).
 * Leaking that to a browser exposes our deployment layout and the
 * recordings directory tree, which is a stepping stone for any further
 * path-traversal or filesystem probing. The repository still SELECTs the
 * column because the streaming path (`getStreamSegment`) needs it server
 * side; we just don't ship it back to the client.
 */
function toPublicSegment(segment) {
    if (!segment) return segment;
    // eslint-disable-next-line no-unused-vars
    const { file_path, ...publicSegment } = segment;
    return publicSegment;
}

function normalizePublicPlaybackMode(value) {
    return PUBLIC_PLAYBACK_MODES.has(value) ? value : 'inherit';
}

function normalizePreviewMinutes(value, fallback = 10) {
    const parsed = Number.parseInt(value, 10);
    return VALID_PREVIEW_MINUTES.has(parsed) ? parsed : fallback;
}

function getPreviewSegmentLimit(previewMinutes) {
    if (!previewMinutes) {
        return 0;
    }

    return Math.max(0, Math.floor(previewMinutes / 10));
}

function assertRecordingSettingsAllowed(camera, data) {
    if (data.recording_duration_hours !== undefined) {
        const hours = Number(data.recording_duration_hours);
        if (!Number.isInteger(hours) || hours < 1 || hours > 2160) {
            const err = new Error('Recording retention must be between 1 and 2160 hours');
            err.statusCode = 400;
            throw err;
        }
    }

    if (data.enable_recording === true || data.enable_recording === 1) {
        const deliveryType = getEffectiveDeliveryType(camera);
        if (!RECORDABLE_DELIVERY_TYPES.has(deliveryType)) {
            const err = new Error('Recording only supports internal HLS or external HLS cameras');
            err.statusCode = 400;
            throw err;
        }
    }
}

class RecordingPlaybackService {
    async startRecording(cameraId, duration_hours, request) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        if (duration_hours) {
            execute(
                'UPDATE cameras SET recording_duration_hours = ? WHERE id = ?',
                [duration_hours, cameraId]
            );
        }

        const result = await recordingControl.start(cameraId, 'admin_start');

        if (result.success) {
            logAdminAction({
                action: 'recording_started',
                camera_id: cameraId,
                camera_name: camera.name,
                duration_hours: duration_hours || camera.recording_duration_hours,
                userId: request.user.id
            }, request);
        }

        return result;
    }

    async stopRecording(cameraId, request) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        const result = await recordingControl.stop(cameraId, { reason: 'admin_stop' });

        if (result.success) {
            logAdminAction({
                action: 'recording_stopped',
                camera_id: cameraId,
                camera_name: camera.name,
                userId: request.user.id
            }, request);
        }

        return result;
    }

    async getRecordingStatus(cameraId) {
        const camera = queryOne(
            'SELECT id, name, enable_recording, recording_status, recording_duration_hours, last_recording_start FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        // Worker mode: the recorder lives in another process, so runtime status comes
        // from what it published to the DB. Storage is DB-backed already.
        const runtimeStatus = await recordingControl.getRuntimeStatus(cameraId);
        const storage = recordingService.getStorageUsage(cameraId);

        return {
            camera_id: camera.id,
            camera_name: camera.name,
            enable_recording: camera.enable_recording,
            recording_status: camera.recording_status,
            recording_duration_hours: camera.recording_duration_hours,
            last_recording_start: camera.last_recording_start,
            runtime_status: runtimeStatus,
            storage,
        };
    }

    async getRecordingsOverview() {
        const cameras = query(`
            SELECT 
                id, 
                name, 
                location,
                enabled,
                status,
                enable_recording, 
                recording_status, 
                recording_duration_hours,
                last_recording_start,
                stream_source
            FROM cameras 
            WHERE enabled = 1
            ORDER BY id ASC
        `);

        const camerasWithStatus = await Promise.all(cameras.map(async (camera) => {
            const runtimeStatus = await recordingControl.getRuntimeStatus(camera.id);
            const storage = recordingService.getStorageUsage(camera.id);

            return {
                ...camera,
                runtime_status: runtimeStatus,
                storage,
            };
        }));

        const activeRecordings = camerasWithStatus.filter((camera) => camera.runtime_status.isRecording).length;
        const totalStorage = camerasWithStatus.reduce((sum, camera) => sum + camera.storage.totalSize, 0);
        const totalStorageGB = (totalStorage / 1024 / 1024 / 1024).toFixed(2);

        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const recentRestarts = query(
            'SELECT COUNT(*) as count FROM restart_logs WHERE restart_time > ?',
            [yesterday]
        );

        return {
            overview: {
                total_cameras: cameras.length,
                active_recordings: activeRecordings,
                total_storage_gb: totalStorageGB,
                recent_restarts_24h: recentRestarts[0].count
            },
            cameras: camerasWithStatus
        };
    }

    getPlaybackCamera(cameraId) {
        const camera = queryOne(`
            SELECT
                id,
                name,
                enabled,
                enable_recording,
                owner_user_id,
                -- area_id decides AREA-scoped token access. Its absence here made this row reach
                -- the token validator with area_id undefined, so every area token was denied for
                -- every camera — and resolvePlaybackAccess swallows that 403 and silently serves
                -- the public preview instead, which is why it looked like nothing was wrong.
                area_id,
                CASE
                    WHEN camera_class IN ('community', 'owner_private', 'subscriber') THEN camera_class
                    ELSE 'community'
                END as camera_class,
                -- Owner playback is gated on this: a suspended rental must not keep serving history.
                billing_status,
                public_playback_mode,
                public_playback_preview_minutes
            FROM cameras
            WHERE id = ?
        `, [cameraId]);

        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }

        return {
            ...camera,
            public_playback_mode: normalizePublicPlaybackMode(camera.public_playback_mode),
            public_playback_preview_minutes: camera.public_playback_preview_minutes,
        };
    }

    resolvePlaybackAccess(camera, request = {}) {
        const rawScope = request?.query?.scope;
        const requestedScope = rawScope === 'admin' || rawScope === 'owner' ? rawScope : 'public';

        if (requestedScope === 'admin') {
            // Staff only. `customer` JWTs are authenticated but must never
            // unlock admin_full playback — the product is live-only for
            // subscribers, and these routes use optionalAuth (the global
            // customer lockout hook does not cover them).
            const role = request?.user?.role;
            if (!request?.user?.id || (role !== 'admin' && role !== 'viewer')) {
                const err = new Error('Unauthorized playback access');
                err.statusCode = 401;
                throw err;
            }

            return {
                accessMode: 'admin_full',
                isPublicPreview: false,
                previewMinutes: null,
                notice: null,
                contact: null,
                deniedReason: null,
            };
        }

        // The camera's owner may replay their own footage — the one deliberate opening in the
        // subscriber live-only rule. Conditions and rationale: rentalPlaybackAccessPolicy.
        if (requestedScope === 'owner') {
            return resolveOwnerScopeAccess(camera, request);
        }

        // Declared before the rental block below, which validates owner-issued tokens too.
        const isPlaylistRequest = request?.url?.includes('/playlist.m3u8');
        const shouldTouchToken = request?.url?.includes('/segments') || isPlaylistRequest;

        if (camera.camera_class && camera.camera_class !== 'community') {
            // One exception: a link the camera's own owner minted for this camera. The conditions
            // (and why each exists) live in rentalPlaybackAccessPolicy.
            const lewatTokenPemilik = resolveOwnerIssuedTokenAccess(camera, request, {
                touch: shouldTouchToken,
                eventType: isPlaylistRequest ? 'access_playlist' : 'access_segments',
                camera,
            }, noteTokenRefusal);
            if (lewatTokenPemilik) {
                return lewatTokenPemilik;
            }

            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: 'camera_admin_only',
            };
        }

        // Cookie-based validation: a stale/revoked/out-of-scope playback
        // cookie must NOT lock the visitor out of public preview. The
        // explicit /activate path already returns the 401/403 properly; here
        // (per-segment cookie sniff) those errors mean "ignore the cookie"
        // and fall through to the public-preview logic — otherwise having
        // an old cookie is strictly worse than having no cookie at all,
        // which is what produced the "page replaced by denial placeholder,
        // camera picker gone" bug.
        let tokenAccess = null;
        try {
            tokenAccess = playbackTokenService.validateRequestForCamera(request, camera.id, {
                touch: shouldTouchToken,
                eventType: isPlaylistRequest ? 'access_playlist' : 'access_segments',
                camera,
            });
        } catch (error) {
            const statusCode = error?.statusCode;
            if (statusCode !== 401 && statusCode !== 403) {
                throw error;
            }
            /*
             * The fall-through is correct — a stale cookie must not be worse than no cookie — but
             * it used to be SILENT, and that is what made this the most expensive line in the file.
             * A token holder whose access was broken looked exactly like an ordinary anonymous
             * visitor: no error, no log, the public preview served as if nothing had happened. A
             * missing area_id in getPlaybackCamera hid behind this for hours; the symptom was
             * "recordings just aren't there", and nothing anywhere said "a token was refused".
             *
             * console.log, not console.error: an expired or out-of-scope cookie is an EXPECTED
             * condition, and stderr is reserved for what a human must act on. Rate-limited per
             * camera+reason because /segments is hit on every camera change — one line per real
             * change of state, not one per request.
             */
            noteTokenRefusal(camera.id, statusCode, error?.message);
            // tokenAccess stays null → falls through to the public-preview
            // resolution below, exactly as if no cookie were attached.
        }
        if (tokenAccess) {
            return {
                accessMode: 'token_full',
                isPublicPreview: false,
                previewMinutes: null,
                playbackWindowHours: tokenAccess.effective_playback_window_hours ?? tokenAccess.playback_window_hours,
                // Absolute date-range depth (if set) is carried alongside the rolling window; the range
                // wins in resolveAccessBounds so the token sees exactly [from, to], nothing newer.
                playbackFrom: tokenAccess.playback_from ?? null,
                playbackTo: tokenAccess.playback_to ?? null,
                tokenId: tokenAccess.id,
                notice: null,
                contact: null,
                deniedReason: null,
            };
        }

        const globalSettings = settingsService.getPublicPlaybackSettings();
        const cameraMode = normalizePublicPlaybackMode(camera.public_playback_mode);

        if (!globalSettings.publicPlaybackEnabled) {
            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: 'public_playback_disabled',
            };
        }

        if (cameraMode === 'disabled' || cameraMode === 'admin_only') {
            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: cameraMode === 'admin_only' ? 'camera_admin_only' : 'camera_public_disabled',
            };
        }

        const resolvedPreviewMinutes = normalizePreviewMinutes(
            camera.public_playback_preview_minutes,
            normalizePreviewMinutes(globalSettings.previewMinutes)
        );

        if (resolvedPreviewMinutes === 0) {
            return {
                accessMode: 'public_denied',
                isPublicPreview: false,
                previewMinutes: 0,
                notice: null,
                contact: null,
                deniedReason: 'public_preview_disabled',
            };
        }

        const contact = this.resolvePlaybackContact(globalSettings.contactMode);
        const notice = globalSettings.notice.enabled
            ? {
                enabled: true,
                title: globalSettings.notice.title,
                text: globalSettings.notice.text,
            }
            : null;

        return {
            accessMode: 'public_preview',
            isPublicPreview: true,
            previewMinutes: resolvedPreviewMinutes,
            notice,
            contact,
            deniedReason: null,
        };
    }

    resolvePlaybackContact(contactMode) {
        if (contactMode !== 'branding_whatsapp') {
            return null;
        }

        const whatsappRow = queryOne(
            'SELECT value FROM branding_settings WHERE key = ?',
            ['whatsapp_number']
        );

        const whatsappNumber = typeof whatsappRow?.value === 'string'
            ? whatsappRow.value.trim()
            : '';

        if (!whatsappNumber) {
            return null;
        }

        return {
            mode: 'branding_whatsapp',
            value: whatsappNumber,
            label: 'Hubungi Admin',
            href: `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Halo Admin, saya ingin informasi lebih lanjut tentang akses playback CCTV.')}`,
        };
    }

    resolvePlaybackContext(cameraId, request) {
        const camera = this.getPlaybackCamera(cameraId);
        const access = this.resolvePlaybackAccess(camera, request);

        if (access.accessMode === 'public_denied') {
            const err = new Error('Playback publik tidak tersedia untuk kamera ini');
            err.statusCode = 403;
            err.playbackAccess = access;
            throw err;
        }

        return { camera, access };
    }

    /**
     * @param {{from: string|null, to: string|null}|null} [range] the slice the caller asked to see,
     *   already intersected with its entitlement. Null means "everything you may reach".
     */
    getAccessibleSegments(cameraId, request, requestedRange = null) {
        const { camera, access } = this.resolvePlaybackContext(cameraId, request);
        /*
         * A public preview is defined by its own minute limit, never by dates. Honouring a range
         * there could answer with an EMPTY preview for a camera that simply has not recorded today.
         */
        const isDeep = DEEP_PLAYBACK_MODES.has(access.accessMode);
        const range = isDeep ? requestedRange : null;
        const previewLimit = getPreviewSegmentLimit(access.previewMinutes);
        // owner_full sees the same full history as staff — for their own camera only.
        //
        // Scope the LOCAL query to the entitled window (request ∩ entitlement) and take the NEWEST rows
        // within it. The old `order:'oldest' LIMIT 1000` (unscoped) kept the oldest 1000 rows overall and
        // dropped the newest — so a recent range on a camera with >1000 local segments (retention >~7d)
        // listed and streamed NOTHING that exists on disk, while the coverage bar drew it green.
        const deepBounds = isDeep ? intersectWithAccessWindow(range, access) : null;
        const queryOptions = isDeep
            ? { cameraId, order: 'latest', limit: 1000, returnAscending: true, fromIso: deepBounds?.from ?? null, toIso: deepBounds?.to ?? null }
            : { cameraId, order: 'latest', limit: previewLimit, returnAscending: true };
        const segmentsAscending = this.applyPlaybackWindow(
            this.mergeArchivedSegments(
                recordingSegmentRepository.findPlaybackSegments(queryOptions),
                cameraId,
                access,
                range
            ),
            access
        ).filter((segment) => isWithinRange(segment, range));

        /*
         * An empty result is NOT a missing resource. A camera that simply has not recorded
         * yet is a normal, expected state, and answering 404 made it indistinguishable from
         * "Camera not found" (also 404) — the frontend had to string-match the message to
         * tell them apart, and every visit to a fresh camera logged a console error on a
         * page that was working correctly. Callers that genuinely cannot represent
         * emptiness (generatePlaylist — an HLS playlist with no segments is meaningless)
         * raise the 404 themselves.
         */
        return {
            camera,
            access,
            segmentsAscending,
            segmentsDescending: [...segmentsAscending].sort(
                (left, right) => new Date(right.start_time) - new Date(left.start_time)
            ),
        };
    }

    buildPlaybackPolicy(access, camera, segmentsAscending) {
        return {
            accessMode: access.accessMode,
            isPublicPreview: access.isPublicPreview,
            previewMinutes: access.previewMinutes,
            notice: access.notice,
            contact: access.contact,
            deniedReason: access.deniedReason,
            playbackWindowHours: access.playbackWindowHours || null,
            tokenId: access.tokenId || null,
            publicPlaybackMode: camera.public_playback_mode,
            segmentCount: segmentsAscending.length,
        };
    }

    /**
     * Add Telegram-archived segments the caller is entitled to, so a token sold with more depth than
     * local retention actually lists that depth instead of stopping at the 4 hours still on disk.
     *
     * Only for token/admin scopes. An anonymous public preview must NOT gain history it never had:
     * its limit is a deliberate product boundary, not an accident of how long files survive.
     *
     * Local rows WIN on a tie. A recent segment exists in both places, and the on-disk copy streams
     * instantly while the archived one costs a re-download from Telegram — same footage, worse trip.
     */
    mergeArchivedSegments(localSegments, cameraId, access, range = null) {
        if (!DEEP_PLAYBACK_MODES.has(access?.accessMode)) {
            return localSegments;
        }

        const archived = archivedSegmentSourceService.listArchivedSegments(cameraId, {
            range: intersectWithAccessWindow(range, access),
        });
        if (archived.length === 0) {
            return localSegments;
        }

        const seen = new Set(localSegments.map((segment) => segment.id));
        const merged = localSegments.concat(archived.filter((segment) => !seen.has(segment.id)));
        merged.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        return merged;
    }

    applyPlaybackWindow(segments, access) {
        // Bounds unify the rolling window (floor now−N) and an absolute range [from, to] — range wins,
        // adding the CEILING a rolling window never had.
        const { fromIso, toIso } = resolveAccessBounds(access);
        if (!fromIso && !toIso) return segments;
        const fromMs = fromIso ? Date.parse(fromIso) : null;
        const toMs = toIso ? Date.parse(toIso) : null;
        return segments.filter((segment) => {
            const atMs = new Date(segment.start_time).getTime();
            return Number.isFinite(atMs) && (fromMs === null || atMs >= fromMs) && (toMs === null || atMs <= toMs);
        });
    }

    /**
     * `from`/`to` in the query narrow the LIST only. `coverage` deliberately ignores them and
     * describes the whole reachable span: a bar that only ever draws the day already on screen
     * cannot show that another day is missing, which is the one thing the bar is for.
     *
     * Only for scopes that can actually reach that depth. Handing a public preview a map of ten
     * days it may not watch would both mislead the visitor and publish our retention.
     */
    getSegments(cameraId, request) {
        const { camera, access, segmentsAscending, segmentsDescending } = this.getAccessibleSegments(
            cameraId, request, parsePlaybackRange(request?.query),
        );
        const canBrowseDepth = DEEP_PLAYBACK_MODES.has(access.accessMode);

        return {
            camera_id: camera.id,
            camera_name: camera.name,
            segments: segmentsDescending.map(toPublicSegment),
            total_segments: segmentsDescending.length,
            coverage: canBrowseDepth
                ? recordingCoverageRunsService.getCoverage(camera.id, intersectWithAccessWindow(null, access))
                : null,
            playback_policy: this.buildPlaybackPolicy(access, camera, segmentsAscending),
        };
    }

    getStreamSegment(cameraId, filename, request) {
        const { access } = this.resolvePlaybackContext(cameraId, request);
        const segment = recordingSegmentRepository.findSegmentByFilename({ cameraId, filename });

        if (!segment) {
            const err = new Error('Segment not available for this playback scope');
            err.statusCode = 403;
            throw err;
        }

        if (access.accessMode !== 'admin_full' && access.accessMode !== 'owner_full') {
            if (access.accessMode === 'token_full') {
                // Same bounds as the list: floor AND (for an absolute range) ceiling, so a range token
                // cannot stream a segment newer than its `to`.
                const { fromIso, toIso } = resolveAccessBounds(access);
                const allowedSegment = recordingSegmentRepository.findSegmentInWindow({
                    cameraId,
                    filename,
                    startAfterIso: fromIso,
                    startBeforeIso: toIso,
                });
                if (!allowedSegment) {
                    const err = new Error('Segment not available for this playback scope');
                    err.statusCode = 403;
                    throw err;
                }
            } else {
                const previewSegments = recordingSegmentRepository.findPlaybackSegments({
                    cameraId,
                    order: 'latest',
                    limit: getPreviewSegmentLimit(access.previewMinutes),
                    returnAscending: true,
                });

                if (!previewSegments.some((item) => item.filename === filename)) {
                    const err = new Error('Segment not available for this playback scope');
                    err.statusCode = 403;
                    throw err;
                }
            }
        }

        if (!isSafeRecordingFilePath({
            recordingsBasePath: RECORDINGS_BASE_PATH,
            cameraId,
            filePath: segment.file_path,
            filename,
        })) {
            const err = new Error('Segment file path is not safe');
            err.statusCode = 403;
            throw err;
        }

        if (!existsSync(segment.file_path)) {
            const err = new Error('Segment file not found on disk');
            err.statusCode = 404;
            throw err;
        }

        const stats = statSync(segment.file_path);

        return {
            segment: {
                ...segment,
                resolved_file_size: stats.size,
            },
            stats,
        };
    }

    generatePlaylist(cameraId, request) {
        const { access, segmentsAscending } = this.getAccessibleSegments(cameraId, request);

        // Unlike the JSON segment list, an HLS playlist cannot express "nothing here" —
        // a player handed an empty manifest stalls rather than reporting the condition.
        if (segmentsAscending.length === 0) {
            const err = new Error('No segments found');
            err.statusCode = 404;
            throw err;
        }

        let playlist = '#EXTM3U\n';
        playlist += '#EXT-X-VERSION:3\n';
        playlist += '#EXT-X-TARGETDURATION:600\n';
        playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';

        const querySuffix = access.accessMode === 'admin_full' ? '?scope=admin' : '';

        segmentsAscending.forEach((segment) => {
            playlist += `#EXTINF:${segment.duration}.0,\n`;
            playlist += `/api/recordings/${cameraId}/stream/${segment.filename}${querySuffix}\n`;
        });

        playlist += '#EXT-X-ENDLIST\n';

        return playlist;
    }

    getRestartLogs(cameraId, limit = 50) {
        let logs;
        if (cameraId) {
            logs = query(
                `SELECT * FROM restart_logs 
                WHERE camera_id = ? 
                ORDER BY restart_time DESC 
                LIMIT ?`,
                [cameraId, limit]
            );
        } else {
            logs = query(
                `SELECT rl.*, c.name as camera_name 
                FROM restart_logs rl
                LEFT JOIN cameras c ON rl.camera_id = c.id
                ORDER BY rl.restart_time DESC 
                LIMIT ?`,
                [limit]
            );
        }
        return logs;
    }

    async updateRecordingSettings(cameraId, data, request) {
        const {
            enable_recording,
            recording_duration_hours,
            public_playback_mode,
            public_playback_preview_minutes,
        } = data;

        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            const err = new Error('Camera not found');
            err.statusCode = 404;
            throw err;
        }
        assertRecordingSettingsAllowed(camera, data);

        const updates = [];
        const values = [];

        if (enable_recording !== undefined) {
            updates.push('enable_recording = ?');
            values.push(enable_recording ? 1 : 0);
        }

        if (recording_duration_hours !== undefined) {
            updates.push('recording_duration_hours = ?');
            values.push(recording_duration_hours);
        }

        if (public_playback_mode !== undefined) {
            updates.push('public_playback_mode = ?');
            values.push(normalizePublicPlaybackMode(public_playback_mode));
        }

        if (public_playback_preview_minutes !== undefined) {
            updates.push('public_playback_preview_minutes = ?');
            values.push(
                public_playback_preview_minutes === null || public_playback_preview_minutes === ''
                    ? null
                    : normalizePreviewMinutes(public_playback_preview_minutes)
            );
        }

        if (updates.length === 0) {
            const err = new Error('No settings to update');
            err.statusCode = 400;
            throw err;
        }

        values.push(cameraId);

        execute(
            `UPDATE cameras SET ${updates.join(', ')} WHERE id = ?`,
            values
        );

        if (enable_recording !== undefined) {
            // Delegate to reconciler so the same policy used by periodic safety net
            // (delivery type, online state, cooldown) decides start vs stop.
            await recordingControl.reconcile(cameraId, 'settings_changed');
        }

        logAdminAction({
            action: 'recording_settings_updated',
            camera_id: cameraId,
            camera_name: camera.name,
            changes: {
                enable_recording,
                recording_duration_hours,
                public_playback_mode,
                public_playback_preview_minutes,
            },
            userId: request.user.id
        }, request);
    }
}

export default new RecordingPlaybackService();
