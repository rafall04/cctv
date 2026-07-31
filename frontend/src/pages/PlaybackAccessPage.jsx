/*
 * Purpose: Public page for getting playback access — claim the free trial, or buy a day/week/month
 *          package through iPaymu and receive the access key.
 * Caller: App.jsx route /playback/langganan.
 * Deps: playbackAccessService, ErrorBoundary-safe (no throwing render paths).
 *
 * Two honesty rules this page must keep:
 *  1. Depth is advertised as "up to N hours back", never as a promise of footage that exists. The
 *     Telegram archive started on 2026-07-31, so a 30-day package genuinely cannot reach back 30 days
 *     yet — it deepens by a day per day. Saying otherwise would be selling something we cannot serve.
 *  2. The two axes stay visibly separate on every card: how FAR back you may look, and how LONG you
 *     keep looking. Buyers conflate them, and a refund request is the expensive way to find out.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import playbackAccessService from '../services/playbackAccessService';

const POLL_MS = 5000;

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

/** "up to N hours back" in the unit a buyer actually thinks in. */
function formatDepth(hours) {
    if (!hours) return '-';
    if (hours < 24) return `${hours} jam`;
    const days = Math.round(hours / 24);
    return `${days} hari`;
}

export function PlaybackAccessPage() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [products, setProducts] = useState([]);
    const [trial, setTrial] = useState(null);
    const [busyKey, setBusyKey] = useState(null);
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
            setError('Gagal memuat daftar paket. Coba muat ulang halaman.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Poll only while an order is genuinely pending; stop on any terminal state so a forgotten tab
    // does not keep hitting the gateway sync path forever.
    useEffect(() => {
        if (!order?.id || order.status !== 'pending') return undefined;
        pollRef.current = setInterval(async () => {
            try {
                const res = await playbackAccessService.getOrderStatus(order.id);
                const fresh = res?.data;
                if (!fresh) return;
                setOrder(fresh);
                if (fresh.status === 'paid' && fresh.access) setAccess(fresh.access);
            } catch {
                // A failed poll is not fatal — the next tick retries, and the webhook path also heals.
            }
        }, POLL_MS);
        return () => clearInterval(pollRef.current);
    }, [order?.id, order?.status]);

    const handleTrial = useCallback(async () => {
        setBusyKey('trial');
        setError(null);
        try {
            const res = await playbackAccessService.claimTrial();
            setAccess(res?.data || null);
            await load();
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal mengaktifkan masa coba.');
        } finally {
            setBusyKey(null);
        }
    }, [load]);

    const handleBuy = useCallback(async (productKey) => {
        setBusyKey(productKey);
        setError(null);
        try {
            const res = await playbackAccessService.createOrder({
                productKey,
                name: buyer.name || null,
                phone: buyer.phone || null,
            });
            setOrder(res?.data || null);
            if (res?.data?.status === 'paid' && res.data.access) setAccess(res.data.access);
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal membuat pembayaran.');
        } finally {
            setBusyKey(null);
        }
    }, [buyer]);

    const trialProduct = products.find((p) => p.isTrial) || null;
    const paidProducts = products.filter((p) => !p.isTrial);

    return (
        <div className="min-h-screen bg-surface text-content px-4 py-8">
            <div className="mx-auto w-full max-w-3xl">
                <h1 className="text-2xl font-semibold">Akses Putar Ulang</h1>
                <p className="mt-2 text-content-muted">
                    Tonton rekaman kamera yang sudah lewat. Pilih paket sesuai seberapa jauh ke belakang
                    yang ingin kamu lihat.
                </p>

                {error && (
                    <div className="mt-4 rounded-card border border-edge-strong bg-surface-raised px-4 py-3 text-status-warn">
                        {error}
                    </div>
                )}

                {access && (
                    <div className="mt-6 rounded-card border border-edge bg-surface-raised p-5 shadow-e1">
                        <h2 className="font-semibold text-status-live">Akses aktif</h2>
                        <p className="mt-1 text-sm text-content-muted">
                            Simpan kunci ini. Pakai untuk membuka halaman putar ulang di perangkat ini.
                        </p>
                        <code className="mt-3 block break-all rounded-control bg-surface-sunken px-3 py-2 text-sm">
                            {access.shareKey}
                        </code>
                        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <dt className="text-content-subtle">Bisa lihat ke belakang</dt>
                                <dd>{formatDepth(access.windowHours)}</dd>
                            </div>
                            <div>
                                <dt className="text-content-subtle">Berlaku sampai</dt>
                                <dd>{access.expiresAt || '-'}</dd>
                            </div>
                        </dl>
                    </div>
                )}

                {order && order.status === 'pending' && (
                    <div className="mt-6 rounded-card border border-edge bg-surface-raised p-5 shadow-e1">
                        <h2 className="font-semibold">Menunggu pembayaran</h2>
                        <p className="mt-1 text-sm text-content-muted">
                            {formatRupiah(order.amount)} — {order.payment?.payment_name || 'QRIS'}. Halaman ini
                            memeriksa sendiri, tidak perlu ditutup.
                        </p>
                        {order.payment?.qr_url && (
                            <img
                                src={order.payment.qr_url}
                                alt="Kode QR pembayaran"
                                className="mt-3 h-56 w-56 max-w-full rounded-control bg-white p-2"
                            />
                        )}
                        {order.payment?.va_number && (
                            <p className="mt-3 text-sm">
                                Nomor bayar: <code className="rounded-control bg-surface-sunken px-2 py-1">{order.payment.va_number}</code>
                            </p>
                        )}
                    </div>
                )}

                {order && order.status === 'expired' && (
                    <div className="mt-6 rounded-card border border-edge bg-surface-raised px-4 py-3 text-content-muted">
                        Pembayaran kedaluwarsa. Silakan buat pesanan baru.
                    </div>
                )}

                {loading ? (
                    <p className="mt-8 text-content-muted">Memuat paket…</p>
                ) : (
                    <>
                        {trialProduct && (
                            <section className="mt-8 rounded-card border border-edge bg-surface-raised p-5 shadow-e1">
                                <h2 className="font-semibold">{trialProduct.label}</h2>
                                <p className="mt-1 text-sm text-content-muted">{trialProduct.description}</p>
                                <button
                                    type="button"
                                    onClick={handleTrial}
                                    disabled={!!busyKey || trial?.claimed || !trial?.available}
                                    className="mt-4 rounded-control bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                    {trial?.claimed ? 'Sudah pernah dipakai di perangkat ini' : 'Coba gratis'}
                                </button>
                            </section>
                        )}

                        <section className="mt-8">
                            <h2 className="font-semibold">Paket berbayar</h2>
                            <div className="mt-3 grid gap-4 sm:grid-cols-2">
                                <label className="text-sm">
                                    <span className="text-content-subtle">Nama</span>
                                    <input
                                        type="text"
                                        value={buyer.name}
                                        onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
                                        className="mt-1 w-full rounded-control border border-edge bg-surface-sunken px-3 py-2"
                                    />
                                </label>
                                <label className="text-sm">
                                    <span className="text-content-subtle">Nomor HP</span>
                                    <input
                                        type="tel"
                                        value={buyer.phone}
                                        onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))}
                                        className="mt-1 w-full rounded-control border border-edge bg-surface-sunken px-3 py-2"
                                    />
                                </label>
                            </div>

                            <div className="mt-4 grid gap-4 sm:grid-cols-3">
                                {paidProducts.map((p) => (
                                    <article key={p.key} className="rounded-card border border-edge bg-surface-raised p-4 shadow-e1">
                                        <h3 className="font-semibold">{p.label}</h3>
                                        <p className="mt-1 text-lg">{formatRupiah(p.price)}</p>
                                        <dl className="mt-3 space-y-1 text-sm">
                                            <div className="flex justify-between gap-2">
                                                <dt className="text-content-subtle">Lihat ke belakang</dt>
                                                <dd>sampai {formatDepth(p.windowHours)}</dd>
                                            </div>
                                            <div className="flex justify-between gap-2">
                                                <dt className="text-content-subtle">Masa berlaku</dt>
                                                <dd>{p.validityDays} hari</dd>
                                            </div>
                                        </dl>
                                        <button
                                            type="button"
                                            onClick={() => handleBuy(p.key)}
                                            disabled={!!busyKey}
                                            className="mt-4 w-full rounded-control bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                                        >
                                            {busyKey === p.key ? 'Memproses…' : 'Beli'}
                                        </button>
                                    </article>
                                ))}
                            </div>
                        </section>

                        <p className="mt-8 text-sm text-content-subtle">
                            Kedalaman adalah batas paling jauh, bukan janji bahwa rekaman selalu tersedia
                            sampai ke sana. Arsip mulai dikumpulkan 31 Juli 2026 dan bertambah dalam setiap
                            harinya.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}

export default PlaybackAccessPage;
