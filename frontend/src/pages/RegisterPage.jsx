/*
 * Purpose: Public customer self-registration page (/daftar) — creates a customer account on
 *          the admin-configured default plan (e.g. free trial) then auto-logs-in to /my.
 * Caller: App.jsx public route.
 * Deps: authService (registerInfo/register/login), react-router.
 * MainFuncs: RegisterPage.
 * SideEffects: Creates the account + session via API.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../services/authService';
import userService from '../services/userService';

const inputClass = 'w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';

function formatRupiah(value) {
    return `Rp${Number(value || 0).toLocaleString('id-ID')}`;
}

export default function RegisterPage() {
    const [info, setInfo] = useState(null);
    const [infoLoading, setInfoLoading] = useState(true);
    const [form, setForm] = useState({ username: '', password: '', confirm: '', phone: '', email: '' });
    const [error, setError] = useState('');
    const [errorList, setErrorList] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [pwdRequirements, setPwdRequirements] = useState([]);

    useEffect(() => {
        let isMounted = true;
        authService.registerInfo().then((response) => {
            if (isMounted) {
                setInfo(response.data || { enabled: false });
                setInfoLoading(false);
            }
        });
        // Show the password policy up front (public endpoint) so users don't
        // discover the rules only after a rejected submit. Backend still
        // validates on submit; this list is a nice-to-have if the fetch fails.
        userService.getPasswordRequirements()
            .then((r) => { if (isMounted && r?.success) setPwdRequirements(r.data?.requirements || []); })
            .catch(() => {});
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

        // Approval-gated: the account is created 'pending' and CANNOT log in until an
        // admin approves it, so there is no auto-login — show a confirmation instead.
        setSubmitted(true);
        setSubmitting(false);
    };

    const plan = info?.default_plan;

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4 py-8 dark:bg-gray-950">
            <div className="w-full max-w-md">
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900">
                    <h1 className="text-xl font-bold text-gray-900 dark:text-white">Daftar Sewa CCTV</h1>

                    {submitted ? (
                        <div className="mt-4 space-y-3 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-900/40">⏳</div>
                            <h2 className="font-semibold text-gray-900 dark:text-white">Pendaftaran terkirim!</h2>
                            <p className="text-sm text-gray-600 dark:text-gray-300">
                                Akun Anda <b>menunggu persetujuan admin</b>. Anda akan bisa login setelah disetujui
                                {plan?.is_trial ? <> — dan masa trial {plan.trial_days} hari baru mulai dihitung saat akun disetujui</> : null}.
                            </p>
                            <Link to="/admin/login" className="inline-block rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-600">
                                Ke halaman login
                            </Link>
                        </div>
                    ) : infoLoading ? (
                        <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">Memuat…</p>
                    ) : !info?.enabled ? (
                        <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                            Pendaftaran mandiri sedang ditutup. Silakan hubungi admin untuk berlangganan.
                        </div>
                    ) : (
                        <>
                            <div className="mt-3 rounded-xl bg-sky-50 p-3 text-xs text-sky-800 dark:bg-sky-900/30 dark:text-sky-200">
                                ℹ️ Pendaftaran perlu <b>persetujuan admin</b> sebelum bisa login.
                            </div>
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
                                    {pwdRequirements.length > 0 && (
                                        <ul className="mt-1.5 space-y-0.5 text-xs text-gray-500 dark:text-gray-400">
                                            {pwdRequirements.map((r) => (<li key={r}>• {r}</li>))}
                                        </ul>
                                    )}
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
