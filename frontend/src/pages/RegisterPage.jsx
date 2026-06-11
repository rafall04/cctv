/*
 * Purpose: Public customer self-registration page (/daftar) — creates a customer account on
 *          the admin-configured default plan (e.g. free trial) then auto-logs-in to /my.
 * Caller: App.jsx public route.
 * Deps: authService (registerInfo/register/login), react-router.
 * MainFuncs: RegisterPage.
 * SideEffects: Creates the account + session via API.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';

const inputClass = 'w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';

function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

export default function RegisterPage() {
    const navigate = useNavigate();
    const [info, setInfo] = useState(null);
    const [infoLoading, setInfoLoading] = useState(true);
    const [form, setForm] = useState({ username: '', password: '', confirm: '', phone: '', email: '' });
    const [error, setError] = useState('');
    const [errorList, setErrorList] = useState([]);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let isMounted = true;
        authService.registerInfo().then((response) => {
            if (isMounted) {
                setInfo(response.data || { enabled: false });
                setInfoLoading(false);
            }
        });
        return () => { isMounted = false; };
    }, []);

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
        setError('');
        setErrorList([]);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (form.password !== form.confirm) {
            setError('Konfirmasi password tidak sama');
            return;
        }
        setSubmitting(true);
        setError('');
        setErrorList([]);

        const result = await authService.register({
            username: form.username.trim(),
            password: form.password,
            phone: form.phone.trim(),
            email: form.email.trim() || undefined,
        });

        if (!result.success) {
            setError(result.message || 'Pendaftaran gagal');
            setErrorList(Array.isArray(result.errors) ? result.errors : []);
            setSubmitting(false);
            return;
        }

        // Auto-login through the normal flow (lockout/fingerprint/cookies intact).
        const login = await authService.login(form.username.trim(), form.password);
        if (login.success) {
            navigate('/my');
        } else {
            navigate('/admin/login');
        }
    };

    const plan = info?.default_plan;

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-8 dark:bg-gray-950">
            <div className="w-full max-w-md">
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Daftar Sewa CCTV</h1>

                    {infoLoading ? (
                        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Memuat…</p>
                    ) : !info?.enabled ? (
                        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                            Pendaftaran mandiri sedang ditutup. Silakan hubungi admin untuk berlangganan.
                        </div>
                    ) : (
                        <>
                            {plan && (
                                <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                                    {plan.is_trial ? (
                                        <>🎁 Akun baru langsung dapat <b>{plan.name}</b> — gratis {plan.trial_days} hari, hingga {plan.max_cameras} kamera.</>
                                    ) : (
                                        <>Paket awal: <b>{plan.name}</b> — {formatRupiah(plan.price_per_camera)}/kamera/bulan, hingga {plan.max_cameras} kamera.</>
                                    )}
                                </div>
                            )}
                            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                                <div>
                                    <label htmlFor="reg-username" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
                                    <input id="reg-username" name="username" value={form.username} onChange={handleChange} required minLength={3} maxLength={50} pattern="[a-zA-Z0-9_-]+" className={inputClass} placeholder="nama_warung" />
                                </div>
                                <div>
                                    <label htmlFor="reg-phone" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">No. HP (WhatsApp)</label>
                                    <input id="reg-phone" name="phone" value={form.phone} onChange={handleChange} required className={inputClass} placeholder="081234567890" />
                                </div>
                                <div>
                                    <label htmlFor="reg-email" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Email (opsional)</label>
                                    <input id="reg-email" name="email" type="email" value={form.email} onChange={handleChange} className={inputClass} placeholder="anda@email.com" />
                                </div>
                                <div>
                                    <label htmlFor="reg-password" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                                    <input id="reg-password" name="password" type="password" value={form.password} onChange={handleChange} required minLength={12} className={inputClass} placeholder="Minimal 12 karakter" />
                                </div>
                                <div>
                                    <label htmlFor="reg-confirm" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Ulangi Password</label>
                                    <input id="reg-confirm" name="confirm" type="password" value={form.confirm} onChange={handleChange} required className={inputClass} />
                                </div>

                                {error && (
                                    <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                                        {error}
                                        {errorList.length > 0 && (
                                            <ul className="mt-1 list-inside list-disc text-xs">
                                                {errorList.map((item) => <li key={item}>{item}</li>)}
                                            </ul>
                                        )}
                                    </div>
                                )}

                                <button type="submit" disabled={submitting} className="w-full rounded-xl bg-primary px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-60">
                                    {submitting ? 'Mendaftarkan…' : 'Daftar Sekarang'}
                                </button>
                            </form>
                        </>
                    )}

                    <p className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                        Sudah punya akun?{' '}
                        <Link to="/admin/login" className="font-semibold text-primary hover:underline">Masuk</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
