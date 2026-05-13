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
import { useNotification } from '../../contexts/NotificationContext';
import { TIMESTAMP_STORAGE, useTimezone } from '../../contexts/TimezoneContext';

export const DEFAULT_PLAYBACK_TOKEN_TEMPLATE = `Halo, berikut token akses playback CCTV RAF NET.

Kode Akses: {{token}}
Link: {{playback_url}}
Berlaku: {{expires_at}}
Akses: {{camera_scope}}`;

export const PLAYBACK_TOKEN_PRESETS = [
    { value: 'trial_1d', label: 'Trial 1 Hari' },
    { value: 'trial_3d', label: 'Trial 3 Hari' },
    { value: 'client_30d', label: 'Client 30 Hari' },
    { value: 'lifetime', label: 'Lifetime' },
    { value: 'custom', label: 'Custom' },
];

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
            expires_at: rule.expires_at || '',
            note: rule.note || '',
        };
    });
    return ruleMap;
}

export function buildTokenCameraRulesPayload(ruleMap) {
    return Object.values(ruleMap)
        .filter((rule) => rule.enabled)
        .map((rule) => ({
            camera_id: Number.parseInt(rule.camera_id, 10),
            enabled: true,
            playback_window_hours: normalizeNumberOrNull(rule.playback_window_hours),
            expires_at: rule.expires_at || null,
            note: rule.note || '',
        }))
        .filter((rule) => Number.isInteger(rule.camera_id) && rule.camera_id > 0);
}

function createDefaultForm() {
    return {
        label: '',
        preset: 'trial_3d',
        scope_type: 'all',
        camera_ids: [],
        camera_rules: {},
        playback_window_hours: '',
        expires_at: '',
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
    const [form, setForm] = useState(createDefaultForm);
    const [editForm, setEditForm] = useState({
        label: '',
        scope_type: 'all',
        camera_ids: [],
        camera_rules: {},
        playback_window_hours: '',
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
                playbackTokenService.listAuditLogs(50),
                cameraService.getAllCameras(),
            ]);
            setTokens(Array.isArray(tokenResponse?.data) ? tokenResponse.data : []);
            setAuditLogs(Array.isArray(auditResponse?.data) ? auditResponse.data : []);
            setCameras(normalizeCameraRows(cameraResponse));
        } catch (error) {
            showError('Gagal memuat token playback', error?.response?.data?.message || error.message);
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const updateForm = (key, value) => {
        setForm((current) => ({ ...current, [key]: value }));
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
            camera_ids: fallbackIds,
            camera_rules: buildInitialRuleMap(token.camera_rules || [], fallbackIds),
            playback_window_hours: token.playback_window_hours || '',
            expires_at: token.expires_at || '',
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
                playback_window_hours: form.playback_window_hours || null,
                expires_at: form.expires_at || null,
            };
            const response = await playbackTokenService.createToken(payload);
            const shareText = extractPlaybackTokenShareText(response);
            if (shareText) {
                setCreatedShare({ shareText });
                showSuccess('Token playback dibuat', 'Teks share memakai kode akses aktif yang bisa dibagikan ulang.');
            } else {
                setCreatedShare(null);
                showError('Teks share kosong', 'Backend tidak mengirim teks share token.');
            }
            setForm((current) => ({ ...current, label: '', camera_ids: [], camera_rules: {}, custom_access_code: '' }));
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
            const shareText = extractPlaybackTokenShareText(response);
            if (shareText) {
                setCreatedShare({ shareText });
                showSuccess('Teks share dibuat', 'Kode akses yang sama siap dibagikan ulang.');
            } else {
                setCreatedShare(null);
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
            await playbackTokenService.updateToken(tokenId, {
                label: editForm.label,
                scope_type: editForm.scope_type,
                camera_ids: cameraRules.map((rule) => rule.camera_id),
                camera_rules: cameraRules,
                playback_window_hours: editForm.playback_window_hours || null,
                expires_at: editForm.expires_at || null,
                max_active_sessions: editForm.max_active_sessions === '' ? null : editForm.max_active_sessions,
                session_limit_mode: editForm.session_limit_mode,
                session_timeout_seconds: editForm.session_timeout_seconds,
                client_note: editForm.client_note,
                share_template: editForm.share_template,
            });
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
            await playbackTokenService.revokeToken(tokenId);
            showSuccess('Token dicabut', 'Token tidak bisa digunakan lagi.');
            await loadData();
        } catch (error) {
            showError('Gagal mencabut token', error?.response?.data?.message || error.message);
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
        whatsappHref,
        loadData,
        setCameraSearch,
        setEditCameraSearch,
        updateForm,
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
    };
}
