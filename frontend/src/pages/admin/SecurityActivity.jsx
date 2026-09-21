/*
Purpose: Admin Security Activity page — read-only viewer for the security audit log.
Caller: App.jsx protected /admin/security route (admin-only).
Deps: adminService.getSecurityLogs / getSecurityStats, TimezoneContext, NotificationContext.
MainFuncs: SecurityActivity.
SideEffects: Fetches paginated security logs and 7-day stats.
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, PageHeader } from '../../components/ui';
import { adminService } from '../../services/adminService';
import { useNotification } from '../../contexts/NotificationContext';
import { useTimezone, parseBackendDateInput, TIMESTAMP_STORAGE } from '../../contexts/TimezoneContext';

// Event types grouped by severity — drives the dropdown and the row tone.
const THREAT_EVENTS = [
    'AUTH_FAILURE', 'ACCOUNT_LOCKOUT', 'RATE_LIMIT_EXCEEDED', 'API_KEY_INVALID',
    'CSRF_INVALID', 'ORIGIN_VALIDATION_FAILURE', 'FINGERPRINT_MISMATCH',
    'AUTHZ_FAILURE', 'VALIDATION_FAILURE', 'PASSWORD_VALIDATION_FAILED',
    'TOTP_VERIFY_FAILED', 'TOTP_LOCKED',
];
const ADMIN_EVENTS = [
    'ADMIN_ACTION', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
    'CAMERA_CREATED', 'CAMERA_UPDATED', 'CAMERA_DELETED',
    'API_KEY_CREATED', 'API_KEY_REVOKED',
    'TOTP_SETUP_STARTED', 'TOTP_ENABLED', 'TOTP_DISABLED', 'TOTP_RECOVERY_USED',
];
const AUTH_EVENTS = [
    'AUTH_SUCCESS', 'SESSION_CREATED', 'SESSION_REFRESHED', 'SESSION_INVALIDATED',
    'TOKEN_BLACKLISTED', 'PASSWORD_CHANGED', 'TOTP_CHALLENGE_ISSUED',
];
const ALL_EVENT_TYPES = [...THREAT_EVENTS, ...ADMIN_EVENTS, ...AUTH_EVENTS];

function eventTone(eventType) {
    if (THREAT_EVENTS.includes(eventType)) {
        return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300';
    }
    if (ADMIN_EVENTS.includes(eventType)) {
        return 'bg-primary-100 text-primary dark:bg-primary/15';
    }
    return 'bg-surface-sunken text-content-muted';
}

/** Pick the most operator-meaningful field out of the JSON details blob. */
function summarizeDetails(rawDetails) {
    if (!rawDetails) return '';
    let parsed;
    try {
        parsed = typeof rawDetails === 'string' ? JSON.parse(rawDetails) : rawDetails;
    } catch {
        return String(rawDetails).slice(0, 120);
    }
    if (!parsed || typeof parsed !== 'object') return String(rawDetails).slice(0, 120);

    const parts = [];
    if (parsed.reason) parts.push(String(parsed.reason));
    if (parsed.action) parts.push(String(parsed.action));
    if (parsed.required_role && parsed.actual_role) {
        parts.push(`role ${parsed.actual_role} → butuh ${parsed.required_role}`);
    }
    if (parsed.lock_type) parts.push(`lock: ${parsed.lock_type}`);
    if (parsed.endpoint_type) parts.push(`tipe: ${parsed.endpoint_type}`);
    if (parsed.target_type) parts.push(`target: ${parsed.target_type}${parsed.target_id ? ` #${parsed.target_id}` : ''}`);
    if (Array.isArray(parsed.validation_errors) && parsed.validation_errors.length) {
        parts.push(parsed.validation_errors.join('; '));
    }
    return parts.join(' · ') || '—';
}

function StatTile({ label, value, tone }) {
    return (
        <div className="rounded-2xl border border-edge bg-surface p-4 shadow-sm">
            <div className="text-xs font-medium text-content-muted">{label}</div>
            <div className={`mt-1 text-2xl font-bold ${tone || 'text-content'}`}>{value}</div>
        </div>
    );
}

// Module level: inline in the header this was a new component type every render.
function RefreshIcon() {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
    );
}

/*
 * Two-factor (TOTP) self-service card for the signed-in admin. Lives here — not in
 * Settings — because it is a security control and this page already gates to admin.
 *
 * State machine: status → idle | setup (QR + confirm) | recovery (codes shown ONCE)
 * | disable (needs a live code). The plaintext secret/recovery codes only ever exist
 * inside this component's state — the server stores the secret encrypted and the
 * recovery codes hashed.
 */
function TotpSecurityCard() {
    const { error: notifyError, success: notifySuccess } = useNotification();
    const [status, setStatus] = useState(null); // { enabled, recoveryRemaining }
    const [phase, setPhase] = useState('idle');
    const [setup, setSetup] = useState(null);   // { secret, qrCodeDataUrl }
    const [code, setCode] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const loadStatus = useCallback(async () => {
        const response = await adminService.getTotpStatus();
        if (response.success) {
            setStatus(response.data);
        }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const startSetup = async () => {
        setBusy(true);
        setError('');
        const response = await adminService.startTotpSetup();
        setBusy(false);
        if (!response.success) {
            setError(response.message);
            return;
        }
        setSetup(response.data);
        setCode('');
        setPhase('setup');
    };

    const confirmSetup = async () => {
        setBusy(true);
        setError('');
        const response = await adminService.confirmTotpSetup(code.trim());
        setBusy(false);
        if (!response.success) {
            setError(response.message);
            return;
        }
        setSetup(null);
        setCode('');
        setRecoveryCodes(response.data?.recoveryCodes || []);
        setPhase('recovery');
        loadStatus();
    };

    const disableTotp = async () => {
        setBusy(true);
        setError('');
        const response = await adminService.disableTotp(code.trim());
        setBusy(false);
        if (!response.success) {
            setError(response.message);
            return;
        }
        setCode('');
        setPhase('idle');
        notifySuccess('2FA Dinonaktifkan', 'Akun Anda kembali hanya dilindungi password.');
        loadStatus();
    };

    const copyRecovery = async () => {
        try {
            await navigator.clipboard.writeText(recoveryCodes.join('\n'));
            notifySuccess('Tersalin', 'Kode pemulihan tersalin ke clipboard.');
        } catch {
            notifyError('Gagal Menyalin', 'Salin kode secara manual.');
        }
    };

    const cancel = () => {
        setPhase('idle');
        setSetup(null);
        setCode('');
        setError('');
    };

    const inputClass = 'w-full rounded-xl border border-edge-strong bg-surface px-3 py-2 text-center font-mono text-lg tracking-[0.3em] text-content';

    return (
        <section className="rounded-2xl border border-edge bg-surface p-4 shadow-sm sm:p-5" aria-label="Verifikasi dua langkah">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-base font-semibold text-content">Verifikasi Dua Langkah (2FA)</h2>
                    <p className="mt-0.5 text-sm text-content-muted">
                        {status === null
                            ? 'Memeriksa status...'
                            : status.enabled
                                ? `Aktif · kode pemulihan tersisa ${status.recoveryRemaining}`
                                : 'Nonaktif — login hanya memerlukan password.'}
                    </p>
                </div>
                {status && (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${status.enabled ? 'bg-status-live/15 text-status-live' : 'bg-surface-sunken text-content-muted'}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${status.enabled ? 'bg-status-live' : 'bg-content-subtle'}`} />
                        {status.enabled ? 'Aktif' : 'Nonaktif'}
                    </span>
                )}
            </div>

            {error && <p role="alert" className="mt-3 rounded-xl border border-status-fault/30 bg-status-fault/10 px-3 py-2 text-sm text-status-fault">{error}</p>}

            {phase === 'setup' && setup && (
                <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
                    <img
                        src={setup.qrDataUrl}
                        alt="QR code untuk aplikasi authenticator"
                        className="mx-auto h-44 w-44 rounded-xl border border-edge bg-white p-2"
                    />
                    <div className="min-w-0">
                        <p className="text-sm text-content-muted">
                            Pindai QR dengan aplikasi authenticator (Google Authenticator, Aegis, Bitwarden...).
                            Tidak bisa memindai? Masukkan secret ini secara manual:
                        </p>
                        <code className="mt-2 block break-all rounded-xl bg-surface-sunken px-3 py-2 font-mono text-sm text-content">{setup.secret}</code>
                        <label htmlFor="totp-confirm-code" className="mt-3 block text-sm font-semibold text-content-muted">Masukkan kode 6 digit untuk mengaktifkan</label>
                        <input
                            id="totp-confirm-code"
                            type="text" inputMode="numeric" autoComplete="one-time-code"
                            value={code} onChange={(e) => setCode(e.target.value)}
                            maxLength={6} placeholder="••••••"
                            className={`mt-1.5 ${inputClass}`}
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button variant="primary" onClick={confirmSetup} loading={busy} disabled={code.trim().length !== 6}>
                                Verifikasi &amp; Aktifkan
                            </Button>
                            <Button variant="secondary" onClick={cancel} disabled={busy}>Batal</Button>
                        </div>
                    </div>
                </div>
            )}

            {phase === 'recovery' && recoveryCodes && (
                <div className="mt-4">
                    <p className="rounded-xl border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-sm font-semibold text-status-warn">
                        Simpan kode-kode ini SEKARANG — tidak akan ditampilkan lagi. Satu kode = satu login darurat bila authenticator hilang.
                    </p>
                    <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {recoveryCodes.map((rc) => (
                            <li key={rc} className="rounded-xl bg-surface-sunken px-3 py-2 text-center font-mono text-sm text-content">{rc}</li>
                        ))}
                    </ul>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={copyRecovery}>Salin semua</Button>
                        <Button
                            variant="primary"
                            onClick={() => { setRecoveryCodes(null); setPhase('idle'); notifySuccess('2FA Aktif', 'Verifikasi dua langkah sekarang melindungi akun Anda.'); }}
                        >
                            Sudah saya simpan
                        </Button>
                    </div>
                </div>
            )}

            {phase === 'disable' && (
                <div className="mt-4">
                    <label htmlFor="totp-disable-code" className="block text-sm font-semibold text-content-muted">Konfirmasi: kode authenticator saat ini, atau kode pemulihan</label>
                    <input
                        id="totp-disable-code"
                        type="text" autoComplete="one-time-code"
                        value={code} onChange={(e) => setCode(e.target.value)}
                        maxLength={9} placeholder="••••••"
                        className={`mt-1.5 ${inputClass} max-w-xs`}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="danger" onClick={disableTotp} loading={busy} disabled={code.trim().length < 6}>
                            Nonaktifkan 2FA
                        </Button>
                        <Button variant="secondary" onClick={cancel} disabled={busy}>Batal</Button>
                    </div>
                </div>
            )}

            {phase === 'idle' && status && (
                <div className="mt-4">
                    {status.enabled ? (
                        <Button variant="dangerGhost" onClick={() => { setCode(''); setPhase('disable'); }}>
                            Nonaktifkan 2FA
                        </Button>
                    ) : (
                        <Button variant="primary" onClick={startSetup} loading={busy}>
                            Aktifkan 2FA
                        </Button>
                    )}
                </div>
            )}
        </section>
    );
}

export default function SecurityActivity() {
    const { error: notifyError } = useNotification();
    const { timezone } = useTimezone();
    const [logs, setLogs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
    const [stats, setStats] = useState(null);
    const [eventType, setEventType] = useState('');
    const [search, setSearch] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);

    /*
     * These rows come from SQLite CURRENT_TIMESTAMP, which is ALWAYS UTC and carries no zone
     * marker ("2026-07-29 11:49:32"). `new Date()` on that string parses it as LOCAL time, so on a
     * WIB machine the log read 7 hours early — converting to Asia/Jakarta afterwards cannot undo a
     * wrong instant. parseBackendDateInput with UTC_SQL appends the missing Z before parsing.
     */
    const formatTimestamp = useCallback((value) => {
        if (!value) return '—';
        const date = parseBackendDateInput(value, { storage: TIMESTAMP_STORAGE.UTC_SQL });
        if (Number.isNaN(date?.getTime?.())) return String(value);
        return date.toLocaleString('id-ID', {
            timeZone: timezone || 'Asia/Jakarta',
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }, [timezone]);

    const loadLogs = useCallback(async () => {
        setLoading(true);
        const response = await adminService.getSecurityLogs({
            eventType,
            search: appliedSearch,
            page,
            limit: 50,
        });
        if (response.success) {
            setLogs(response.data || []);
            if (response.pagination) {
                setPagination(response.pagination);
            }
        } else {
            notifyError('Gagal Memuat Log', response.message || 'Tidak bisa memuat log keamanan.');
        }
        setLoading(false);
    }, [eventType, appliedSearch, page, notifyError]);

    const loadStats = useCallback(async () => {
        const response = await adminService.getSecurityStats(7);
        if (response.success) {
            setStats(response.data);
        }
    }, []);

    useEffect(() => {
        loadLogs();
    }, [loadLogs]);

    useEffect(() => {
        loadStats();
    }, [loadStats]);

    const summary = useMemo(() => {
        const byType = stats?.events_by_type || {};
        const sumOf = (types) => types.reduce((total, type) => total + (byType[type] || 0), 0);
        return {
            total: stats?.total_events || 0,
            threats: sumOf(THREAT_EVENTS),
            authFailures: byType.AUTH_FAILURE || 0,
            authzFailures: byType.AUTHZ_FAILURE || 0,
        };
    }, [stats]);

    const refresh = () => {
        loadStats();
        loadLogs();
    };

    const applySearch = (event) => {
        event.preventDefault();
        setPage(1);
        setAppliedSearch(search.trim());
    };

    return (
        <div className="space-y-6">
            <PageHeader
                eyebrow="Keamanan"
                title="Aktivitas Keamanan"
                description="Login gagal, lockout, rate-limit, CSRF, penolakan akses, dan aksi admin."
                actions={<Button onClick={refresh} icon={<RefreshIcon />}>Refresh</Button>}
            />

            <TotpSecurityCard />

            {/* Stats — last 7 days */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatTile label="Total Event (7 hari)" value={summary.total} />
                <StatTile
                    label="Ancaman / Gagal (7 hari)"
                    value={summary.threats}
                    tone={summary.threats > 0 ? 'text-red-600 dark:text-red-300' : undefined}
                />
                <StatTile
                    label="Login Gagal (7 hari)"
                    value={summary.authFailures}
                    tone={summary.authFailures > 0 ? 'text-amber-600 dark:text-amber-300' : undefined}
                />
                <StatTile
                    label="Akses Ditolak (7 hari)"
                    value={summary.authzFailures}
                    tone={summary.authzFailures > 0 ? 'text-amber-600 dark:text-amber-300' : undefined}
                />
            </div>

            {/* Filters */}
            <form
                onSubmit={applySearch}
                /* flex-wrap: di bawah sm baris ini menumpuk dan aman, tapi begitu masuk sm ia
                   jadi satu baris yang TIDAK BISA membungkus - dan pada font 1,5x tombol "Cari"
                   mendorong wadahnya ke 815px di layar 768px. Lebar <select> ditentukan opsi
                   terpanjangnya, jadi ia ikut melebar dan tidak mau menciut. */
                className="flex flex-col gap-3 rounded-2xl border border-edge bg-surface p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center"
            >
                <select
                    aria-label="Filter tipe event"
                    value={eventType}
                    onChange={(event) => { setEventType(event.target.value); setPage(1); }}
                    className="min-w-0 rounded-xl border border-edge-strong bg-surface px-3 py-2 text-base sm:text-sm text-content"
                >
                    <option value="">Semua Event</option>
                    {ALL_EVENT_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                    ))}
                </select>
                <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Cari IP, user, endpoint, detail..."
                    aria-label="Cari log keamanan"
                    className="min-w-0 flex-1 rounded-xl border border-edge-strong bg-surface px-3 py-2 text-base sm:text-sm text-content"
                />
                <button
                    type="submit"
                    className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-600"
                >
                    Cari
                </button>
            </form>

            {/* Table */}
            <div className="overflow-hidden rounded-2xl border border-edge bg-surface shadow-sm">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700/60">
                        <thead className="bg-surface-sunken text-left text-xs uppercase tracking-wider text-content-muted">
                            <tr>
                                <th className="px-4 py-3">Waktu</th>
                                <th className="px-4 py-3">Event</th>
                                <th className="px-4 py-3">User</th>
                                <th className="px-4 py-3">IP</th>
                                <th className="px-4 py-3">Endpoint</th>
                                <th className="px-4 py-3">Detail</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-700/40">
                            {loading ? (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-content-muted">Memuat...</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-content-muted">Tidak ada event yang cocok.</td></tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className="align-top">
                                        <td className="whitespace-nowrap px-4 py-3 text-content-muted">{formatTimestamp(log.timestamp)}</td>
                                        <td className="px-4 py-3">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${eventTone(log.event_type)}`}>
                                                {log.event_type}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-content">{log.username || '—'}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-content-muted">{log.ip_address || '—'}</td>
                                        <td className="max-w-[16rem] truncate px-4 py-3 text-content-muted" title={log.endpoint || ''}>{log.endpoint || '—'}</td>
                                        <td className="max-w-[20rem] px-4 py-3 text-xs text-content-muted">{summarizeDetails(log.details)}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between gap-3 border-t border-edge px-4 py-3 text-sm">
                    <span className="text-content-muted">
                        {pagination.total} event · halaman {pagination.page} dari {Math.max(pagination.totalPages, 1)}
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            disabled={loading || pagination.page <= 1}
                            className="rounded-lg border border-edge px-3 py-1.5 font-medium text-content disabled:opacity-50"
                        >
                            Sebelumnya
                        </button>
                        <button
                            type="button"
                            onClick={() => setPage((current) => current + 1)}
                            disabled={loading || pagination.page >= pagination.totalPages}
                            className="rounded-lg border border-edge px-3 py-1.5 font-medium text-content disabled:opacity-50"
                        >
                            Berikutnya
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
