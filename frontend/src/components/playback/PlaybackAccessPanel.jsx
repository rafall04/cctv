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

const POLL_MS = 5000;

const rupiah = (v) => `Rp ${Number(v || 0).toLocaleString('id-ID')}`;
const depth = (h) => (!h ? '-' : h < 24 ? `${h} jam` : `${Math.round(h / 24)} hari`);

export default function PlaybackAccessPanel() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [products, setProducts] = useState([]);
    const [trial, setTrial] = useState(null);
    const [busy, setBusy] = useState(null);
    const [buyer, setBuyer] = useState({ name: '', phone: '' });
    const [order, setOrder] = useState(null);
    const [access, setAccess] = useState(null);
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

    // Poll only while genuinely pending, so an idle tab stops hitting the gateway sync path.
    useEffect(() => {
        if (!order?.id || order.status !== 'pending') return undefined;
        pollRef.current = setInterval(async () => {
            try {
                const fresh = (await playbackAccessService.getOrderStatus(order.id))?.data;
                if (!fresh) return;
                setOrder(fresh);
                if (fresh.status === 'paid' && fresh.access) setAccess(fresh.access);
            } catch {
                // Next tick retries; the webhook heals the same state server-side.
            }
        }, POLL_MS);
        return () => clearInterval(pollRef.current);
    }, [order?.id, order?.status]);

    const claimTrial = useCallback(async () => {
        setBusy('trial'); setError(null);
        try {
            setAccess((await playbackAccessService.claimTrial())?.data || null);
            await load();
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal mengaktifkan masa coba.');
        } finally { setBusy(null); }
    }, [load]);

    const buy = useCallback(async (productKey) => {
        setBusy(productKey); setError(null);
        try {
            const res = await playbackAccessService.createOrder({
                productKey, name: buyer.name || null, phone: buyer.phone || null,
            });
            setOrder(res?.data || null);
            if (res?.data?.status === 'paid' && res.data.access) setAccess(res.data.access);
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal membuat pembayaran.');
        } finally { setBusy(null); }
    }, [buyer]);

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
                    <p className="text-xs font-semibold text-status-live">Akses aktif — tempelkan kunci ini di kotak token di atas</p>
                    <code className="mt-2 block break-all rounded-control bg-surface-sunken px-2 py-1 text-xs">{access.shareKey}</code>
                    <p className="mt-2 text-[11px] text-content-muted">
                        Bisa lihat ke belakang {depth(access.windowHours)} · berlaku sampai {access.expiresAt || '-'}
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
                        <p className="mt-2 text-xs">Nomor bayar: <code className="rounded-control bg-surface-sunken px-2 py-1">{order.payment.va_number}</code></p>
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
        </div>
    );
}
