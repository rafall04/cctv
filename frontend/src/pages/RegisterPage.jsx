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
import { useBranding } from '../contexts/BrandingContext';
import { setPageTitle } from '../utils/pageTitle.js';

const inputClass = 'w-full px-4 py-2.5 bg-surface-sunken border border-edge rounded-xl text-content focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary';

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
    /*
     * Every page kept the landing page's title, so a browser tab, a bookmark and a shared link all
     * said "CCTV Publik Online" regardless of where the visitor actually was. AreaPublicPage already
     * set its own; this is the same idea, nothing more.
     */
    useEffect(() => setPageTitle('Daftar Sewa CCTV - RAF'), []);
    const { branding } = useBranding();
    /*
     * Built here rather than via buildWhatsappLink: that helper renders the branding-wide template,
     * which cannot carry the one thing this message exists to deliver — the username the admin has
     * to look up. Empty when no number is configured, and the button is then not rendered at all;
     * a dead wa.me link would be worse than no button.
     */
    const adminWhatsapp = String(branding?.whatsapp_number || '').trim();
    const verificationLink = adminWhatsapp
        ? `https://wa.me/${adminWhatsapp}?text=${encodeURIComponent(
            `Halo Admin, saya baru mendaftar akun sewa CCTV dengan username "${form.username}". Mohon dibantu verifikasi ya.`)}`
        : '';
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
        <div className="flex min-h-screen items-center justify-center bg-surface-sunken px-4 py-8">
            <div className="w-full max-w-md">
                <div className="rounded-2xl border border-edge bg-surface p-6 shadow-e2">
                    <h1 className="text-xl font-bold text-content">Daftar Sewa CCTV</h1>

                    {submitted ? (
                        <div className="mt-4 space-y-3 text-center">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-surface-sunken text-2xl">⏳</div>
                            <h2 className="font-semibold text-content">Pendaftaran terkirim!</h2>
                            <p className="text-sm text-content-muted">
                                Akun Anda <b>menunggu persetujuan admin</b>. Anda akan bisa login setelah disetujui
                                {plan?.is_trial ? <> — dan masa trial {plan.trial_days} hari baru mulai dihitung saat akun disetujui</> : null}.
                            </p>
                            {/*
                              * WhatsApp is the PRIMARY action, and deliberately a button rather than
                              * an automatic redirect: a forced jump would carry the visitor off this
                              * page before they had read that approval is pending, and window.open
                              * outside a click is blocked by most mobile browsers anyway. The message
                              * is pre-filled with the username so the admin can find the row at once,
                              * which is the whole point of asking them to send it.
                              */}
                            {verificationLink && (
                            <a
                                href={verificationLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600"
                            >
                                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884" />
                                </svg>
                                Minta verifikasi ke admin
                            </a>
                            )}
                            <Link to="/admin/login" className="inline-block text-sm text-content-muted underline-offset-2 hover:underline">
                                Nanti saja, ke halaman login
                            </Link>
                        </div>
                    ) : infoLoading ? (
                        <p className="mt-4 text-sm text-content-muted">Memuat…</p>
                    ) : !info?.enabled ? (
                        <div className="mt-4 rounded-xl border border-status-warn/40 bg-surface-sunken p-4 text-sm text-content">
                            Pendaftaran mandiri sedang ditutup. Silakan hubungi admin untuk berlangganan.
                        </div>
                    ) : (
                        <>
                            <div className="mt-3 rounded-xl border border-edge bg-surface-sunken p-3 text-xs text-content-muted">
                                ℹ️ Pendaftaran perlu <b>persetujuan admin</b> sebelum bisa login.
                            </div>
                            {plan && (
                                <div className="mt-3 rounded-xl border border-status-live/40 bg-surface-sunken p-3 text-sm text-content">
                                    {plan.is_trial ? (
                                        <>🎁 Akun baru langsung dapat <b>{plan.name}</b> — gratis {plan.trial_days} hari, hingga {plan.max_cameras} kamera.</>
                                    ) : (
                                        <>Paket awal: <b>{plan.name}</b> — {formatRupiah(plan.price_per_camera)}/kamera/bulan, hingga {plan.max_cameras} kamera.</>
                                    )}
                                </div>
                            )}
                            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
                                <div>
                                    <label htmlFor="reg-username" className="mb-1.5 block text-sm font-medium text-content-muted">Username</label>
                                    <input id="reg-username" name="username" autoComplete="username" value={form.username} onChange={handleChange} required minLength={3} maxLength={50} pattern="[a-zA-Z0-9_\-]+" className={inputClass} placeholder="nama_warung" />
                                </div>
                                <div>
                                    <label htmlFor="reg-phone" className="mb-1.5 block text-sm font-medium text-content-muted">No. HP (WhatsApp)</label>
                                    <input id="reg-phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" value={form.phone} onChange={handleChange} required className={inputClass} placeholder="081234567890" />
                                </div>
                                <div>
                                    <label htmlFor="reg-email" className="mb-1.5 block text-sm font-medium text-content-muted">Email (opsional)</label>
                                    <input id="reg-email" name="email" type="email" autoComplete="email" value={form.email} onChange={handleChange} className={inputClass} placeholder="anda@email.com" />
                                </div>
                                <div>
                                    <label htmlFor="reg-password" className="mb-1.5 block text-sm font-medium text-content-muted">Password</label>
                                    <input id="reg-password" name="password" type="password" autoComplete="new-password" value={form.password} onChange={handleChange} required minLength={12} className={inputClass} placeholder="Minimal 12 karakter" />
                                    {pwdRequirements.length > 0 && (
                                        <ul className="mt-1.5 space-y-0.5 text-xs text-content-subtle">
                                            {pwdRequirements.map((r) => (<li key={r}>• {r}</li>))}
                                        </ul>
                                    )}
                                </div>
                                <div>
                                    <label htmlFor="reg-confirm" className="mb-1.5 block text-sm font-medium text-content-muted">Ulangi Password</label>
                                    <input id="reg-confirm" name="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={handleChange} required className={inputClass} />
                                </div>

                                {error && (
                                    <div role="alert" className="rounded-xl border border-status-fault/50 bg-surface-sunken p-3 text-sm text-status-fault">
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

                    <p className="mt-4 text-center text-sm text-content-muted">
                        Sudah punya akun?{' '}
                        <Link to="/admin/login" className="font-semibold text-primary hover:underline">Masuk</Link>
                    </p>
                </div>
            </div>
        </div>
    );
}
