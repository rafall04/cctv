/*
 * Purpose: Claim the free trial or buy a playback package, INSIDE the playback page.
 * Caller: PlaybackTokenAccess (expanded from the "belum punya token?" toggle).
 * Deps: playbackAccessService.
 *
 * Why this is a panel and not a page. It used to be a standalone route, and that was wrong twice
 * over: the visitor lost the app shell (bottom dock, header) so it read as a different site, and it
 * navigated them AWAY from the very player they were trying to unlock. Access belongs next to the
 * token box that asked for it.
 *
 * Honesty rules kept from the old page:
 *  - depth is "up to N", never a promise footage exists that far back;
 *  - the two axes stay separate on every card — how FAR back vs how LONG;
 *  - what happens after paying is said before paying.
 *
 * When no paid package is enabled the whole paid section disappears rather than showing an empty
 * form. A form with nothing to buy reads as broken.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import playbackAccessService from '../../services/playbackAccessService';
import { hoursToText } from '../../utils/durationText';

const POLL_MS = 5000;

const rupiah = (v) => `Rp ${Number(v || 0).toLocaleString('id-ID')}`;
/*
 * Shared with the admin catalogue on purpose. The depth printed here and the coverage printed there
 * are the same measurement, and rounding them differently would make one of the two a lie.
 */
const depth = hoursToText;

export default function PlaybackAccessPanel({ onIssued = null }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [products, setProducts] = useState([]);
    const [trial, setTrial] = useState(null);
    const [busy, setBusy] = useState(null);
    const [buyer, setBuyer] = useState({ name: '', phone: '' });
    const [order, setOrder] = useState(null);
    const [access, setAccess] = useState(null);
    const [copied, setCopied] = useState(false);
    const pollRef = useRef(null);

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const res = await playbackAccessService.getProducts();
            setProducts(res?.data?.products || []);
            setTrial(res?.data?.trial || null);
            setError(null);
        } catch {
            setError('Gagal memuat paket. Coba muat ulang halaman.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    /*
     * The app just minted this key, so making the visitor read it and paste it into a box a few
     * pixels above is busywork we invented. Hand it straight to the token box and let it activate.
     * The key stays on screen afterwards because it is worth saving — it works on this device until
     * it expires, and on any other device the holder pastes it into.
     *
     * Declared ABOVE the poll effect that calls it: a const used before its line is in the temporal
     * dead zone, and although the effect happens to run late enough today, that is timing luck, not
     * a guarantee.
     */
    const handIssuedKeyUp = useCallback((data) => {
        setAccess(data || null);
        if (data?.shareKey && onIssued) onIssued(data.shareKey);
    }, [onIssued]);

    // Poll only while genuinely pending, so an idle tab stops hitting the gateway sync path.
    useEffect(() => {
        if (!order?.id || order.status !== 'pending') return undefined;
        pollRef.current = setInterval(async () => {
            try {
                const fresh = (await playbackAccessService.getOrderStatus(order.id))?.data;
                if (!fresh) return;
                setOrder(fresh);
                if (fresh.status === 'paid' && fresh.access) handIssuedKeyUp(fresh.access);
            } catch {
                // Next tick retries; the webhook heals the same state server-side.
            }
        }, POLL_MS);
        return () => clearInterval(pollRef.current);
    }, [order?.id, order?.status, handIssuedKeyUp]);

    const claimTrial = useCallback(async () => {
        setBusy('trial'); setError(null);
        try {
            handIssuedKeyUp((await playbackAccessService.claimTrial())?.data || null);
            await load();
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal mengaktifkan masa coba.');
        } finally { setBusy(null); }
    }, [load, handIssuedKeyUp]);

    const buy = useCallback(async (productKey) => {
        setBusy(productKey); setError(null);
        try {
            const res = await playbackAccessService.createOrder({
                productKey, name: buyer.name || null, phone: buyer.phone || null,
            });
            setOrder(res?.data || null);
            if (res?.data?.status === 'paid' && res.data.access) handIssuedKeyUp(res.data.access);
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal membuat pembayaran.');
        } finally { setBusy(null); }
    }, [buyer, handIssuedKeyUp]);

    /*
     * navigator.clipboard needs a secure context and is absent in some in-app browsers (Telegram,
     * MIUI). The textarea fallback is what makes "Salin" work there instead of silently doing
     * nothing — and select-all on the <code> itself is the last resort if even that is blocked.
     */
    const copyKey = useCallback(async (value) => {
        if (!value) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
            } else {
                const ta = document.createElement('textarea');
                ta.value = value;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError('Gagal menyalin. Tekan lama pada kunci untuk menyalin manual.');
        }
    }, []);

    const trialProduct = products.find((p) => p.isTrial) || null;
    const paid = products.filter((p) => !p.isTrial);

    if (loading) {
        return <p className="mt-3 text-xs text-content-muted">Memuat paket…</p>;
    }

    return (
        <div className="mt-3 space-y-3">
            {error && (
                <p className="rounded-control border border-edge border-l-2 border-l-status-warn bg-surface-raised px-3 py-2 text-xs text-status-warn">{error}</p>
            )}

            {access && (
                <div className="rounded-control border border-edge border-l-2 border-l-status-live bg-surface-raised p-3">
                    <p className="text-xs font-semibold text-status-live">Akses aktif</p>
                    {/*
                     * text-content is NOT optional here. `body` carries a hard-coded black, so any
                     * element without its own colour inherits black — measured on prod in dark mode
                     * this <code> rendered #000 on #08090b, a contrast ratio of 1.05 where WCAG AA
                     * needs 4.5. The key was effectively invisible. With text-content it is 16.67.
                     *
                     * Bigger, monospaced and letter-spaced because this is a code to be read aloud,
                     * retyped on another device, or checked character by character.
                     */}
                    <div className="mt-2 flex items-stretch gap-2">
                        <code className="min-w-0 flex-1 select-all break-all rounded-control bg-surface-sunken px-3 py-2 font-mono text-base font-semibold tracking-widest text-content">
                            {access.shareKey}
                        </code>
                        <button
                            type="button"
                            onClick={() => copyKey(access.shareKey)}
                            className="shrink-0 rounded-control border border-edge px-3 text-xs font-medium text-content hover:border-edge-strong hover:bg-surface"
                        >
                            {copied ? 'Tersalin' : 'Salin'}
                        </button>
                    </div>
                    <p className="mt-2 text-[11px] text-content-muted">
                        Bisa lihat ke belakang {depth(access.windowHours)} · berlaku sampai {access.expiresAt || '-'}
                        {' · '}sudah aktif di perangkat ini, salin untuk dipakai di perangkat lain
                    </p>
                </div>
            )}

            {order?.status === 'pending' && (
                <div className="rounded-control border border-edge bg-surface-raised p-3">
                    <p className="text-xs font-semibold">Menunggu pembayaran {rupiah(order.amount)}</p>
                    <p className="mt-1 text-[11px] text-content-muted">Halaman ini memeriksa sendiri, tidak perlu ditutup.</p>
                    {order.payment?.qr_url && (
                        <img src={order.payment.qr_url} alt="Kode QR pembayaran" className="mt-2 h-44 w-44 max-w-full rounded-control bg-white p-2" />
                    )}
                    {order.payment?.va_number && (
                        <p className="mt-2 text-xs">Nomor bayar: <code className="rounded-control bg-surface-sunken px-2 py-1 font-mono text-content">{order.payment.va_number}</code></p>
                    )}
                </div>
            )}

            {trialProduct && !access && (
                <div className="rounded-control border border-edge bg-surface-raised p-3">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold">{trialProduct.label}</p>
                            <p className="mt-0.5 text-[11px] text-content-muted">{trialProduct.description}</p>
                        </div>
                        <span className="shrink-0 rounded-control bg-surface-sunken px-2 py-0.5 text-[11px] text-content-muted">Gratis</span>
                    </div>
                    <button
                        type="button"
                        onClick={claimTrial}
                        disabled={!!busy || trial?.claimed || !trial?.available}
                        className="mt-2 w-full rounded-control bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                        {trial?.claimed ? 'Sudah dipakai di perangkat ini' : (busy === 'trial' ? 'Mengaktifkan…' : 'Coba gratis')}
                    </button>
                </div>
            )}

            {paid.length > 0 && !access && (
                <>
                    <div className="grid gap-2 sm:grid-cols-2">
                        <label className="block text-xs">
                            <span className="text-content-subtle">Nama</span>
                            <input value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
                                className="mt-1 w-full rounded-control border border-edge bg-surface-sunken px-2 py-1.5 text-content" />
                        </label>
                        <label className="block text-xs">
                            <span className="text-content-subtle">Nomor HP</span>
                            <input type="tel" value={buyer.phone} onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))}
                                className="mt-1 w-full rounded-control border border-edge bg-surface-sunken px-2 py-1.5 text-content" />
                        </label>
                    </div>
                    {paid.map((p) => (
                        <div key={p.key} className="rounded-control border border-edge bg-surface-raised p-3">
                            <div className="flex items-baseline justify-between gap-2">
                                <p className="text-sm font-semibold">{p.label}</p>
                                <span className="text-sm font-semibold">{rupiah(p.price)}</span>
                            </div>
                            <p className="mt-1 text-[11px] text-content-muted">
                                Lihat ke belakang sampai {depth(p.windowHours)} · berlaku {p.validityDays} hari
                            </p>
                            {/*
                              * Said BEFORE the Beli button, not in the small print under it. The
                              * package's depth is a ceiling the archive has not reached yet, and a
                              * buyer who learns that after paying has been misled by omission.
                              */}
                            {p.exceedsCoverage && p.coverageHours > 0 && (
                                <p className="mt-1 text-[11px] leading-4 text-status-warn">
                                    Rekaman yang sudah tersimpan baru sampai {depth(p.coverageHours)} ke
                                    belakang, dan terus bertambah setiap hari.
                                </p>
                            )}
                            <button type="button" onClick={() => buy(p.key)} disabled={!!busy}
                                className="mt-2 w-full rounded-control bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50">
                                {busy === p.key ? 'Memproses…' : 'Beli'}
                            </button>
                        </div>
                    ))}
                    <p className="text-[11px] leading-4 text-content-subtle">
                        Kedalaman adalah batas paling jauh, bukan janji rekaman selalu tersedia sampai ke sana.
                    </p>
                </>
            )}

            {/*
              * Nothing on sale. The buttons that open this panel are hidden in the same situation
              * (usePlaybackAccessOffer), so this is the narrow case where the catalogue was switched
              * off while the panel was already open — and an empty box would read as broken.
              *
              * Naming the operator here contradicts 42992f6, which removed the "Hubungi Admin" button
              * from the limit notice, and does so deliberately: that removal was justified by
              * self-serve existing. With every package disabled it no longer does, and asking the
              * operator is the only route left. Restore the silence, not the button, if selling resumes.
              */}
            {!access && !order && products.length === 0 && (
                <p className="rounded-control border border-edge bg-surface-raised px-3 py-2 text-xs text-content-muted">
                    Saat ini tidak ada paket akses playback yang dijual. Hubungi pengelola jika Anda
                    membutuhkan akses rekaman.
                </p>
            )}
        </div>
    );
}
