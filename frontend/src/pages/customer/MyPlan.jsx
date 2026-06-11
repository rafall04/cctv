/*
 * Purpose: Customer "Paket" page — current plan + usage, trial countdown, and self-service
 *          plan switching (upgrade/downgrade within camera-count rules enforced server-side).
 * Caller: App.jsx /my/paket route inside CustomerLayout.
 * Deps: customerService, formatRupiah.
 * MainFuncs: MyPlan.
 * SideEffects: Fetches plan state; switching plans may charge today's fee at the new price.
 */

import { useCallback, useEffect, useState } from 'react';
import customerService from '../../services/customerService';
import { formatRupiah } from '../../layouts/CustomerLayout';

function trialDaysLeft(trialEndsAt) {
    if (!trialEndsAt) return null;
    const ms = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
}

export default function MyPlan() {
    const [state, setState] = useState(null);
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyKey, setBusyKey] = useState(null);
    const [message, setMessage] = useState(null);

    const reload = useCallback(async () => {
        try {
            const [stateRes, plansRes] = await Promise.all([
                customerService.getPlan(),
                customerService.getPlans(),
            ]);
            if (stateRes.success) setState(stateRes.data);
            if (plansRes.success) setPlans(plansRes.data || []);
        } catch {
            setMessage({ type: 'error', text: 'Gagal memuat paket. Muat ulang halaman.' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    const handleSwitch = async (plan) => {
        if (!window.confirm(`Pindah ke paket ${plan.name}? Harga semua kamera Anda menyesuaikan (${formatRupiah(plan.price_per_camera)}/kamera/bulan) dan biaya hari ini langsung dipotong dari saldo.`)) {
            return;
        }
        setBusyKey(plan.key);
        setMessage(null);
        try {
            const response = await customerService.switchPlan(plan.key);
            if (response.success) {
                setMessage({ type: 'ok', text: `Berhasil pindah ke paket ${plan.name}.` });
                await reload();
            } else {
                setMessage({ type: 'error', text: response.message || 'Gagal mengubah paket' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: error.response?.data?.message || 'Gagal mengubah paket' });
        } finally {
            setBusyKey(null);
        }
    };

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat paket…</div>;
    }

    const current = state?.plan;
    const daysLeft = state?.trial_active ? trialDaysLeft(state.trial_ends_at) : null;

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="font-semibold text-gray-900 dark:text-white">Paket Saya</h2>
                {current ? (
                    <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                        <span className="text-lg font-bold text-gray-900 dark:text-white">{current.name}</span>
                        <span>{current.is_trial ? 'Gratis (trial)' : `${formatRupiah(current.price_per_camera)}/kamera/bulan`}</span>
                        <span>Kamera: {state.used_cameras}/{state.max_cameras}</span>
                        {state.trial_active && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                Trial — sisa {daysLeft} hari
                            </span>
                        )}
                        {state.trial_expired && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Trial berakhir — pilih paket berbayar agar kamera aktif lagi
                            </span>
                        )}
                    </div>
                ) : (
                    <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                        Belum punya paket — pilih salah satu paket di bawah untuk mulai.
                    </p>
                )}
            </div>

            {message && (
                <div className={`rounded-xl px-4 py-3 text-sm ${message.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                }`}>
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((plan) => {
                    const isCurrent = current?.id === plan.id;
                    const trialBlocked = plan.is_trial === 1 && state?.trial_used && !isCurrent;
                    return (
                        <div
                            key={plan.id}
                            className={`rounded-2xl border bg-white p-4 dark:bg-gray-900 ${isCurrent
                                ? 'border-primary ring-1 ring-primary'
                                : 'border-gray-200 dark:border-gray-800'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-gray-900 dark:text-white">{plan.name}</h3>
                                {isCurrent && (
                                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">Aktif</span>
                                )}
                            </div>
                            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                                {plan.is_trial === 1 ? 'Gratis' : formatRupiah(plan.price_per_camera)}
                                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                                    {plan.is_trial === 1 ? ` / ${plan.trial_days} hari` : '/kamera/bulan'}
                                </span>
                            </p>
                            <ul className="mt-2 space-y-1 text-sm text-gray-600 dark:text-gray-300">
                                <li>✓ Maks. {plan.max_cameras} kamera</li>
                                <li>✓ Live streaming 24 jam</li>
                                {plan.description && <li>✓ {plan.description}</li>}
                            </ul>
                            <button
                                onClick={() => handleSwitch(plan)}
                                disabled={isCurrent || trialBlocked || busyKey !== null}
                                className={`mt-3 w-full rounded-xl px-4 py-2 text-sm font-medium transition-colors ${isCurrent || trialBlocked
                                    ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
                                    : 'bg-primary text-white hover:bg-primary-600'
                                } disabled:opacity-70`}
                            >
                                {isCurrent ? 'Paket Aktif' : trialBlocked ? 'Trial sudah dipakai' : (busyKey === plan.key ? 'Memproses…' : 'Pilih Paket Ini')}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
