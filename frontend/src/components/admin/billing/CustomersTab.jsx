/*
 * Purpose: "Pelanggan" tab — customer list (balance, plan, camera count, status) + manual top-up
 *          form. Responsive: table on md+, cards on mobile; form is a sidebar on lg+, stacked above
 *          the list on mobile so the admin reaches it without scrolling past a long list.
 * Caller: BillingManagement.
 * Deps: billingAdminService, billingFormat helpers.
 */

import { useState } from 'react';
import billingAdminService from '../../../services/billingAdminService';
import { formatRupiah, StatusBadge, SUB_STATUS_BADGES, cardClass, inputClass, DesktopTable } from './billingFormat';

function AccountTag({ status }) {
    if (status === 'pending') {
        return <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">menunggu</span>;
    }
    if (status === 'rejected') {
        return <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">ditolak</span>;
    }
    return null;
}

function StatusCell({ customer }) {
    if (customer.suspended_subscriptions > 0) {
        return <StatusBadge className={SUB_STATUS_BADGES.suspended}>{customer.suspended_subscriptions} ditangguhkan</StatusBadge>;
    }
    return <StatusBadge className={SUB_STATUS_BADGES.active}>OK</StatusBadge>;
}

export default function CustomersTab({ customers, plans, run, busy }) {
    const [topupForm, setTopupForm] = useState({ user_id: '', amount: 25000, note: '' });
    const [adjustForm, setAdjustForm] = useState({ user_id: '', direction: 'credit', amount: 10000, reason: '' });

    const changePlan = (customer, planKey) => {
        if (planKey && window.confirm(`Ubah paket ${customer.username} ke ${planKey}? Harga kamera menyesuaikan.`)) {
            run(() => billingAdminService.changeCustomerPlan(customer.id, planKey), 'Paket pelanggan diubah');
        }
    };

    const submitTopup = async (e) => {
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

    const submitAdjust = async (e) => {
        e.preventDefault();
        const magnitude = parseInt(adjustForm.amount, 10);
        if (!adjustForm.user_id || !Number.isInteger(magnitude) || magnitude <= 0) return;
        const signed = adjustForm.direction === 'debit' ? -magnitude : magnitude;
        const verb = adjustForm.direction === 'debit' ? 'Kurangi saldo (refund)' : 'Tambah saldo';
        if (!window.confirm(`${verb} ${formatRupiah(magnitude)}? Alasan: ${adjustForm.reason || '(kosong)'}`)) return;
        const ok = await run(
            () => billingAdminService.adjustWallet({
                user_id: parseInt(adjustForm.user_id, 10),
                amount: signed,
                reason: adjustForm.reason,
            }),
            'Saldo disesuaikan'
        );
        if (ok) setAdjustForm({ user_id: '', direction: 'credit', amount: 10000, reason: '' });
    };

    const planSelect = (customer, extra = '') => (
        <select
            value={customer.plan_key || ''}
            disabled={busy}
            onChange={(e) => changePlan(customer, e.target.value)}
            className={`rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-900 dark:border-gray-700 dark:bg-gray-900/50 dark:text-white ${extra}`}
        >
            <option value="">(tanpa paket)</option>
            {plans.map((plan) => (
                <option key={plan.id} value={plan.key}>{plan.name}</option>
            ))}
        </select>
    );

    const topupForm_ = (
        <form onSubmit={submitTopup} className={cardClass}>
            <h3 className="font-semibold text-gray-900 dark:text-white">Top-up Manual</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Untuk pembayaran tunai/transfer langsung ke admin.</p>
            <div className="mt-3 space-y-2">
                <select value={topupForm.user_id} onChange={(e) => setTopupForm({ ...topupForm, user_id: e.target.value })} required className={inputClass}>
                    <option value="">Pilih pelanggan…</option>
                    {customers.map((c) => (<option key={c.id} value={c.id}>{c.username} ({formatRupiah(c.balance)})</option>))}
                </select>
                <input type="number" min="1000" step="1000" value={topupForm.amount} onChange={(e) => setTopupForm({ ...topupForm, amount: e.target.value })} required className={inputClass} placeholder="Nominal" />
                <input type="text" value={topupForm.note} onChange={(e) => setTopupForm({ ...topupForm, note: e.target.value })} className={inputClass} placeholder="Catatan (opsional)" />
                <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50">Tambah Saldo</button>
            </div>
        </form>
    );

    const adjustForm_ = (
        <form onSubmit={submitAdjust} className={cardClass}>
            <h3 className="font-semibold text-gray-900 dark:text-white">Penyesuaian Saldo</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Koreksi manual: tambah (kompensasi) atau kurangi (refund). Tercatat di riwayat &amp; audit.</p>
            <div className="mt-3 space-y-2">
                <select value={adjustForm.user_id} onChange={(e) => setAdjustForm({ ...adjustForm, user_id: e.target.value })} required className={inputClass}>
                    <option value="">Pilih pelanggan…</option>
                    {customers.map((c) => (<option key={c.id} value={c.id}>{c.username} ({formatRupiah(c.balance)})</option>))}
                </select>
                <div className="flex gap-2">
                    <select value={adjustForm.direction} onChange={(e) => setAdjustForm({ ...adjustForm, direction: e.target.value })} className={`${inputClass} w-auto shrink-0`}>
                        <option value="credit">+ Tambah</option>
                        <option value="debit">− Kurangi</option>
                    </select>
                    <input type="number" min="1" step="1000" value={adjustForm.amount} onChange={(e) => setAdjustForm({ ...adjustForm, amount: e.target.value })} required className={inputClass} placeholder="Nominal" />
                </div>
                <input type="text" value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} required maxLength={200} className={inputClass} placeholder="Alasan (wajib) — mis. refund kelebihan bayar" />
                <button type="submit" disabled={busy || !adjustForm.reason.trim()} className={`w-full rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 ${adjustForm.direction === 'debit' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                    {adjustForm.direction === 'debit' ? 'Kurangi Saldo' : 'Tambah Saldo'}
                </button>
            </div>
        </form>
    );

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Forms first in DOM so they sit ABOVE the list on mobile; on lg they move to the right column. */}
            <div className="space-y-4 lg:order-2 lg:col-span-1">{topupForm_}{adjustForm_}</div>

            <div className="lg:order-1 lg:col-span-2">
                {customers.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                        Belum ada pelanggan. Pelanggan bisa daftar mandiri di <code>/daftar</code>, atau buat user role <code>customer</code> di halaman Users.
                    </div>
                ) : (
                    <>
                        {/* Desktop: table */}
                        <DesktopTable minWidth="min-w-[620px]">
                            <thead>
                                <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                    <th className="px-3 py-2">Pelanggan</th>
                                    <th className="px-3 py-2">Kontak</th>
                                    <th className="px-3 py-2">Paket</th>
                                    <th className="px-3 py-2 text-right">Saldo</th>
                                    <th className="px-3 py-2 text-center">Kamera</th>
                                    <th className="px-3 py-2 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                {customers.map((customer) => (
                                    <tr key={customer.id} className="bg-white dark:bg-gray-900">
                                        <td className="px-3 py-2 font-medium text-gray-900 dark:text-white">
                                            {customer.username}<AccountTag status={customer.account_status} />
                                        </td>
                                        <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{customer.phone || customer.email || '—'}</td>
                                        <td className="px-3 py-2">
                                            {planSelect(customer)}
                                            {customer.plan_is_trial === 1 && customer.trial_ends_at && (
                                                <p className="mt-0.5 text-[10px] text-gray-400">trial s/d {String(customer.trial_ends_at).slice(0, 10)}</p>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right font-semibold text-gray-900 dark:text-white">{formatRupiah(customer.balance)}</td>
                                        <td className="px-3 py-2 text-center">{customer.camera_count}{customer.plan_max_cameras ? `/${customer.plan_max_cameras}` : ''}</td>
                                        <td className="px-3 py-2 text-center"><StatusCell customer={customer} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </DesktopTable>

                        {/* Mobile: cards */}
                        <div className="space-y-3 md:hidden">
                            {customers.map((customer) => (
                                <div key={customer.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-semibold text-gray-900 dark:text-white">
                                                {customer.username}<AccountTag status={customer.account_status} />
                                            </p>
                                            <p className="truncate text-sm text-gray-500 dark:text-gray-400">{customer.phone || customer.email || '—'}</p>
                                        </div>
                                        <p className="shrink-0 font-bold text-gray-900 dark:text-white">{formatRupiah(customer.balance)}</p>
                                    </div>
                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                        {planSelect(customer)}
                                        <span>Kamera: {customer.camera_count}{customer.plan_max_cameras ? `/${customer.plan_max_cameras}` : ''}</span>
                                        <StatusCell customer={customer} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
