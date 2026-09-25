/*
 * Two-factor (TOTP) self-service card for the signed-in user — any role manages their OWN
 * second factor via /api/users/totp/* (the session JWT is the credential).
 *
 * State machine: status → idle | setup (QR + confirm) | recovery (codes shown ONCE)
 * | disable (needs a live code). The plaintext secret/recovery codes only ever exist
 * inside this component's state — the server stores the secret encrypted and the
 * recovery codes hashed.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from './ui';
import userService from '../services/userService';
import { useNotification } from '../contexts/NotificationContext';

export default function TotpSecurityCard() {
    const { error: notifyError, success: notifySuccess } = useNotification();
    const [status, setStatus] = useState(null); // { enabled, recoveryRemaining }
    const [phase, setPhase] = useState('idle');
    const [setup, setSetup] = useState(null);   // { secret, qrCodeDataUrl }
    const [code, setCode] = useState('');
    const [recoveryCodes, setRecoveryCodes] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const loadStatus = useCallback(async () => {
        const response = await userService.getTotpStatus();
        if (response.success) {
            setStatus(response.data);
        }
    }, []);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const startSetup = async () => {
        setBusy(true);
        setError('');
        const response = await userService.startTotpSetup();
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
        const response = await userService.confirmTotpSetup(code.trim());
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
        const response = await userService.disableTotp(code.trim());
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
