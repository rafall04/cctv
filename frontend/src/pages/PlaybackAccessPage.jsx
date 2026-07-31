/*
 * Purpose: Public page for getting playback access — claim the free trial, or buy a package through
 *          iPaymu and receive the access key.
 * Caller: App.jsx route /playback/langganan.
 * Deps: playbackAccessService.
 *
 * Honesty rules this page must keep:
 *  1. Depth is advertised as "up to N", never as a promise that footage exists that far back. The
 *     Telegram archive started 2026-07-31, so a 30-day package cannot reach 30 days yet.
 *  2. The two axes stay visibly separate on every card — how FAR back you may look, and how LONG you
 *     keep looking. Buyers conflate them, and a refund request is the expensive way to find out.
 *  3. What happens AFTER paying is stated before paying. The buyer receives a key they must paste
 *     back on the playback page; a page that omits that reads as "pay and it just works".
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import playbackAccessService from '../services/playbackAccessService';

const POLL_MS = 5000;

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

/** "up to N" in the unit a buyer thinks in, not the hours the DB stores. */
function formatDepth(hours) {
    if (!hours) return '-';
    if (hours < 24) return `${hours} jam`;
    return `${Math.round(hours / 24)} hari`;
}

function Card({ children, className = '' }) {
    return (
        <section className={`rounded-card border border-edge bg-surface-raised p-4 ${className}`}>
            {children}
        </section>
    );
}

function Field({ label, value, onChange, type = 'text' }) {
    return (
        <label className="block text-sm">
            <span className="text-content-subtle">{label}</span>
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="mt-1 w-full rounded-control border border-edge bg-surface-sunken px-3 py-2 text-content"
            />
        </label>
    );
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

    // Poll only while genuinely pending, so a forgotten tab stops hitting the gateway sync path.
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
                // A failed poll is not fatal: the next tick retries and the webhook heals it too.
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
        <div className="min-h-screen bg-surface text-content">
            <div className="mx-auto w-full max-w-2xl px-4 py-6">
                <a href="/playback" className="text-sm text-content-muted hover:text-content">&larr; Kembali ke putar ulang</a>
                <h1 className="mt-3 text-xl font-semibold sm:text-2xl">Akses Putar Ulang</h1>
                <p className="mt-1 text-sm text-content-muted">
                    Tonton rekaman yang sudah lewat. Setelah aktif kamu menerima <strong>kunci akses</strong>,
                    lalu tempelkan di halaman putar ulang.
                </p>

                {error && (
                    <Card className="mt-4 border-l-2 border-l-status-warn">
                        <p className="text-sm text-status-warn">{error}</p>
                    </Card>
                )}

                {access && (
                    <Card className="mt-4 border-l-2 border-l-status-live">
                        <h2 className="text-sm font-semibold text-status-live">Akses aktif</h2>
                        <code className="mt-2 block break-all rounded-control bg-surface-sunken px-3 py-2 text-sm">
                            {access.shareKey}
                        </code>
                        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-content-muted">
                            <span>Bisa lihat ke belakang: {formatDepth(access.windowHours)}</span>
                            <span>Berlaku sampai: {access.expiresAt || '-'}</span>
                        </div>
                        <a href="/playback" className="mt-3 inline-block rounded-control bg-primary px-4 py-2 text-sm font-medium text-white">
                            Buka halaman putar ulang
                        </a>
                    </Card>
                )}

                {order?.status === 'pending' && (
                    <Card className="mt-4">
                        <h2 className="text-sm font-semibold">Menunggu pembayaran</h2>
                        <p className="mt-1 text-xs text-content-muted">
                            {formatRupiah(order.amount)} — {order.payment?.payment_name || 'QRIS'}. Halaman ini
                            memeriksa sendiri, tidak perlu ditutup.
                        </p>
                        {order.payment?.qr_url && (
                            <img src={order.payment.qr_url} alt="Kode QR pembayaran" className="mt-3 h-48 w-48 max-w-full rounded-control bg-white p-2" />
                        )}
                        {order.payment?.va_number && (
                            <p className="mt-2 text-sm">Nomor bayar: <code className="rounded-control bg-surface-sunken px-2 py-1">{order.payment.va_number}</code></p>
                        )}
                    </Card>
                )}

                {order?.status === 'expired' && (
                    <Card className="mt-4"><p className="text-sm text-content-muted">Pembayaran kedaluwarsa. Silakan buat pesanan baru.</p></Card>
                )}

                {loading ? (
                    <p className="mt-6 text-sm text-content-muted">Memuat paket…</p>
                ) : (
                    <>
                        {trialProduct && !access && (
                            <Card className="mt-5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="font-semibold">{trialProduct.label}</h2>
                                        <p className="mt-1 text-xs text-content-muted">{trialProduct.description}</p>
                                    </div>
                                    <span className="shrink-0 rounded-control bg-surface-sunken px-2 py-1 text-xs text-content-muted">Gratis</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleTrial}
                                    disabled={!!busyKey || trial?.claimed || !trial?.available}
                                    className="mt-3 w-full rounded-control bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                                >
                                    {trial?.claimed ? 'Sudah dipakai di perangkat ini' : (busyKey === 'trial' ? 'Mengaktifkan…' : 'Coba gratis')}
                                </button>
                            </Card>
                        )}

                        <h2 className="mt-6 font-semibold">Paket berbayar</h2>
                        <Card className="mt-2">
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Nama" value={buyer.name} onChange={(v) => setBuyer((b) => ({ ...b, name: v }))} />
                                <Field label="Nomor HP" value={buyer.phone} onChange={(v) => setBuyer((b) => ({ ...b, phone: v }))} type="tel" />
                            </div>
                            <p className="mt-2 text-xs text-content-subtle">Dipakai untuk bukti pembayaran dan bantuan bila ada kendala.</p>
                        </Card>

                        <div className="mt-3 space-y-3">
                            {paidProducts.map((p) => (
                                <Card key={p.key}>
                                    <div className="flex items-baseline justify-between gap-3">
                                        <h3 className="font-semibold">{p.label}</h3>
                                        <span className="text-lg font-semibold">{formatRupiah(p.price)}</span>
                                    </div>
                                    <dl className="mt-2 space-y-1 text-sm">
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
                                        className="mt-3 w-full rounded-control bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                                    >
                                        {busyKey === p.key ? 'Memproses…' : 'Beli'}
                                    </button>
                                </Card>
                            ))}
                        </div>

                        <p className="mt-5 text-xs leading-5 text-content-subtle">
                            Kedalaman adalah batas paling jauh, bukan janji rekaman selalu tersedia sampai ke
                            sana. Arsip mulai dikumpulkan 31 Juli 2026 dan bertambah setiap harinya.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}

export default PlaybackAccessPage;
