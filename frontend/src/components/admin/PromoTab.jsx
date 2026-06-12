/*
 * Purpose: Admin "Promo" tab — CRUD for promo codes (top-up bonus percent/flat + gift credit),
 *          with quota/per-user limits, expiry, and active toggle. Self-fetches its data.
 * Caller: pages/BillingManagement.jsx.
 * Deps: billingAdminService, useNotification.
 * MainFuncs: PromoTab.
 * SideEffects: Loads + mutates promo codes via billingAdminService.
 */

import { useCallback, useEffect, useState } from 'react';
import billingAdminService from '../../services/billingAdminService';
import { useNotification } from '../../contexts/NotificationContext';

const inputClass = 'w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';
const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4';

const EMPTY = { code: '', type: 'percent', value: 10, max_bonus: '', min_topup: 0, max_uses: '', per_user_limit: 1, expires_at: '', description: '' };

const rupiah = (v) => `Rp${Number(v || 0).toLocaleString('id-ID')}`;

function promoValueLabel(p) {
    if (p.type === 'percent') return `${p.value}% bonus${p.max_bonus ? ` (maks ${rupiah(p.max_bonus)})` : ''}`;
    if (p.type === 'flat') return `${rupiah(p.value)} bonus`;
    return `${rupiah(p.value)} hadiah`;
}

export default function PromoTab() {
    const { success, error: showError } = useNotification();
    const [promos, setPromos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [form, setForm] = useState(EMPTY);
    const [showForm, setShowForm] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await billingAdminService.getPromos();
            if (res.success) setPromos(res.data || []);
        } catch {
            showError('Gagal memuat', 'Daftar promo tidak dapat dimuat.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        load();
    }, [load]);

    const run = async (fn, okMsg) => {
        setBusy(true);
        try {
            const res = await fn();
            if (res.success) {
                success('Berhasil', okMsg);
                await load();
                return true;
            }
            showError('Gagal', res.message || 'Operasi gagal');
            return false;
        } catch (err) {
            showError('Gagal', err.response?.data?.message || 'Operasi gagal');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm((f) => ({ ...f, [name]: value }));
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        const payload = {
            code: form.code.trim(),
            type: form.type,
            value: parseInt(form.value, 10),
            max_bonus: form.type === 'percent' && form.max_bonus ? parseInt(form.max_bonus, 10) : null,
            min_topup: form.type !== 'gift' ? (parseInt(form.min_topup, 10) || 0) : 0,
            max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
            per_user_limit: parseInt(form.per_user_limit, 10) || 1,
            expires_at: form.expires_at || null,
            description: form.description.trim() || undefined,
        };
        const ok = await run(() => billingAdminService.createPromo(payload), 'Kode promo dibuat');
        if (ok) { setForm(EMPTY); setShowForm(false); }
    };

    const toggleActive = (p) => run(
        () => billingAdminService.updatePromo(p.id, { active: p.active !== 1 }),
        p.active === 1 ? 'Promo dinonaktifkan' : 'Promo diaktifkan'
    );

    const remove = (p) => {
        if (window.confirm(`Hapus kode promo "${p.code}"? Riwayat penukaran tetap tersimpan.`)) {
            run(() => billingAdminService.deletePromo(p.id), 'Promo dihapus');
        }
    };

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat promo…</div>;
    }

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-2">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Kode Promo</h3>
                    <button onClick={() => setShowForm((v) => !v)} className="rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-600">
                        {showForm ? 'Tutup' : '+ Kode Baru'}
                    </button>
                </div>

                {promos.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-12 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
                        Belum ada kode promo.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {promos.map((p) => (
                            <div key={p.id} className={`${cardClass} flex flex-wrap items-center gap-x-4 gap-y-2`}>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-semibold text-gray-900 dark:text-white">{p.code}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.active === 1 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                                            {p.active === 1 ? 'Aktif' : 'Nonaktif'}
                                        </span>
                                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">{p.type}</span>
                                    </div>
                                    <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-300">{promoValueLabel(p)}</p>
                                    <p className="text-xs text-gray-400">
                                        Terpakai {p.used_count}{p.max_uses ? `/${p.max_uses}` : ''} · maks {p.per_user_limit}/akun
                                        {p.min_topup > 0 ? ` · min top-up ${rupiah(p.min_topup)}` : ''}
                                        {p.expires_at ? ` · s/d ${String(p.expires_at).slice(0, 10)}` : ''}
                                    </p>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={() => toggleActive(p)} disabled={busy} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                                        {p.active === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                                    </button>
                                    <button onClick={() => remove(p)} disabled={busy} className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-900/30">
                                        Hapus
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showForm && (
                <form onSubmit={handleCreate} className={`${cardClass} space-y-2`}>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Kode Promo Baru</h3>
                    <input name="code" value={form.code} onChange={handleChange} required pattern="[A-Za-z0-9_-]{3,30}" className={`${inputClass} uppercase`} placeholder="KODE (mis. HEMAT10)" />
                    <label className="block text-xs text-gray-500 dark:text-gray-400">
                        Tipe
                        <select name="type" value={form.type} onChange={handleChange} className={`mt-1 ${inputClass}`}>
                            <option value="percent">Bonus persen saat top-up</option>
                            <option value="flat">Bonus flat saat top-up</option>
                            <option value="gift">Hadiah saldo (tukar langsung)</option>
                        </select>
                    </label>
                    <label className="block text-xs text-gray-500 dark:text-gray-400">
                        {form.type === 'percent' ? 'Persen bonus (1-100)' : form.type === 'flat' ? 'Bonus (rupiah)' : 'Saldo hadiah (rupiah)'}
                        <input name="value" type="number" min="1" value={form.value} onChange={handleChange} required className={`mt-1 ${inputClass}`} />
                    </label>
                    {form.type === 'percent' && (
                        <label className="block text-xs text-gray-500 dark:text-gray-400">
                            Maks bonus (rupiah, opsional)
                            <input name="max_bonus" type="number" min="0" value={form.max_bonus} onChange={handleChange} className={`mt-1 ${inputClass}`} placeholder="mis. 25000" />
                        </label>
                    )}
                    {form.type !== 'gift' && (
                        <label className="block text-xs text-gray-500 dark:text-gray-400">
                            Min top-up (rupiah)
                            <input name="min_topup" type="number" min="0" value={form.min_topup} onChange={handleChange} className={`mt-1 ${inputClass}`} />
                        </label>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-gray-500 dark:text-gray-400">
                            Kuota total (kosong = tak terbatas)
                            <input name="max_uses" type="number" min="1" value={form.max_uses} onChange={handleChange} className={`mt-1 ${inputClass}`} />
                        </label>
                        <label className="block text-xs text-gray-500 dark:text-gray-400">
                            Maks per akun
                            <input name="per_user_limit" type="number" min="1" value={form.per_user_limit} onChange={handleChange} className={`mt-1 ${inputClass}`} />
                        </label>
                    </div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400">
                        Kedaluwarsa (opsional)
                        <input name="expires_at" type="date" value={form.expires_at} onChange={handleChange} className={`mt-1 ${inputClass}`} />
                    </label>
                    <input name="description" value={form.description} onChange={handleChange} className={inputClass} placeholder="Deskripsi singkat (opsional)" />
                    <button type="submit" disabled={busy} className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50">
                        Buat Kode
                    </button>
                </form>
            )}
        </div>
    );
}
