/*
 * Purpose: Customer "Saldo & Tagihan" page — balance summary, top-up (QRIS/manual) with
 *          status polling, subscription costs, and the wallet ledger.
 * Caller: App.jsx /my/wallet route inside CustomerLayout.
 * Deps: customerService, formatRupiah.
 * MainFuncs: MyWallet, TopupPanel.
 * SideEffects: Polls pending top-up status every 5s until terminal.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

function TopupPanel({ onCompleted }) {
    const [amount, setAmount] = useState(PRESET_AMOUNTS[0]);
    const [customAmount, setCustomAmount] = useState('');
    const [pending, setPending] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [methods, setMethods] = useState([]);
    const [selectedMethod, setSelectedMethod] = useState('');
    const pollRef = useRef(null);

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
            const response = await customerService.createTopup(finalAmount, selectedMethod || null);
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

    if (pending) {
        const statusLabel = STATUS_LABELS[pending.status] || STATUS_LABELS.pending;
        return (
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h3 className="font-semibold text-gray-900 dark:text-white">Top-up {formatRupiah(pending.amount)}</h3>
                <p className={`mt-1 text-sm font-medium ${statusLabel.className}`}>{statusLabel.text}</p>

                {pending.status === 'pending' && pending.qris?.qr_url && (
                    <div className="mt-3 flex flex-col items-center gap-2">
                        <img src={pending.qris.qr_url} alt="QRIS" className="h-52 w-52 rounded-lg bg-white p-2" />
                        <p className="text-center text-xs text-gray-500 dark:text-gray-400">
                            Scan QRIS di atas dengan aplikasi pembayaran apa pun. Saldo masuk otomatis setelah terbayar.
                        </p>
                    </div>
                )}
                {pending.status === 'pending' && !pending.qris?.qr_url && pending.qris?.va_number && (
                    <div className="mt-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{pending.qris.payment_name || 'Virtual Account'}</p>
                        <p className="mt-0.5 select-all font-mono text-lg font-bold tracking-wider text-gray-900 dark:text-white">{pending.qris.va_number}</p>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Transfer tepat {formatRupiah(pending.amount)} ke nomor di atas via m-banking/ATM. Saldo masuk otomatis setelah terbayar.
                        </p>
                    </div>
                )}
                {pending.status === 'pending' && !pending.qris?.qr_url && !pending.qris?.va_number && (
                    <p className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {pending.instructions || 'Bayar ke admin sesuai nominal, saldo akan dikonfirmasi manual oleh admin.'}
                    </p>
                )}
                {pending.status === 'paid' && (
                    <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
                        ✅ Saldo sudah masuk. Kamera yang ditangguhkan otomatis aktif kembali.
                    </p>
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
            <input
                type="number"
                min="10000"
                step="1000"
                placeholder="Nominal lain (min Rp10.000)"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                className="mt-2 w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white"
            />
            {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
            <button
                type="submit"
                disabled={submitting}
                className="mt-3 w-full rounded-xl bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-60"
            >
                {submitting ? 'Memproses…' : 'Lanjutkan Top-up'}
            </button>
        </form>
    );
}

export default function MyWallet() {
    const [summary, setSummary] = useState(null);
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        try {
            const [summaryRes, walletRes] = await Promise.all([
                customerService.getSummary(),
                customerService.getWallet(),
            ]);
            if (summaryRes.success) setSummary(summaryRes.data);
            if (walletRes.success) setWallet(walletRes.data);
        } catch {
            // page-level skeleton stays; ledger errors are non-fatal
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat saldo…</div>;
    }

    return (
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
                </div>
            </div>

            <div>
                <TopupPanel onCompleted={reload} />
            </div>
        </div>
    );
}
