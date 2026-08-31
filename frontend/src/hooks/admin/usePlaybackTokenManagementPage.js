/*
 * Purpose: Own admin playback token management state, payload shaping, sharing, and mutations.
 * Caller: PlaybackTokenManagement page.
 * Deps: React hooks, cameraService, playbackTokenService, NotificationContext, TimezoneContext.
 * MainFuncs: usePlaybackTokenManagementPage, buildTokenCameraRulesPayload.
 * SideEffects: Calls admin playback token APIs and browser clipboard/share APIs through handlers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cameraService } from '../../services/cameraService';
import playbackTokenService from '../../services/playbackTokenService.js';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useNotification } from '../../contexts/NotificationContext';
import { TIMESTAMP_STORAGE, useTimezone } from '../../contexts/TimezoneContext';
import { friendlyToHours, hoursToFriendly } from '../../utils/durationUnits.js';

export const DEFAULT_PLAYBACK_TOKEN_TEMPLATE = `Halo, berikut token akses playback RAF CCTV.

Kode Akses: {{token}}
Link: {{playback_url}}
Berlaku: {{expires_at}}
Rekaman: {{playback_window}}
Akses: {{camera_scope}}`;

export const PLAYBACK_TOKEN_PRESETS = [
    { value: 'trial_1d', label: 'Trial 1 Hari' },
    { value: 'trial_3d', label: 'Trial 3 Hari' },
    { value: 'client_30d', label: 'Client 30 Hari' },
    { value: 'lifetime', label: 'Lifetime' },
    { value: 'custom', label: 'Custom' },
];

// Presets are QUICK-FILLS now, not locks: picking one pre-fills the depth + expiry fields (both still
// editable). null = unlimited/forever. 'custom' is absent → it leaves whatever you already typed.
const PRESET_FILL = {
    trial_1d: { windowHours: 24, expiresInHours: 24 },
    trial_3d: { windowHours: 72, expiresInHours: 72 },
    client_30d: { windowHours: 24 * 30, expiresInHours: 24 * 30 },
    lifetime: { windowHours: null, expiresInHours: null },
};

// A timestamp → a `<input type="datetime-local">` value in LOCAL time ("YYYY-MM-DDTHH:mm").
function toDateTimeLocalInput(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A STORED value (UTC SQL "YYYY-MM-DD HH:MM:SS") → a LOCAL datetime-local value for the edit form.
// The stored value is UTC; the form shows it as browser-local wall-clock, and localInputToUtcIso below
// converts it straight back to UTC on save, so the round-trip is exact regardless of the server tz.
// An already-local value (create form, edit-in-progress) is passed through unchanged.
function utcSqlToLocalInput(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (s.includes('T') && !/(Z|[+-]\d\d:?\d\d)$/.test(s)) return s.slice(0, 16);
    const ms = Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
    return Number.isFinite(ms) ? toDateTimeLocalInput(ms) : '';
}

// A `<input type="datetime-local">` value is browser-local wall-clock ("YYYY-MM-DDTHH:mm"). Send it as an
// explicit UTC ISO ("...Z"), NOT as the naive string, so the stored instant never depends on the SERVER
// process timezone. Prod's Node process runs in UTC, so a naive "02:10" was parsed AS 02:10 UTC and the
// customer's WIB wall-clock landed 7h off (typed 02:10 → shown 09:10 on the public panel). Converting in
// the browser makes 02:10 mean 02:10 here, deterministically. Empty → null (inherit / no bound).
function localInputToUtcIso(value) {
    if (!value) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const PLAYBACK_TOKEN_SESSION_LIMIT_MODES = [
    { value: '', label: 'Ikuti preset' },
    { value: 'strict', label: 'Tolak device baru' },
    { value: 'replace_oldest', label: 'Ganti device terlama' },
    { value: 'unlimited', label: 'Unlimited' },
];

export const CAMERA_PICKER_VISIBLE_LIMIT = 100;

function normalizeCameraRows(response) {
    const rows = response?.data?.cameras || response?.data || [];
    return Array.isArray(rows) ? rows : [];
}

function normalizeNumberOrNull(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function extractPlaybackTokenShareText(response = {}) {
    return String(
        response.share_text
        || response.shareText
        || response.data?.share_text
        || response.data?.shareText
        || ''
    ).trim();
}

export function normalizePlaybackTokenCameraSearch(value = '') {
    return String(value).trim().toLowerCase();
}

export function cameraMatchesPlaybackTokenSearch(camera = {}, searchValue = '') {
    const search = normalizePlaybackTokenCameraSearch(searchValue);
    if (!search) {
        return true;
    }

    return [
        camera.id,
        camera.name,
        camera.area_name,
        camera.areaName,
    ].some((value) => String(value || '').toLowerCase().includes(search));
}

export function buildVisiblePlaybackTokenCameras({
    cameras = [],
    selectedIds = [],
    search = '',
    limit = CAMERA_PICKER_VISIBLE_LIMIT,
}) {
    const selectedIdSet = new Set(Array.from(selectedIds).map((id) => Number.parseInt(id, 10)));
    const selected = cameras.filter((camera) => selectedIdSet.has(Number.parseInt(camera.id, 10)));
    const unselectedMatches = cameras.filter((camera) => {
        const cameraId = Number.parseInt(camera.id, 10);
        return !selectedIdSet.has(cameraId) && cameraMatchesPlaybackTokenSearch(camera, search);
    });

    return [
        ...selected,
        ...unselectedMatches.slice(0, limit),
    ];
}

function buildInitialRuleMap(rules = [], fallbackIds = []) {
    const ruleMap = {};
    fallbackIds.forEach((cameraId) => {
        ruleMap[cameraId] = {
            camera_id: cameraId,
            enabled: true,
            playback_window_hours: '',
            expires_at: '',
            note: '',
        };
    });
    rules.forEach((rule) => {
        const cameraId = Number.parseInt(rule.camera_id, 10);
        if (!Number.isInteger(cameraId) || cameraId <= 0) {
            return;
        }

        ruleMap[cameraId] = {
            camera_id: cameraId,
            enabled: rule.enabled !== false,
            playback_window_hours: rule.playback_window_hours || '',
            // Convert stored UTC → local so re-saving an untouched rule doesn't drift its expiry.
            expires_at: utcSqlToLocalInput(rule.expires_at),
            note: rule.note || '',
        };
    });
    return ruleMap;
}

// Depth payload for a token form: rolling → hours (value+unit); range → absolute from/to. In range
// mode the window is nulled so the backend reads the range (which wins there anyway).
function buildDepthPayload(form) {
    if (form.depth_mode === 'range') {
        return {
            playback_window_hours: null,
            playback_from: localInputToUtcIso(form.playback_from),
            playback_to: localInputToUtcIso(form.playback_to),
        };
    }
    return {
        playback_window_hours: friendlyToHours(form.playback_window_value, form.playback_window_unit),
        playback_from: null,
        playback_to: null,
    };
}

export function buildTokenCameraRulesPayload(ruleMap) {
    return Object.values(ruleMap)
        .filter((rule) => rule.enabled)
        .map((rule) => ({
            camera_id: Number.parseInt(rule.camera_id, 10),
            enabled: true,
            playback_window_hours: normalizeNumberOrNull(rule.playback_window_hours),
            expires_at: localInputToUtcIso(rule.expires_at),
            note: rule.note || '',
        }))
        .filter((rule) => Number.isInteger(rule.camera_id) && rule.camera_id > 0);
}

function createDefaultForm() {
    // Start pre-filled from the default preset so the live preview is honest from the first render.
    const fill = PRESET_FILL.trial_3d;
    const wf = hoursToFriendly(fill.windowHours);
    return {
        label: '',
        preset: 'trial_3d',
        scope_type: 'all',
        camera_ids: [],
        // Areas, not cameras: an 'area' token resolves its cameras at access time, so this list is
        // what makes a camera added to the area later covered by a token issued earlier.
        area_ids: [],
        camera_rules: {},
        // Depth is EITHER a rolling window ('rolling') OR an absolute date range ('range').
        depth_mode: 'rolling',
        playback_window_value: wf.value,
        playback_window_unit: wf.unit,
        playback_from: '',
        playback_to: '',
        expires_at: toDateTimeLocalInput(Date.now() + fill.expiresInHours * 60 * 60 * 1000),
        access_code_mode: 'auto',
        access_code_length: 8,
        custom_access_code: '',
        max_active_sessions: '',
        session_limit_mode: '',
        session_timeout_seconds: '',
        client_note: '',
        share_template: DEFAULT_PLAYBACK_TOKEN_TEMPLATE,
    };
}

export function formatPlaybackTokenSessionPolicy(token) {
    const modeLabels = {
        strict: 'Strict',
        replace_oldest: 'Replace oldest',
        unlimited: 'Unlimited',
    };
    const mode = token.session_limit_mode || 'unlimited';
    const limit = token.max_active_sessions
        ? `${token.active_session_count || 0}/${token.max_active_sessions}`
        : `${token.active_session_count || 0}`;
    return `${limit} aktif - ${modeLabels[mode] || mode}`;
}

export function usePlaybackTokenManagementPage() {
    const { success: showSuccess, error: showError } = useNotification();
    const confirm = useConfirm();
    const { formatDateTime } = useTimezone();
    const [tokens, setTokens] = useState([]);
    const [auditLogs, setAuditLogs] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [cameraSearch, setCameraSearch] = useState('');
    const [editCameraSearch, setEditCameraSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sharingTokenId, setSharingTokenId] = useState(null);
    const [editingTokenId, setEditingTokenId] = useState(null);
    const [updatingTokenId, setUpdatingTokenId] = useState(null);
    const [createdShare, setCreatedShare] = useState(null);
    // Sharing an EXISTING row is shown where the finger already is, not in the panel beside the
    // form: that panel sits at the top of the page, so re-sharing the twelfth token meant scrolling
    // all the way up to find the result. Creating a token still uses the panel — you are up there.
    const [sharePreview, setSharePreview] = useState(null);
    const [deletingTokenId, setDeletingTokenId] = useState(null);
    // The audit trail is its own view: which token, and how far back. Both were fixed before —
    // always every token, always the newest 50 — with no way to ask for anything else.
    const [auditTokenId, setAuditTokenId] = useState('');
    const [auditLimit, setAuditLimit] = useState(50);
    const [form, setForm] = useState(createDefaultForm);
    const [editForm, setEditForm] = useState({
        label: '',
        scope_type: 'all',
        camera_ids: [],
        // Areas, not cameras: an 'area' token resolves its cameras at access time, so this list is
        // what makes a camera added to the area later covered by a token issued earlier.
        area_ids: [],
        camera_rules: {},
        depth_mode: 'rolling',
        playback_window_value: '',
        playback_window_unit: 'day',
        playback_from: '',
        playback_to: '',
        expires_at: '',
        max_active_sessions: '',
        session_limit_mode: 'unlimited',
        session_timeout_seconds: 60,
        client_note: '',
        share_template: DEFAULT_PLAYBACK_TOKEN_TEMPLATE,
    });

    const selectedCameraIds = useMemo(
        () => new Set(buildTokenCameraRulesPayload(form.camera_rules).map((rule) => rule.camera_id)),
        [form.camera_rules]
    );
    const selectedEditCameraIds = useMemo(
        () => new Set(buildTokenCameraRulesPayload(editForm.camera_rules).map((rule) => rule.camera_id)),
        [editForm.camera_rules]
    );
    /*
     * Derived from the cameras already loaded rather than fetched separately — one less request, and
     * it cannot drift from the camera list the admin is looking at. Cameras with no area are simply
     * absent here, which is correct: an area token can never reach them, and the access check denies
     * them explicitly rather than relying on this list.
     */
    const areaOptions = useMemo(() => {
        const seen = new Map();
        for (const camera of cameras) {
            const areaId = Number.parseInt(camera?.area_id, 10);
            if (!Number.isInteger(areaId) || areaId <= 0) continue;
            const entry = seen.get(areaId) || { id: areaId, name: camera.area_name || `Area ${areaId}`, cameraCount: 0 };
            entry.cameraCount += 1;
            seen.set(areaId, entry);
        }
        return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [cameras]);

    const visibleCreateCameras = useMemo(() => buildVisiblePlaybackTokenCameras({
        cameras,
        selectedIds: selectedCameraIds,
        search: cameraSearch,
    }), [cameras, selectedCameraIds, cameraSearch]);
    const visibleEditCameras = useMemo(() => buildVisiblePlaybackTokenCameras({
        cameras,
        selectedIds: selectedEditCameraIds,
        search: editCameraSearch,
    }), [cameras, selectedEditCameraIds, editCameraSearch]);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [tokenResponse, auditResponse, cameraResponse] = await Promise.all([
                playbackTokenService.listTokens(),
                playbackTokenService.listAuditLogs(auditLimit, auditTokenId || null),
                cameraService.getAllCameras(),
            ]);
            setTokens(Array.isArray(tokenResponse?.data) ? tokenResponse.data : []);
            setAuditLogs(Array.isArray(auditResponse?.data) ? auditResponse.data : []);
            setCameras(normalizeCameraRows(cameraResponse));
            if (!tokenResponse?.success) {
                showError('Gagal memuat token playback', tokenResponse?.message || 'Daftar token tidak bisa dimuat.');
            }
        } catch (error) {
            showError('Gagal memuat token playback', error?.response?.data?.message || error.message);
        } finally {
            setLoading(false);
        }
    }, [showError, auditLimit, auditTokenId]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const updateForm = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    // Preset = quick-fill: pre-fill depth + expiry (still editable). 'custom' keeps whatever's typed.
    const handlePresetChange = (preset) => {
        setForm((current) => {
            const fill = PRESET_FILL[preset];
            if (!fill) return { ...current, preset };
            const wf = hoursToFriendly(fill.windowHours);
            return {
                ...current,
                preset,
                // Presets are rolling windows, so a preset also switches depth mode back to rolling.
                depth_mode: 'rolling',
                playback_from: '',
                playback_to: '',
                playback_window_value: fill.windowHours ? wf.value : '',
                playback_window_unit: fill.windowHours ? wf.unit : 'day',
                expires_at: fill.expiresInHours
                    ? toDateTimeLocalInput(Date.now() + fill.expiresInHours * 60 * 60 * 1000)
                    : '',
            };
        });
    };

    const updateEditForm = (key, value) => {
        setEditForm((current) => ({ ...current, [key]: value }));
    };

    const toggleCameraRule = (cameraId, forcedValue = null) => {
        setForm((current) => {
            const existing = current.camera_rules[cameraId] || {
                camera_id: cameraId,
                enabled: false,
                playback_window_hours: '',
                expires_at: '',
                note: '',
            };
            const enabled = forcedValue === null ? !existing.enabled : Boolean(forcedValue);
            return {
                ...current,
                camera_ids: enabled
                    ? [...new Set([...current.camera_ids, cameraId])]
                    : current.camera_ids.filter((id) => id !== cameraId),
                camera_rules: {
                    ...current.camera_rules,
                    [cameraId]: { ...existing, enabled },
                },
            };
        });
    };

    const toggleArea = (areaId) => {
        setForm((current) => ({
            ...current,
            area_ids: current.area_ids.includes(areaId)
                ? current.area_ids.filter((id) => id !== areaId)
                : [...current.area_ids, areaId],
        }));
    };

    const toggleEditArea = (areaId) => {
        setEditForm((current) => {
            const areaIds = Array.isArray(current.area_ids) ? current.area_ids : [];
            return {
                ...current,
                area_ids: areaIds.includes(areaId)
                    ? areaIds.filter((id) => id !== areaId)
                    : [...areaIds, areaId],
            };
        });
    };

    const updateCameraRule = (cameraId, key, value) => {
        setForm((current) => ({
            ...current,
            camera_rules: {
                ...current.camera_rules,
                [cameraId]: {
                    camera_id: cameraId,
                    enabled: true,
                    playback_window_hours: '',
                    expires_at: '',
                    note: '',
                    ...(current.camera_rules[cameraId] || {}),
                    [key]: value,
                },
            },
            camera_ids: [...new Set([...current.camera_ids, cameraId])],
        }));
    };

    const toggleEditCameraRule = (cameraId, forcedValue = null) => {
        setEditForm((current) => {
            const existing = current.camera_rules[cameraId] || {
                camera_id: cameraId,
                enabled: false,
                playback_window_hours: '',
                expires_at: '',
                note: '',
            };
            const enabled = forcedValue === null ? !existing.enabled : Boolean(forcedValue);
            return {
                ...current,
                camera_ids: enabled
                    ? [...new Set([...current.camera_ids, cameraId])]
                    : current.camera_ids.filter((id) => id !== cameraId),
                camera_rules: {
                    ...current.camera_rules,
                    [cameraId]: { ...existing, enabled },
                },
            };
        });
    };

    const updateEditCameraRule = (cameraId, key, value) => {
        setEditForm((current) => ({
            ...current,
            camera_rules: {
                ...current.camera_rules,
                [cameraId]: {
                    camera_id: cameraId,
                    enabled: true,
                    playback_window_hours: '',
                    expires_at: '',
                    note: '',
                    ...(current.camera_rules[cameraId] || {}),
                    [key]: value,
                },
            },
            camera_ids: [...new Set([...current.camera_ids, cameraId])],
        }));
    };

    const formatTokenDate = useCallback((value) => {
        if (!value) {
            return 'Selamanya';
        }

        return formatDateTime(value, {
            storage: TIMESTAMP_STORAGE.UTC_SQL,
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: undefined,
        });
    }, [formatDateTime]);

    const beginEditToken = (token) => {
        const fallbackIds = token.allowed_camera_ids || token.camera_ids || [];
        setEditingTokenId(token.id);
        setEditCameraSearch('');
        setEditForm({
            label: token.label || '',
            scope_type: token.scope_type || 'all',
            // Without this an area token opened its editor with no areas loaded, so the form could
            // not show which areas it covered — and the select had no 'area' option to show anyway.
            area_ids: Array.isArray(token.area_ids) ? [...token.area_ids] : [],
            camera_ids: fallbackIds,
            camera_rules: buildInitialRuleMap(token.camera_rules || [], fallbackIds),
            depth_mode: (token.playback_from || token.playback_to) ? 'range' : 'rolling',
            playback_window_value: hoursToFriendly(token.playback_window_hours).value,
            playback_window_unit: hoursToFriendly(token.playback_window_hours).unit,
            // Convert stored UTC → local so an untouched date isn't re-interpreted (and drifted) on save.
            playback_from: utcSqlToLocalInput(token.playback_from),
            playback_to: utcSqlToLocalInput(token.playback_to),
            expires_at: utcSqlToLocalInput(token.expires_at),
            max_active_sessions: token.max_active_sessions ?? '',
            session_limit_mode: token.session_limit_mode || 'unlimited',
            session_timeout_seconds: token.session_timeout_seconds || 60,
            client_note: token.client_note || '',
            share_template: token.share_template || DEFAULT_PLAYBACK_TOKEN_TEMPLATE,
        });
    };

    const cancelEditToken = () => {
        setEditingTokenId(null);
        setUpdatingTokenId(null);
        setEditCameraSearch('');
    };

    const handleCreate = async (event) => {
        event.preventDefault();
        setSaving(true);
        try {
            const cameraRules = buildTokenCameraRulesPayload(form.camera_rules);
            const payload = {
                ...form,
                camera_ids: cameraRules.map((rule) => rule.camera_id),
                camera_rules: cameraRules,
                ...buildDepthPayload(form),
                expires_at: localInputToUtcIso(form.expires_at),
            };
            const response = await playbackTokenService.createToken(payload);
            if (!response.success) {
                showError('Gagal membuat token', response.message || 'Token gagal dibuat.');
                return;
            }
            const shareText = extractPlaybackTokenShareText(response);
            if (shareText) {
                setCreatedShare({ shareText });
                showSuccess('Token playback dibuat', 'Teks share memakai kode akses aktif yang bisa dibagikan ulang.');
            } else {
                setCreatedShare(null);
                showError('Teks share kosong', 'Backend tidak mengirim teks share token.');
            }
            setForm((current) => ({ ...current, label: '', camera_ids: [], area_ids: [], camera_rules: {}, custom_access_code: '' }));
            setCameraSearch('');
            await loadData();
        } catch (error) {
            showError('Gagal membuat token', error?.response?.data?.message || error.message);
        } finally {
            setSaving(false);
        }
    };

    const handleCopy = async (text) => {
        const shareText = String(text || '').trim();
        if (!shareText) {
            showError('Teks share kosong', 'Tidak ada teks token yang bisa disalin.');
            return;
        }

        await navigator.clipboard.writeText(shareText);
        showSuccess('Disalin', 'Teks share token sudah disalin.');
    };

    const handleNativeShare = async (text = createdShare?.shareText) => {
        const shareText = String(text || '').trim();
        if (!shareText) {
            showError('Teks share kosong', 'Tidak ada teks token yang bisa dibagikan.');
            return;
        }

        if (navigator.share) {
            await navigator.share({ text: shareText });
            return;
        }

        await handleCopy(shareText);
    };

    const handleRepeatShare = async (tokenId) => {
        setSharingTokenId(tokenId);
        try {
            const response = await playbackTokenService.shareToken(tokenId);
            if (!response.success) {
                showError('Gagal membuat share ulang', response.message || 'Teks share gagal dibuat.');
                return;
            }
            const shareText = extractPlaybackTokenShareText(response);
            if (shareText) {
                const token = tokens.find((row) => row.id === tokenId);
                setSharePreview({ tokenId, label: token?.label || 'Token', shareText });
            } else {
                setSharePreview(null);
                showError('Teks share kosong', 'Backend tidak mengirim teks share token.');
            }
        } catch (error) {
            showError('Gagal membuat share ulang', error?.response?.data?.message || error.message);
        } finally {
            setSharingTokenId(null);
        }
    };

    const handleClearSessions = async (tokenId) => {
        try {
            const response = await playbackTokenService.clearSessions(tokenId);
            if (!response.success) {
                showError('Gagal membersihkan session', response.message || 'Session token gagal direset.');
                return;
            }
            showSuccess('Session dibersihkan', `${response?.data?.cleared || 0} session aktif dihentikan.`);
            await loadData();
        } catch (error) {
            showError('Gagal membersihkan session', error?.response?.data?.message || error.message);
        }
    };

    const handleUpdateToken = async (tokenId) => {
        setUpdatingTokenId(tokenId);
        try {
            const cameraRules = buildTokenCameraRulesPayload(editForm.camera_rules);
            const response = await playbackTokenService.updateToken(tokenId, {
                label: editForm.label,
                scope_type: editForm.scope_type,
                area_ids: editForm.area_ids || [],
                camera_ids: cameraRules.map((rule) => rule.camera_id),
                camera_rules: cameraRules,
                ...buildDepthPayload(editForm),
                expires_at: localInputToUtcIso(editForm.expires_at),
                max_active_sessions: editForm.max_active_sessions === '' ? null : editForm.max_active_sessions,
                session_limit_mode: editForm.session_limit_mode,
                session_timeout_seconds: editForm.session_timeout_seconds,
                client_note: editForm.client_note,
                share_template: editForm.share_template,
            });
            if (!response.success) {
                showError('Gagal memperbarui token', response.message || 'Policy token gagal disimpan.');
                return;
            }
            showSuccess('Token diperbarui', 'Policy token aktif sudah disimpan.');
            setEditingTokenId(null);
            setEditCameraSearch('');
            await loadData();
        } catch (error) {
            showError('Gagal memperbarui token', error?.response?.data?.message || error.message);
        } finally {
            setUpdatingTokenId(null);
        }
    };

    const handleRevoke = async (tokenId) => {
        try {
            const response = await playbackTokenService.revokeToken(tokenId);
            if (!response.success) {
                showError('Gagal mencabut token', response.message || 'Token gagal dicabut.');
                return;
            }
            showSuccess('Token dicabut', 'Token tidak bisa digunakan lagi.');
            await loadData();
        } catch (error) {
            showError('Gagal mencabut token', error?.response?.data?.message || error.message);
        }
    };

    /**
     * Permanent removal, which revoking never was. Revoke only stamps revoked_at, so every trial
     * token stayed on the list as another identical-looking dead row.
     *
     * A LIVE token can be deleted too — requiring a revoke first would be two steps for the common
     * case of clearing an experiment. The confirmation says outright when access is about to be cut.
     */
    const handleDelete = async (tokenId) => {
        const token = tokens.find((row) => row.id === tokenId);
        const label = token?.label || 'token ini';
        const ok = await confirm({
            title: 'Hapus token permanen?',
            message: token?.is_active
                ? `"${label}" masih AKTIF. Menghapusnya memutus akses siapa pun yang sedang memakainya, dan tidak bisa dibatalkan. Riwayat aksesnya tetap tersimpan.`
                : `"${label}" akan dihapus permanen dan tidak bisa dikembalikan. Riwayat aksesnya tetap tersimpan.`,
            confirmLabel: 'Hapus permanen',
            tone: 'danger',
        });
        if (!ok) return;

        setDeletingTokenId(tokenId);
        try {
            const response = await playbackTokenService.deleteToken(tokenId);
            if (!response.success) {
                showError('Gagal menghapus token', response.message || 'Token gagal dihapus.');
                return;
            }
            // The row is gone, so an on-screen confirmation is the only thing left saying which one.
            showSuccess('Token dihapus', response.message || `"${label}" dihapus permanen.`);
            if (sharePreview?.tokenId === tokenId) setSharePreview(null);
            await loadData();
        } catch (error) {
            showError('Gagal menghapus token', error?.response?.data?.message || error.message);
        } finally {
            setDeletingTokenId(null);
        }
    };

    const whatsappHref = createdShare?.shareText
        ? `https://wa.me/?text=${encodeURIComponent(createdShare.shareText)}`
        : '#';

    return {
        tokens,
        auditLogs,
        cameras,
        cameraSearch,
        editCameraSearch,
        visibleCreateCameras,
        visibleEditCameras,
        cameraPickerVisibleLimit: CAMERA_PICKER_VISIBLE_LIMIT,
        loading,
        saving,
        sharingTokenId,
        editingTokenId,
        updatingTokenId,
        createdShare,
        form,
        editForm,
        selectedCameraIds,
        selectedEditCameraIds,
        areaOptions,
        toggleArea,
        whatsappHref,
        loadData,
        setCameraSearch,
        setEditCameraSearch,
        updateForm,
        handlePresetChange,
        updateEditForm,
        toggleCameraRule,
        updateCameraRule,
        toggleEditCameraRule,
        updateEditCameraRule,
        formatTokenDate,
        beginEditToken,
        cancelEditToken,
        handleCreate,
        handleCopy,
        handleNativeShare,
        handleRepeatShare,
        handleClearSessions,
        handleUpdateToken,
        handleRevoke,
        handleDelete,
        toggleEditArea,
        selectedEditAreaIds: new Set(editForm.area_ids || []),
        auditTokenId,
        setAuditTokenId,
        auditLimit,
        showMoreAuditLogs: () => setAuditLimit((current) => Math.min(current + 50, 200)),
        // 200 is the backend's hard cap on this endpoint, so past it the button would lie.
        canShowMoreAuditLogs: auditLimit < 200 && auditLogs.length >= auditLimit,
        sharePreview,
        setSharePreview,
        deletingTokenId,
    };
}
