/*
 * Purpose: "Langganan" tab — camera subscriptions (suspend/resume/cancel) + assign-camera form.
 *          Responsive: table on md+, cards on mobile; assign form sidebar on lg+, above on mobile.
 * Caller: BillingManagement.
 * Deps: billingAdminService, billingFormat helpers.
 */

import { useState } from 'react';
import billingAdminService from '../../../services/billingAdminService';
import { formatRupiah, StatusBadge, SUB_STATUS_BADGES, cardClass, inputClass, DesktopTable } from './billingFormat';

export default function SubscriptionsTab({ subscriptions, assignableCameras, customers, run, busy }) {
    const [assignForm, setAssignForm] = useState({ camera_id: '', user_id: '', monthly_price: 20000 });

    const toggleStatus = (sub) => run(
        () => billingAdminService.updateSubscription(sub.id, { status: sub.status === 'active' ? 'suspended' : 'active' }),
        sub.status === 'active' ? 'Langganan ditangguhkan' : 'Langganan diaktifkan'
    );
    const cancelSub = (sub) => {
        if (window.confirm(`Hentikan langganan ${sub.camera_name}? Stream akan diblokir.`)) {
            run(() => billingAdminService.updateSubscription(sub.id, { status: 'cancelled' }), 'Langganan dihentikan');
        }
    };
    const submitAssign = async (e) => {
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

    const Actions = ({ sub, full }) => {
        if (sub.status === 'cancelled') return <span className="text-xs text-gray-400">—</span>;
        return (
            <div className={`flex gap-1 ${full ? 'w-full' : 'justify-end'}`}>
                <button onClick={() => toggleStatus(sub)} disabled={busy} className={`whitespace-nowrap rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800 ${full ? 'flex-1' : ''}`}>
                    {sub.status === 'active' ? 'Tangguhkan' : 'Aktifkan'}
                </button>
                <button onClick={() => cancelSub(sub)} disabled={busy} className={`whitespace-nowrap rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-900/30 ${full ? 'flex-1' : ''}`}>
                    Hentikan
                </button>
            </div>
        );
    };

    const assignFormEl = (
        <form onSubmit={submitAssign} className={cardClass}>
            <h3 className="font-semibold text-gray-900 dark:text-white">Assign Kamera ke Pelanggan</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Kamera menjadi kelas <code>subscriber</code>: hilang dari publik, hanya bisa dilihat pelanggan, dan mulai ditagih hari ini.
            </p>
            <div className="mt-3 space-y-2">
                <select value={assignForm.camera_id} onChange={(e) => setAssignForm({ ...assignForm, camera_id: e.target.value })} required className={inputClass}>
                    <option value="">Pilih kamera…</option>
                    {assignableCameras.map((camera) => (
                        <option key={camera.id} value={camera.id}>#{camera.id} {camera.name} ({camera.camera_class || 'community'})</option>
                    ))}
                </select>
                <select value={assignForm.user_id} onChange={(e) => setAssignForm({ ...assignForm, user_id: e.target.value })} required className={inputClass}>
                    <option value="">Pilih pelanggan…</option>
                    {customers.map((c) => (<option key={c.id} value={c.id}>{c.username}</option>))}
                </select>
                <input type="number" min="1000" step="1000" value={assignForm.monthly_price} onChange={(e) => setAssignForm({ ...assignForm, monthly_price: e.target.value })} required className={inputClass} placeholder="Harga per bulan (mis. 20000)" />
                <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50">Assign & Mulai Tagih</button>
            </div>
        </form>
    );

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:order-2 lg:col-span-1">{assignFormEl}</div>

            <div className="lg:order-1 lg:col-span-2">
                {subscriptions.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                        Belum ada langganan. Assign kamera ke pelanggan lewat form{' '}
                        <span className="lg:hidden">di atas</span><span className="hidden lg:inline">di samping</span>.
                    </div>
                ) : (
                    <>
                        {/* Desktop: table */}
                        <DesktopTable minWidth="min-w-[560px]">
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
                                            {sub.customer_username}<span className="ml-1 text-xs text-gray-400">({formatRupiah(sub.wallet_balance || 0)})</span>
                                        </td>
                                        <td className="px-3 py-2 text-right">{formatRupiah(sub.monthly_price)}</td>
                                        <td className="px-3 py-2 text-center"><StatusBadge className={SUB_STATUS_BADGES[sub.status] || ''}>{sub.status}</StatusBadge></td>
                                        <td className="px-3 py-2"><Actions sub={sub} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </DesktopTable>

                        {/* Mobile: cards */}
                        <div className="space-y-3 md:hidden">
                            {subscriptions.map((sub) => (
                                <div key={sub.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-semibold text-gray-900 dark:text-white">{sub.camera_name}</p>
                                            <p className="truncate text-sm text-gray-500 dark:text-gray-400">
                                                {sub.customer_username} · {formatRupiah(sub.wallet_balance || 0)}
                                            </p>
                                        </div>
                                        <StatusBadge className={SUB_STATUS_BADGES[sub.status] || ''}>{sub.status}</StatusBadge>
                                    </div>
                                    <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{formatRupiah(sub.monthly_price)}/bulan</p>
                                    {sub.status !== 'cancelled' && <div className="mt-3"><Actions sub={sub} full /></div>}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
