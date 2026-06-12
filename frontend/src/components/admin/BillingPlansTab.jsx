/*
 * Purpose: Admin "Paket & Trial" tab — plan catalog CRUD (price/max cameras/trial days/active)
 *          and self-registration settings (toggle + default plan for new signups).
 * Caller: pages/BillingManagement.jsx.
 * Deps: billingAdminService.
 * MainFuncs: BillingPlansTab.
 * SideEffects: Plan/setting mutations via billingAdminService.
 */

import { useState } from 'react';
import billingAdminService from '../../services/billingAdminService';

const inputClass = 'w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';
const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4';

function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

const EMPTY_PLAN = { key: '', name: '', description: '', price_per_camera: 20000, max_cameras: 1, is_trial: false, trial_days: '' };

export default function BillingPlansTab({ plans, regSettings, run, busy }) {
    const [editing, setEditing] = useState(null); // null | 'new' | plan object
    const [form, setForm] = useState(EMPTY_PLAN);

    const openNew = () => {
        setForm(EMPTY_PLAN);
        setEditing('new');
    };

    const openEdit = (plan) => {
        setForm({
            key: plan.key,
            name: plan.name,
            description: plan.description || '',
            price_per_camera: plan.price_per_camera,
            max_cameras: plan.max_cameras,
            is_trial: plan.is_trial === 1,
            trial_days: plan.trial_days ?? '',
        });
        setEditing(plan);
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm({ ...form, [name]: type === 'checkbox' ? checked : value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const payload = {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            price_per_camera: parseInt(form.price_per_camera, 10),
            max_cameras: parseInt(form.max_cameras, 10),
            is_trial: !!form.is_trial,
            trial_days: form.is_trial ? parseInt(form.trial_days, 10) : null,
        };
        const ok = editing === 'new'
            ? await run(() => billingAdminService.createPlan({ ...payload, key: form.key.trim().toLowerCase() }), 'Paket dibuat')
            : await run(() => billingAdminService.updatePlan(editing.id, payload), 'Paket diperbarui');
        if (ok) setEditing(null);
    };

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Katalog Paket</h3>
                    <button
                        onClick={openNew}
                        className="rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600"
                    >
                        + Paket Baru
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                                <th className="px-3 py-2">Paket</th>
                                <th className="px-3 py-2 text-right">Harga/kamera</th>
                                <th className="px-3 py-2 text-center">Maks kamera</th>
                                <th className="px-3 py-2 text-center">Trial</th>
                                <th className="px-3 py-2 text-center">Status</th>
                                <th className="px-3 py-2 text-right">Aksi</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                            {plans.map((plan) => (
                                <tr key={plan.id} className="bg-white dark:bg-gray-900">
                                    <td className="px-3 py-2">
                                        <p className="font-medium text-gray-900 dark:text-white">{plan.name}</p>
                                        <p className="text-xs text-gray-400">{plan.key}</p>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        {plan.is_trial === 1 ? 'Gratis' : formatRupiah(plan.price_per_camera)}
                                    </td>
                                    <td className="px-3 py-2 text-center">{plan.max_cameras}</td>
                                    <td className="px-3 py-2 text-center">
                                        {plan.is_trial === 1 ? `${plan.trial_days} hari` : '—'}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${plan.active === 1
                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                        }`}>
                                            {plan.active === 1 ? 'Aktif' : 'Nonaktif'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <div className="flex justify-end gap-1">
                                            <button
                                                onClick={() => openEdit(plan)}
                                                disabled={busy}
                                                className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                                            >
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => run(
                                                    () => billingAdminService.updatePlan(plan.id, { active: plan.active !== 1 }),
                                                    plan.active === 1 ? 'Paket dinonaktifkan' : 'Paket diaktifkan'
                                                )}
                                                disabled={busy}
                                                className="rounded-lg px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800"
                                            >
                                                {plan.active === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="space-y-4">
                <div className={cardClass}>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Registrasi Mandiri</h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Pelanggan baru daftar sendiri lewat halaman <code>/daftar</code>.
                    </p>
                    <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <input
                            type="checkbox"
                            checked={!!regSettings?.enabled}
                            disabled={busy}
                            onChange={(e) => run(
                                () => billingAdminService.updateRegistrationSettings({ enabled: e.target.checked }),
                                'Pengaturan registrasi disimpan'
                            )}
                        />
                        Izinkan pendaftaran mandiri
                    </label>
                    <label className="mt-3 block text-sm text-gray-700 dark:text-gray-300">
                        Paket default pendaftar baru
                        <select
                            value={regSettings?.default_plan_key || ''}
                            disabled={busy}
                            onChange={(e) => run(
                                () => billingAdminService.updateRegistrationSettings({ default_plan_key: e.target.value }),
                                'Paket default disimpan'
                            )}
                            className={`mt-1 ${inputClass}`}
                        >
                            {plans.map((plan) => (
                                <option key={plan.id} value={plan.key}>
                                    {plan.name}{plan.is_trial === 1 ? ` (trial ${plan.trial_days} hari)` : ''}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                {editing !== null && (
                    <form onSubmit={handleSubmit} className={cardClass}>
                        <h3 className="font-semibold text-gray-900 dark:text-white">
                            {editing === 'new' ? 'Paket Baru' : `Edit Paket: ${editing.name}`}
                        </h3>
                        <div className="mt-3 space-y-2">
                            {editing === 'new' && (
                                <input name="key" value={form.key} onChange={handleChange} required pattern="[a-z0-9_-]{2,40}" className={inputClass} placeholder="key unik (mis. premium)" />
                            )}
                            <input name="name" value={form.name} onChange={handleChange} required minLength={2} className={inputClass} placeholder="Nama paket" />
                            <input name="description" value={form.description} onChange={handleChange} className={inputClass} placeholder="Deskripsi singkat (opsional)" />
                            <label className="block text-xs text-gray-500 dark:text-gray-400">
                                Harga per kamera per bulan (rupiah)
                                <input name="price_per_camera" type="number" min="0" step="1000" value={form.price_per_camera} onChange={handleChange} required className={`mt-1 ${inputClass}`} />
                            </label>
                            <label className="block text-xs text-gray-500 dark:text-gray-400">
                                Maksimal kamera
                                <input name="max_cameras" type="number" min="1" max="100" value={form.max_cameras} onChange={handleChange} required className={`mt-1 ${inputClass}`} />
                            </label>
                            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                                <input name="is_trial" type="checkbox" checked={form.is_trial} onChange={handleChange} />
                                Paket trial (gratis, berbatas waktu)
                            </label>
                            {form.is_trial && (
                                <label className="block text-xs text-gray-500 dark:text-gray-400">
                                    Durasi trial (hari)
                                    <input name="trial_days" type="number" min="1" max="90" value={form.trial_days} onChange={handleChange} required className={`mt-1 ${inputClass}`} />
                                </label>
                            )}
                            <div className="flex gap-2 pt-1">
                                <button type="button" onClick={() => setEditing(null)} disabled={busy} className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                                    Batal
                                </button>
                                <button type="submit" disabled={busy} className="flex-[2] rounded-xl bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50">
                                    Simpan
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
