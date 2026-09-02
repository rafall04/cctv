/*
 * Purpose: "Token Saya" — show the tokens this browser has saved (from a purchase, renewal, or a
 *          recovery), so the buyer reuses them in one tap without an account or any messaging. Also
 *          hosts the phone + recovery-code lookup for a new device / cleared browser.
 * Caller: PlaybackTokenAccess (rendered above the token input).
 * Deps: utils/savedPlaybackTokens (local store), services/playbackAccessService (recover).
 *
 * Best-practice UX kept deliberate here: nothing renders when there is nothing saved (no empty box);
 * every step is one clearly-labelled button (Aktifkan / Perpanjang / Salin / Hapus); recovery is
 * tucked in a collapsible so it never clutters the common case. All copy is Indonesian.
 */

import { useCallback, useEffect, useState } from 'react';
import { listTokens, removeToken, saveToken, isExpired } from '../../utils/savedPlaybackTokens';
import playbackAccessService from '../../services/playbackAccessService';

/** Show a stored UTC-SQL / ISO timestamp in the reader's locale; '-' when absent/unparseable. */
function fmtDate(value) {
    if (!value) return 'tanpa batas';
    const iso = String(value).includes('T') ? String(value) : `${String(value).replace(' ', 'T')}Z`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(value);
    try {
        return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    } catch {
        return d.toISOString().slice(0, 16).replace('T', ' ');
    }
}

async function copyText(value) {
    if (!value) return false;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        return true;
    } catch {
        return false;
    }
}

export default function MyPlaybackTokens({ onActivate = null, onRenew = null, version = 0 }) {
    const [tokens, setTokens] = useState([]);
    const [copiedKey, setCopiedKey] = useState(null);

    // Recovery (phone + code) — collapsed by default.
    const [recoverOpen, setRecoverOpen] = useState(false);
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [recovering, setRecovering] = useState(false);
    const [recoverMsg, setRecoverMsg] = useState(null);
    const [recoverError, setRecoverError] = useState(null);

    const refresh = useCallback(() => setTokens(listTokens()), []);
    useEffect(() => { refresh(); }, [refresh, version]);

    const handleCopy = useCallback(async (shareKey) => {
        if (await copyText(shareKey)) {
            setCopiedKey(shareKey);
            setTimeout(() => setCopiedKey((k) => (k === shareKey ? null : k)), 2000);
        }
    }, []);

    const handleDelete = useCallback((shareKey) => {
        removeToken(shareKey);
        refresh();
    }, [refresh]);

    const handleRecover = useCallback(async (e) => {
        e.preventDefault();
        setRecovering(true); setRecoverError(null); setRecoverMsg(null);
        try {
            const res = await playbackAccessService.recoverTokens({ phone: phone.trim(), code: code.trim() });
            const found = res?.data?.tokens || [];
            if (found.length === 0) {
                setRecoverError('Tidak ada token yang cocok. Periksa nomor HP dan kode pemulihannya.');
            } else {
                found.forEach((t) => saveToken({
                    shareKey: t.shareKey,
                    label: t.product?.label || 'Paket Playback',
                    expiresAt: t.expiresAt || null,
                    windowHours: t.windowHours || null,
                    phone: phone.trim(),
                }));
                refresh();
                setRecoverMsg(`${found.length} token dipulihkan dan disimpan di perangkat ini.`);
                setCode('');
            }
        } catch (err) {
            setRecoverError(err?.response?.data?.message || 'Gagal memulihkan token. Coba lagi.');
        } finally {
            setRecovering(false);
        }
    }, [phone, code, refresh]);

    const hasTokens = tokens.length > 0;

    // Nothing saved AND recovery not opened → render nothing (keeps the common case clean).
    if (!hasTokens && !recoverOpen) {
        return (
            <div className="mb-2">
                <button
                    type="button"
                    onClick={() => setRecoverOpen(true)}
                    className="text-[11px] font-medium text-content-muted underline underline-offset-2 hover:text-content"
                >
                    Pernah beli tapi kode hilang? Pulihkan token
                </button>
            </div>
        );
    }

    return (
        <div className="mb-3 space-y-2">
            {hasTokens && (
                <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-content-subtle">Token Saya</p>
                    {tokens.map((t) => {
                        const expired = isExpired(t);
                        return (
                            <div key={t.shareKey} className="rounded-control border border-edge bg-surface-raised p-2.5">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-xs font-semibold text-content">{t.label || 'Paket Playback'}</p>
                                        <p className={`mt-0.5 text-[11px] ${expired ? 'text-status-warn' : 'text-content-muted'}`}>
                                            {expired ? 'Kadaluarsa' : `Aktif sampai ${fmtDate(t.expiresAt)}`}
                                        </p>
                                    </div>
                                    <code className="shrink-0 select-all rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-content">
                                        {t.shareKey}
                                    </code>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {!expired && onActivate && (
                                        <button type="button" onClick={() => onActivate(t.shareKey)}
                                            className="rounded-control bg-primary px-2.5 py-1 text-[11px] font-medium text-white">
                                            Aktifkan
                                        </button>
                                    )}
                                    {onRenew && (
                                        <button type="button" onClick={() => onRenew(t)}
                                            className="rounded-control border border-edge px-2.5 py-1 text-[11px] font-medium text-content hover:border-edge-strong hover:bg-surface">
                                            {expired ? 'Perpanjang' : 'Perpanjang'}
                                        </button>
                                    )}
                                    <button type="button" onClick={() => handleCopy(t.shareKey)}
                                        className="rounded-control border border-edge px-2.5 py-1 text-[11px] font-medium text-content hover:border-edge-strong hover:bg-surface">
                                        {copiedKey === t.shareKey ? 'Tersalin' : 'Salin kode'}
                                    </button>
                                    <button type="button" onClick={() => handleDelete(t.shareKey)}
                                        className="ml-auto rounded-control px-2.5 py-1 text-[11px] font-medium text-content-muted hover:text-status-warn">
                                        Hapus
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {!recoverOpen ? (
                <button
                    type="button"
                    onClick={() => setRecoverOpen(true)}
                    className="text-[11px] font-medium text-content-muted underline underline-offset-2 hover:text-content"
                >
                    Ganti HP/browser? Pulihkan token dengan HP + kode
                </button>
            ) : (
                <form onSubmit={handleRecover} className="rounded-control border border-edge bg-surface-raised p-2.5">
                    <p className="text-[11px] font-semibold text-content">Pulihkan token</p>
                    <p className="mt-0.5 text-[11px] text-content-muted">Masukkan nomor HP saat beli dan kode pemulihan yang Anda simpan.</p>
                    <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Nomor HP"
                            className="min-h-10 w-full rounded-control border border-edge bg-surface-sunken px-2 py-1.5 text-sm text-content" />
                        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Kode pemulihan"
                            className="min-h-10 w-full rounded-control border border-edge bg-surface-sunken px-2 py-1.5 font-mono text-sm tracking-wide text-content" />
                    </div>
                    {recoverError && <p className="mt-1.5 text-[11px] text-status-warn">{recoverError}</p>}
                    {recoverMsg && <p className="mt-1.5 text-[11px] text-status-live">{recoverMsg}</p>}
                    <div className="mt-2 flex gap-1.5">
                        <button type="submit" disabled={recovering || !phone.trim() || !code.trim()}
                            className="rounded-control bg-primary px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50">
                            {recovering ? 'Memulihkan…' : 'Pulihkan'}
                        </button>
                        <button type="button" onClick={() => { setRecoverOpen(false); setRecoverError(null); setRecoverMsg(null); }}
                            className="rounded-control border border-edge px-3 py-1.5 text-[11px] font-medium text-content hover:bg-surface">
                            Tutup
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
