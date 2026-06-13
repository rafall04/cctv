/*
 * Purpose: Customer "Saldo & Tagihan" page — balance summary, top-up (QRIS/manual) with
 *          status polling, subscription costs, and the wallet ledger.
 * Caller: App.jsx /my/wallet route inside CustomerLayout.
 * Deps: customerService, formatRupiah.
 * MainFuncs: MyWallet, TopupPanel.
 * SideEffects: Polls pending top-up status every 5s until terminal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import customerService from '../../services/customerService';
import { formatRupiah } from '../../layouts/CustomerLayout';

const PRESET_AMOUNTS = [25000, 50000, 100000];
const POLL_INTERVAL_MS = 5000;

const TYPE_LABELS = {
    topup: 'Top-up',
    charge: 'Biaya harian',
    refund: 'Refund',
    adjustment: 'Penyesuaian',
};

const STATUS_LABELS = {
    pending: { text: 'Menunggu pembayaran', className: 'text-amber-600 dark:text-amber-400' },
    paid: { text: 'Berhasil', className: 'text-emerald-600 dark:text-emerald-400' },
    expired: { text: 'Kedaluwarsa', className: 'text-gray-500' },
    failed: { text: 'Gagal', className: 'text-red-600 dark:text-red-400' },
    cancelled: { text: 'Dibatalkan', className: 'text-gray-500' },
};

function TopupPanel({ onCompleted, resumable = [] }) {
    const [amount, setAmount] = useState(PRESET_AMOUNTS[0]);
    const [customAmount, setCustomAmount] = useState('');
    const [pending, setPending] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [methods, setMethods] = useState([]);
    const [selectedMethod, setSelectedMethod] = useState('');
    const [promoCode, setPromoCode] = useState('');
    const [promoPreview, setPromoPreview] = useState(null); // { ok, bonus } | { ok:false, error }
    const [giftCode, setGiftCode] = useState('');
    const [giftBusy, setGiftBusy] = useState(false);
    const [giftMsg, setGiftMsg] = useState(null);
    const pollRef = useRef(null);
    const qrBoxRef = useRef(null);
    const [copied, setCopied] = useState(false);
    const shareSupported = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

    const effectiveAmount = customAmount ? parseInt(customAmount, 10) : amount;

    // Live promo preview: validate the code against the chosen amount (debounced) so the
    // customer sees the exact bonus BEFORE paying, instead of finding out on submit.
    useEffect(() => {
        const code = promoCode.trim();
        if (!code || !Number.isInteger(effectiveAmount) || effectiveAmount < 10000) {
            setPromoPreview(null);
            return undefined;
        }
        let active = true;
        const timer = setTimeout(async () => {
            try {
                const res = await customerService.validatePromo(code, effectiveAmount);
                if (active && res?.success) setPromoPreview({ ok: true, bonus: res.data?.bonus || 0 });
            } catch (err) {
                if (active) setPromoPreview({ ok: false, error: err.response?.data?.message || 'Kode promo tidak valid' });
            }
        }, 450);
        return () => { active = false; clearTimeout(timer); };
    }, [promoCode, effectiveAmount]);

    useEffect(() => {
        let mounted = true;
        customerService.getPaymentOptions?.().then((res) => {
            if (mounted && res?.success && Array.isArray(res.data?.methods)) {
                setMethods(res.data.methods);
                if (res.data.methods.length > 0) {
                    setSelectedMethod(res.data.methods[0].key);
                }
            }
        }).catch(() => {});
        return () => { mounted = false; };
    }, []);

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    }, []);

    useEffect(() => stopPolling, [stopPolling]);

    const startPolling = useCallback((paymentId) => {
        stopPolling();
        pollRef.current = setInterval(async () => {
            try {
                const response = await customerService.getTopupStatus(paymentId);
                if (!response.success) return;
                const payment = response.data;
                setPending(payment);
                if (payment.status !== 'pending') {
                    stopPolling();
                    if (payment.status === 'paid') {
                        onCompleted();
                    }
                }
            } catch {
                // transient poll failure — keep trying until terminal status
            }
        }, POLL_INTERVAL_MS);
    }, [onCompleted, stopPolling]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        const finalAmount = customAmount ? parseInt(customAmount, 10) : amount;
        if (!Number.isInteger(finalAmount) || finalAmount < 10000) {
            setError('Nominal minimal Rp10.000');
            return;
        }
        setSubmitting(true);
        try {
            const response = await customerService.createTopup(finalAmount, selectedMethod || null, promoCode.trim() || null);
            if (response.success) {
                setPending(response.data);
                if (response.data.status === 'pending') {
                    startPolling(response.data.id);
                }
            } else {
                setError(response.message || 'Gagal membuat permintaan top-up');
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Gagal membuat permintaan top-up');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRedeemGift = async () => {
        const code = giftCode.trim();
        if (!code) return;
        setGiftBusy(true);
        setGiftMsg(null);
        try {
            const res = await customerService.redeemPromo(code);
            if (res.success) {
                setGiftMsg({ type: 'ok', text: res.message || 'Hadiah masuk ke saldo.' });
                setGiftCode('');
                onCompleted();
            } else {
                setGiftMsg({ type: 'error', text: res.message || 'Gagal menukar kode' });
            }
        } catch (err) {
            setGiftMsg({ type: 'error', text: err.response?.data?.message || 'Gagal menukar kode' });
        } finally {
            setGiftBusy(false);
        }
    };

    const qrCanvas = () => qrBoxRef.current?.querySelector('canvas');

    // Save the QR as a PNG so a customer paying on the SAME phone can use their payment
    // app's "scan from gallery" — the standard way to pay QRIS without a second device.
    const downloadQr = () => {
        const canvas = qrCanvas();
        if (!canvas) return;
        const link = document.createElement('a');
        link.download = `qris-topup-${pending?.amount || ''}.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const copyQris = async () => {
        const code = pending?.qris?.qr_string;
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // clipboard blocked — the Simpan QR button still covers the customer
        }
    };

    // Web Share (mobile): hand the QR PNG to the OS share sheet → save to gallery or send
    // straight to an e-wallet app. Falls back silently if unsupported/cancelled.
    const shareQr = async () => {
        const canvas = qrCanvas();
        if (!canvas) return;
        try {
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
            if (!blob) return;
            const file = new File([blob], 'qris-topup.png', { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file], title: 'QRIS Top-up Saldo' });
            } else {
                downloadQr();
            }
        } catch {
            // user cancelled or unsupported — no-op
        }
    };

    if (pending) {
        const statusLabel = STATUS_LABELS[pending.status] || STATUS_LABELS.pending;
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="font-semibold text-gray-900 dark:text-white">Top-up {formatRupiah(pending.amount)}</h3>
                <p className={`mt-1 text-sm font-medium ${statusLabel.className}`}>{statusLabel.text}</p>
                {pending.promo_bonus > 0 && (
                    <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        + Bonus {formatRupiah(pending.promo_bonus)}{pending.promo_code ? ` (${pending.promo_code})` : ''} setelah pembayaran berhasil
                    </p>
                )}

                {/* QRIS: render the QR from the EMVCo payload (qr_string) ourselves — iPaymu's
                    production qr_url is an HTML page, not an image, so an <img> would break.
                    Fall back to opening that page only when we have no payload. */}
                {pending.status === 'pending' && (pending.qris?.qr_string || pending.qris?.qr_url) && (
                    <div className="mt-3 flex flex-col items-center gap-2">
                        {pending.qris?.qr_string ? (
                            <>
                                {/* Hidden hi-res canvas (generous quiet zone) backs Simpan/Bagikan so
                                    the SAVED PNG scans reliably from a gallery regardless of display size. */}
                                <div ref={qrBoxRef} className="hidden" aria-hidden="true">
                                    <QRCodeCanvas value={pending.qris.qr_string} size={640} level="M" marginSize={4} />
                                </div>
                                <div className="rounded-lg bg-white p-3">
                                    <QRCodeCanvas value={pending.qris.qr_string} size={232} level="M" marginSize={2} />
                                </div>
                                <div className="flex w-full flex-wrap items-center justify-center gap-2">
                                    <button type="button" onClick={downloadQr} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-600">
                                        ⬇ Simpan QR
                                    </button>
                                    <button type="button" onClick={copyQris} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                                        {copied ? '✓ Tersalin' : '⧉ Salin kode'}
                                    </button>
                                    {shareSupported && (
                                        <button type="button" onClick={shareQr} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                                            ↗ Bagikan
                                        </button>
                                    )}
                                </div>
                                <div className="rounded-lg bg-blue-50 p-2.5 text-center text-xs leading-relaxed text-blue-700 dark:bg-blue-900/20 dark:text-blue-300">
                                    <b>Bayar dari HP ini?</b> Tap <b>Simpan QR</b> → buka aplikasi e-wallet/m-banking → pilih <b>&ldquo;Scan dari galeri/album&rdquo;</b> → pilih gambar QR tadi.
                                    <span className="mt-1 block text-gray-500 dark:text-gray-400">Bayar dari HP lain / komputer? Cukup scan QR di atas. Saldo masuk otomatis.</span>
                                </div>
                            </>
                        ) : (
                            <a
                                href={pending.qris.qr_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600"
                            >
                                Buka halaman QRIS untuk scan →
                            </a>
                        )}
                        {pending.qris?.qr_url && (
                            <a href={pending.qris.qr_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">
                                Buka halaman QRIS resmi iPaymu
                            </a>
                        )}
                    </div>
                )}
                {pending.status === 'pending' && !pending.qris?.qr_string && !pending.qris?.qr_url && pending.qris?.va_number && (
                    <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{pending.qris.payment_name || 'Virtual Account'}</p>
                        <p className="mt-0.5 select-all font-mono text-lg font-bold tracking-wider text-gray-900 dark:text-white">{pending.qris.va_number}</p>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Transfer tepat {formatRupiah(pending.amount)} ke nomor di atas via m-banking/ATM. Saldo masuk otomatis setelah terbayar.
                        </p>
                    </div>
                )}
                {pending.status === 'pending' && !pending.qris?.qr_string && !pending.qris?.qr_url && !pending.qris?.va_number && (
                    <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {pending.instructions || 'Bayar ke admin sesuai nominal, saldo akan dikonfirmasi manual oleh admin.'}
                    </p>
                )}
                {pending.status === 'paid' && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800/50 dark:bg-emerald-900/20">
                        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">✅ Pembayaran berhasil — bukti top-up</p>
                        <dl className="mt-2 space-y-1 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-gray-500 dark:text-gray-400">Nominal</dt>
                                <dd className="font-medium text-gray-900 dark:text-white">{formatRupiah(pending.amount)}</dd>
                            </div>
                            {pending.promo_bonus > 0 && (
                                <div className="flex justify-between">
                                    <dt className="text-gray-500 dark:text-gray-400">Bonus promo{pending.promo_code ? ` (${pending.promo_code})` : ''}</dt>
                                    <dd className="font-medium text-emerald-600 dark:text-emerald-400">+{formatRupiah(pending.promo_bonus)}</dd>
                                </div>
                            )}
                            <div className="flex justify-between border-t border-emerald-200 pt-1 dark:border-emerald-800/50">
                                <dt className="text-gray-600 dark:text-gray-300">Total masuk</dt>
                                <dd className="font-bold text-gray-900 dark:text-white">{formatRupiah(pending.amount + (pending.promo_bonus || 0))}</dd>
                            </div>
                            {pending.paid_at && (
                                <p className="pt-1 text-xs text-gray-400">{String(pending.paid_at).replace('T', ' ').slice(0, 19)} · #{pending.id}</p>
                            )}
                        </dl>
                        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">Kamera yang ditangguhkan otomatis aktif kembali.</p>
                    </div>
                )}

                <button
                    onClick={() => { stopPolling(); setPending(null); }}
                    className="mt-4 w-full rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    {pending.status === 'pending' ? 'Buat permintaan lain' : 'Top-up lagi'}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
        {resumable.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-900/20">
                <h3 className="font-semibold text-amber-800 dark:text-amber-300">Top-up belum dibayar</h3>
                <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Masih bisa dipakai — klik untuk lanjutkan pembayaran.</p>
                <div className="mt-2 space-y-1.5">
                    {resumable.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            onClick={() => { setPending(p); startPolling(p.id); }}
                            className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-amber-100/60 dark:border-amber-800/50 dark:bg-gray-900 dark:hover:bg-amber-900/30"
                        >
                            <span className="font-medium text-gray-900 dark:text-white">{formatRupiah(p.amount)}</span>
                            <span className="text-xs text-amber-700 dark:text-amber-400">Lihat QR / bayar →</span>
                        </button>
                    ))}
                </div>
            </div>
        )}
        <form onSubmit={handleSubmit} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-semibold text-gray-900 dark:text-white">Isi Saldo</h3>

            {methods.length > 1 && (
                <div className="mt-3">
                    <label htmlFor="topup-method" className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">Metode Pembayaran</label>
                    <select
                        id="topup-method"
                        value={selectedMethod}
                        onChange={(e) => setSelectedMethod(e.target.value)}
                        className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                    >
                        {methods.map((m) => (
                            <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                    </select>
                </div>
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
                {PRESET_AMOUNTS.map((preset) => (
                    <button
                        type="button"
                        key={preset}
                        onClick={() => { setAmount(preset); setCustomAmount(''); }}
                        className={`rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${!customAmount && amount === preset
                            ? 'border-primary bg-primary text-white'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                    >
                        {formatRupiah(preset)}
                    </button>
                ))}
            </div>
            {/* Thousand-separator display: store raw digits, render "10000" as "10.000" (id-ID)
                so the customer reads the nominal at a glance. inputMode=numeric → numeric keypad. */}
            <div className="relative mt-2">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-gray-400">Rp</span>
                <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Nominal lain (min 10.000)"
                    value={customAmount ? Number(customAmount).toLocaleString('id-ID') : ''}
                    onChange={(e) => { setCustomAmount(e.target.value.replace(/\D/g, '')); setError(''); }}
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                />
            </div>
            <input
                type="text"
                value={promoCode}
                onChange={(e) => { setPromoCode(e.target.value); setError(''); }}
                maxLength={40}
                placeholder="Kode promo (opsional)"
                className="mt-2 w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm uppercase text-gray-900 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
            />
            {promoPreview?.ok && promoPreview.bonus > 0 && (
                <p className="mt-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    ✓ Bonus +{formatRupiah(promoPreview.bonus)} akan masuk setelah pembayaran berhasil
                </p>
            )}
            {promoPreview && !promoPreview.ok && (
                <p className="mt-1.5 text-sm text-amber-600 dark:text-amber-400">{promoPreview.error}</p>
            )}
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
                type="submit"
                disabled={submitting}
                className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-60"
            >
                {submitting ? 'Memproses…' : 'Lanjutkan Top-up'}
            </button>
        </form>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
            <h3 className="font-semibold text-gray-900 dark:text-white">Tukar Kode Hadiah</h3>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Punya kode hadiah? Tukar jadi saldo langsung.</p>
            <div className="mt-2 flex gap-2">
                <input
                    type="text"
                    value={giftCode}
                    onChange={(e) => { setGiftCode(e.target.value); setGiftMsg(null); }}
                    maxLength={40}
                    placeholder="Kode hadiah"
                    className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm uppercase text-gray-900 placeholder:normal-case focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
                />
                <button
                    type="button"
                    onClick={handleRedeemGift}
                    disabled={giftBusy || !giftCode.trim()}
                    className="shrink-0 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                    {giftBusy ? '…' : 'Tukar'}
                </button>
            </div>
            {giftMsg && (
                <p className={`mt-2 text-sm ${giftMsg.type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    {giftMsg.text}
                </p>
            )}
        </div>
        </div>
    );
}

export default function MyWallet() {
    const [summary, setSummary] = useState(null);
    const [wallet, setWallet] = useState(null);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    // "Muat lebih banyak" bumps these; reload refetches with the new caps.
    const [walletLimit, setWalletLimit] = useState(50);
    const [paymentsLimit, setPaymentsLimit] = useState(20);

    const reload = useCallback(async () => {
        try {
            const [summaryRes, walletRes, paymentsRes] = await Promise.all([
                customerService.getSummary(),
                customerService.getWallet(walletLimit),
                customerService.getPayments(paymentsLimit),
            ]);
            if (summaryRes.success) setSummary(summaryRes.data);
            if (walletRes.success) setWallet(walletRes.data);
            if (paymentsRes.success) setPayments(paymentsRes.data || []);
        } catch {
            // page-level skeleton stays; ledger errors are non-fatal
        } finally {
            setLoading(false);
        }
    }, [walletLimit, paymentsLimit]);

    // Pending top-ups that are still payable (not expired) — so a created-but-unpaid QR/VA
    // is never lost on navigation/refresh and the customer can resume it.
    const now = Date.now();
    const pendingTopups = payments.filter(
        (p) => p.status === 'pending' && (!p.expires_at || new Date(p.expires_at).getTime() > now)
    );

    useEffect(() => {
        reload();
    }, [reload]);

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat saldo…</div>;
    }

    const daysLeft = summary?.estimated_days_left;
    const hasDailyCost = (summary?.daily_cost || 0) > 0;
    const emptyBalance = hasDailyCost && (summary?.balance || 0) <= 0;
    const lowBalance = hasDailyCost && daysLeft !== null && daysLeft !== undefined && daysLeft <= 3;

    return (
        <div className="space-y-4">
        {(emptyBalance || lowBalance) && (
            <div className={`flex items-start gap-3 rounded-2xl border p-4 ${emptyBalance
                ? 'border-red-200 bg-red-50 dark:border-red-800/50 dark:bg-red-900/20'
                : 'border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-900/20'
            }`}>
                <span className="text-xl leading-none">{emptyBalance ? '🔴' : '⚠️'}</span>
                <div className="min-w-0">
                    <p className={`text-sm font-semibold ${emptyBalance ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>
                        {emptyBalance
                            ? 'Saldo habis — kamera berbayar Anda ditangguhkan'
                            : `Saldo menipis — perkiraan cukup untuk ±${daysLeft} hari lagi`}
                    </p>
                    <p className={`mt-0.5 text-xs ${emptyBalance ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                        Isi saldo di panel <b>Isi Saldo</b> agar kamera tetap aktif. Biaya {formatRupiah(summary?.daily_cost)}/hari.
                    </p>
                </div>
            </div>
        )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Saldo</p>
                        <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatRupiah(summary?.balance)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Biaya per hari</p>
                        <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatRupiah(summary?.daily_cost)}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <p className="text-xs text-gray-500 dark:text-gray-400">Perkiraan cukup untuk</p>
                        <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">
                            {summary?.estimated_days_left !== null && summary?.estimated_days_left !== undefined
                                ? `±${summary.estimated_days_left} hari`
                                : '—'}
                        </p>
                    </div>
                </div>

                {summary?.subscriptions?.length > 0 && (
                    <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                        <h3 className="font-semibold text-gray-900 dark:text-white">Langganan Kamera</h3>
                        <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                            {summary.subscriptions.map((sub) => (
                                <div key={sub.id} className="flex items-center justify-between py-2 text-sm">
                                    <div className="min-w-0">
                                        <p className="truncate font-medium text-gray-900 dark:text-white">{sub.camera_name}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {formatRupiah(sub.monthly_price)}/bulan · {formatRupiah(sub.daily_cost)}/hari
                                        </p>
                                    </div>
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${sub.status === 'active'
                                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                                    }`}>
                                        {sub.status === 'active' ? 'Aktif' : 'Ditangguhkan'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Riwayat Transaksi</h3>
                    {wallet?.transactions?.length ? (
                        <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                            {wallet.transactions.map((trx) => (
                                <div key={trx.id} className="flex items-center justify-between py-2 text-sm">
                                    <div className="min-w-0">
                                        <p className="font-medium text-gray-900 dark:text-white">
                                            {TYPE_LABELS[trx.type] || trx.type}
                                        </p>
                                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                                            {trx.note || trx.reference || ''} · {trx.created_at}
                                        </p>
                                    </div>
                                    <p className={`font-semibold ${trx.amount >= 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-gray-700 dark:text-gray-300'
                                    }`}>
                                        {trx.amount >= 0 ? '+' : ''}{formatRupiah(trx.amount)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Belum ada transaksi.</p>
                    )}
                    {wallet?.transactions?.length >= walletLimit && (
                        <button onClick={() => setWalletLimit((n) => n + 50)} className="mt-2 w-full rounded-lg border border-gray-200 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                            Muat lebih banyak
                        </button>
                    )}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Riwayat Pembayaran</h3>
                    {payments.length ? (
                        <div className="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
                            {payments.map((p) => {
                                const st = STATUS_LABELS[p.status] || { text: p.status, className: 'text-gray-500' };
                                return (
                                    <div key={p.id} className="flex items-center justify-between py-2 text-sm">
                                        <div className="min-w-0">
                                            <p className="font-medium text-gray-900 dark:text-white">{formatRupiah(p.amount)}</p>
                                            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{p.gateway} · {p.created_at}</p>
                                        </div>
                                        <span className={`shrink-0 text-xs font-semibold ${st.className}`}>{st.text}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Belum ada pembayaran.</p>
                    )}
                    {payments.length >= paymentsLimit && (
                        <button onClick={() => setPaymentsLimit((n) => n + 20)} className="mt-2 w-full rounded-lg border border-gray-200 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
                            Muat lebih banyak
                        </button>
                    )}
                </div>
            </div>

            <div>
                <TopupPanel onCompleted={reload} resumable={pendingTopups} />
            </div>
        </div>
        </div>
    );
}
