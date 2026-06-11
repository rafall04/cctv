/*
 * Purpose: Admin billing page — customer balances, camera subscription assignment/lifecycle,
 *          manual top-up, payment confirmation (manual gateway), and ops charge trigger.
 * Caller: App.jsx /admin/billing (adminOnly) inside AdminLayout.
 * Deps: billingAdminService, cameraService (camera picker), useNotification.
 * MainFuncs: BillingManagement (tabs: Pelanggan / Langganan / Pembayaran).
 * SideEffects: Fetches billing data; mutations via billingAdminService.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import billingAdminService from '../services/billingAdminService';
import { cameraService } from '../services/cameraService';
import { useNotification } from '../contexts/NotificationContext';

function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

const SUB_STATUS_BADGES = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    suspended: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const PAY_STATUS_BADGES = {
    pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    expired: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const inputClass = 'w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';
const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4';

export default function BillingManagement() {
    const { success, error: showError } = useNotification();
    const [tab, setTab] = useState('customers');
    const [customers, setCustomers] = useState([]);
    const [subscriptions, setSubscriptions] = useState([]);
    const [payments, setPayments] = useState([]);
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);

    const [assignForm, setAssignForm] = useState({ camera_id: '', user_id: '', monthly_price: 20000 });
    const [topupForm, setTopupForm] = useState({ user_id: '', amount: 25000, note: '' });
    const [busy, setBusy] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [customersRes, subsRes, paymentsRes, camerasRes] = await Promise.all([
                billingAdminService.getCustomers(),
                billingAdminService.getSubscriptions(),
                billingAdminService.getPayments(),
                cameraService.getAllCameras(),
            ]);
            if (customersRes.success) setCustomers(customersRes.data || []);
            if (subsRes.success) setSubscriptions(subsRes.data || []);
            if (paymentsRes.success) setPayments(paymentsRes.data || []);
            if (camerasRes.success) setCameras(camerasRes.data || []);
        } catch (err) {
            console.error('Load billing data error:', err);
            showError('Gagal memuat', 'Data billing tidak dapat dimuat.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        reload();
    }, [reload]);

    const run = useCallback(async (fn, successTitle) => {
        setBusy(true);
        try {
            const response = await fn();
            if (response.success) {
                success(successTitle, response.message || 'Berhasil');
                await reload();
                return true;
            }
            showError('Gagal', response.message || 'Operasi gagal');
            return false;
        } catch (err) {
            showError('Gagal', err.response?.data?.message || 'Operasi gagal');
            return false;
        } finally {
            setBusy(false);
        }
    }, [reload, success, showError]);

    const assignableCameras = useMemo(
        () => cameras.filter((camera) => (camera.camera_class || 'community') !== 'subscriber'
            || !subscriptions.some((s) => s.camera_id === camera.id && s.status !== 'cancelled')),
        [cameras, subscriptions]
    );

    const handleAssign = async (e) => {
        e.preventDefault();
        const ok = await run(
            () => billingAdminService.assignSubscription({
                camera_id: parseInt(assignForm.camera_id, 10),
                user_id: parseInt(assignForm.user_id, 10),
                monthly_price: parseInt(assignForm.monthly_price, 10),
            }),
            'Kamera di-assign'
        );
        if (ok) setAssignForm({ camera_id: '', user_id: '', monthly_price: 20000 });
    };

    const handleManualTopup = async (e) => {
        e.preventDefault();
        const ok = await run(
            () => billingAdminService.manualTopup({
                user_id: parseInt(topupForm.user_id, 10),
                amount: parseInt(topupForm.amount, 10),
                note: topupForm.note || undefined,
            }),
            'Saldo ditambahkan'
        );
        if (ok) setTopupForm({ user_id: '', amount: 25000, note: '' });
    };

    const tabs = [
        { key: 'customers', label: `Pelanggan (${customers.length})` },
        { key: 'subscriptions', label: `Langganan (${subscriptions.length})` },
        { key: 'payments', label: `Pembayaran (${payments.length})` },
    ];

    return (
        <div className="p-4 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Billing Pelanggan</h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Sewa CCTV prabayar — saldo dipotong harian, kamera ditangguhkan otomatis saat saldo habis.
                    </p>
                </div>
                <button
                    onClick={() => run(() => billingAdminService.runCharges(), 'Charge dijalankan')}
                    disabled={busy}
                    className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                    Jalankan charge harian sekarang
                </button>
            </div>

            <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${tab === t.key
                            ? 'border-primary text-primary'
                            : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat data billing…</div>
            ) : (
                <>
                    {tab === 'customers' && (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="lg:col-span-2 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                            <th className="px-3 py-2">Pelanggan</th>
                                            <th className="px-3 py-2">Kontak</th>
                                            <th className="px-3 py-2 text-right">Saldo</th>
                                            <th className="px-3 py-2 text-center">Kamera</th>
                                            <th className="px-3 py-2 text-center">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {customers.map((customer) => (
                                            <tr key={customer.id} className="bg-white dark:bg-gray-900">
                                                <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{customer.username}</td>
                                                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{customer.phone || customer.email || '—'}</td>
                                                <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{formatRupiah(customer.balance)}</td>
                                                <td className="px-3 py-2 text-center">{customer.camera_count}</td>
                                                <td className="px-3 py-2 text-center">
                                                    {customer.suspended_subscriptions > 0 ? (
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SUB_STATUS_BADGES.suspended}`}>
                                                            {customer.suspended_subscriptions} ditangguhkan
                                                        </span>
                                                    ) : (
                                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SUB_STATUS_BADGES.active}`}>
                                                            OK
                                                        </span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                        {customers.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                                                    Belum ada pelanggan. Buat user dengan role <code>customer</code> di halaman Users.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <form onSubmit={handleManualTopup} className={cardClass}>
                                <h3 className="font-semibold text-gray-900 dark:text-white">Top-up Manual</h3>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    Untuk pembayaran tunai/transfer langsung ke admin.
                                </p>
                                <div className="mt-3 space-y-2">
                                    <select
                                        value={topupForm.user_id}
                                        onChange={(e) => setTopupForm({ ...topupForm, user_id: e.target.value })}
                                        required
                                        className={inputClass}
                                    >
                                        <option value="">Pilih pelanggan…</option>
                                        {customers.map((c) => (
                                            <option key={c.id} value={c.id}>{c.username} ({formatRupiah(c.balance)})</option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min="1000"
                                        step="1000"
                                        value={topupForm.amount}
                                        onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })}
                                        required
                                        className={inputClass}
                                        placeholder="Nominal"
                                    />
                                    <input
                                        type="text"
                                        value={topupForm.note}
                                        onChange={(e) => setTopupForm({ ...topupForm, note: e.target.value })}
                                        className={inputClass}
                                        placeholder="Catatan (opsional)"
                                    />
                                    <button
                                        type="submit"
                                        disabled={busy}
                                        className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
                                    >
                                        Tambah Saldo
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {tab === 'subscriptions' && (
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                            <div className="lg:col-span-2 overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                            <th className="px-3 py-2">Kamera</th>
                                            <th className="px-3 py-2">Pelanggan</th>
                                            <th className="px-3 py-2 text-right">Harga/bulan</th>
                                            <th className="px-3 py-2 text-center">Status</th>
                                            <th className="px-3 py-2 text-right">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {subscriptions.map((sub) => (
                                            <tr key={sub.id} className="bg-white dark:bg-gray-900">
                                                <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{sub.camera_name}</td>
                                                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                                                    {sub.customer_username}
                                                    <span className="ml-1 text-xs text-gray-400">({formatRupiah(sub.wallet_balance || 0)})</span>
                                                </td>
                                                <td className="px-3 py-2 text-right">{formatRupiah(sub.monthly_price)}</td>
                                                <td className="px-3 py-2 text-center">
                                                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SUB_STATUS_BADGES[sub.status] || ''}`}>
                                                        {sub.status}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-right">
                                                    <div className="flex justify-end gap-1">
                                                        {sub.status !== 'cancelled' && (
                                                            <button
                                                                onClick={() => run(
                                                                    () => billingAdminService.updateSubscription(sub.id, {
                                                                        status: sub.status === 'active' ? 'suspended' : 'active',
                                                                    }),
                                                                    sub.status === 'active' ? 'Langganan ditangguhkan' : 'Langganan diaktifkan'
                                                                )}
                                                                disabled={busy}
                                                                className="rounded-lg px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                                                            >
                                                                {sub.status === 'active' ? 'Tangguhkan' : 'Aktifkan'}
                                                            </button>
                                                        )}
                                                        {sub.status !== 'cancelled' && (
                                                            <button
                                                                onClick={() => {
                                                                    if (window.confirm(`Hentikan langganan ${sub.camera_name}? Stream akan diblokir.`)) {
                                                                        run(
                                                                            () => billingAdminService.updateSubscription(sub.id, { status: 'cancelled' }),
                                                                            'Langganan dihentikan'
                                                                        );
                                                                    }
                                                                }}
                                                                disabled={busy}
                                                                className="rounded-lg px-2 py-1 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/30"
                                                            >
                                                                Hentikan
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {subscriptions.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                                                    Belum ada langganan. Assign kamera ke pelanggan lewat form di samping.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                            <form onSubmit={handleAssign} className={cardClass}>
                                <h3 className="font-semibold text-gray-900 dark:text-white">Assign Kamera ke Pelanggan</h3>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    Kamera menjadi kelas <code>subscriber</code>: hilang dari publik, hanya bisa dilihat pelanggan, dan mulai ditagih hari ini.
                                </p>
                                <div className="mt-3 space-y-2">
                                    <select
                                        value={assignForm.camera_id}
                                        onChange={(e) => setAssignForm({ ...assignForm, camera_id: e.target.value })}
                                        required
                                        className={inputClass}
                                    >
                                        <option value="">Pilih kamera…</option>
                                        {assignableCameras.map((camera) => (
                                            <option key={camera.id} value={camera.id}>
                                                #{camera.id} {camera.name} ({camera.camera_class || 'community'})
                                            </option>
                                        ))}
                                    </select>
                                    <select
                                        value={assignForm.user_id}
                                        onChange={(e) => setAssignForm({ ...assignForm, user_id: e.target.value })}
                                        required
                                        className={inputClass}
                                    >
                                        <option value="">Pilih pelanggan…</option>
                                        {customers.map((c) => (
                                            <option key={c.id} value={c.id}>{c.username}</option>
                                        ))}
                                    </select>
                                    <input
                                        type="number"
                                        min="1000"
                                        step="1000"
                                        value={assignForm.monthly_price}
                                        onChange={(e) => setAssignForm({ ...assignForm, monthly_price: e.target.value })}
                                        required
                                        className={inputClass}
                                        placeholder="Harga per bulan (mis. 20000)"
                                    />
                                    <button
                                        type="submit"
                                        disabled={busy}
                                        className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50"
                                    >
                                        Assign & Mulai Tagih
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {tab === 'payments' && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                        <th className="px-3 py-2">ID</th>
                                        <th className="px-3 py-2">Pelanggan</th>
                                        <th className="px-3 py-2">Gateway</th>
                                        <th className="px-3 py-2 text-right">Nominal</th>
                                        <th className="px-3 py-2 text-center">Status</th>
                                        <th className="px-3 py-2">Dibuat</th>
                                        <th className="px-3 py-2 text-right">Aksi</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                    {payments.map((payment) => (
                                        <tr key={payment.id} className="bg-white dark:bg-gray-900">
                                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">#{payment.id}</td>
                                            <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">{payment.username || payment.user_id}</td>
                                            <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{payment.gateway}</td>
                                            <td className="px-3 py-2 text-right font-semibold">{formatRupiah(payment.amount)}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PAY_STATUS_BADGES[payment.status] || ''}`}>
                                                    {payment.status}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{payment.created_at}</td>
                                            <td className="px-3 py-2 text-right">
                                                {payment.status === 'pending' && (
                                                    <button
                                                        onClick={() => {
                                                            if (window.confirm(`Konfirmasi pembayaran ${formatRupiah(payment.amount)} dari ${payment.username}? Saldo akan dikreditkan.`)) {
                                                                run(
                                                                    () => billingAdminService.markPaymentPaid(payment.id),
                                                                    'Pembayaran dikonfirmasi'
                                                                );
                                                            }
                                                        }}
                                                        disabled={busy}
                                                        className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                                                    >
                                                        Konfirmasi Bayar
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {payments.length === 0 && (
                                        <tr>
                                            <td colSpan="7" className="px-3 py-8 text-center text-gray-500 dark:text-gray-400">
                                                Belum ada pembayaran.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
