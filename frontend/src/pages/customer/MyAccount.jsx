/*
 * Purpose: Customer "Akun Saya" page — manage own profile (username/phone/email) and change
 *          password. Uses the existing auth-required, customer-safe endpoints:
 *          GET/PUT /api/users/profile (only username/phone/email — never role/plan/balance)
 *          and PUT /api/users/profile/password (verifies current password, invalidates sessions).
 * Caller: App.jsx /my/akun route inside CustomerLayout.
 * Deps: userService (profile + password), authService (logout after password change).
 * MainFuncs: MyAccount.
 * SideEffects: Updates the user's own row; a password change ends the session → re-login.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import userService from '../../services/userService';
import { authService } from '../../services/authService';

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900';
const inputClass = 'w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary dark:border-gray-700 dark:bg-gray-900/50 dark:text-white';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

function Msg({ msg }) {
    if (!msg) return null;
    const ok = msg.type === 'ok';
    return (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${ok
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300'
            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
        }`}>
            {msg.text}
        </p>
    );
}

export default function MyAccount() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);

    const [form, setForm] = useState({ username: '', phone: '', email: '' });
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileMsg, setProfileMsg] = useState(null);

    const [pwd, setPwd] = useState({ current_password: '', new_password: '', confirm: '' });
    const [savingPwd, setSavingPwd] = useState(false);
    const [pwdMsg, setPwdMsg] = useState(null);
    const [requirements, setRequirements] = useState([]);

    const load = useCallback(async () => {
        try {
            const res = await userService.getProfile();
            if (res.success) {
                setProfile(res.data);
                setForm({
                    username: res.data.username || '',
                    phone: res.data.phone || '',
                    email: res.data.email || '',
                });
            }
        } catch {
            // error surfaced on the next save attempt; page stays usable
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        userService.getPasswordRequirements?.()
            .then((r) => { if (r?.success) setRequirements(r.data?.requirements || []); })
            .catch(() => {});
    }, []);

    const dirty = profile && (
        form.username !== (profile.username || '') ||
        form.phone !== (profile.phone || '') ||
        form.email !== (profile.email || '')
    );

    const submitProfile = async (e) => {
        e.preventDefault();
        setProfileMsg(null);
        if (!form.username.trim() || form.username.trim().length < 3) {
            setProfileMsg({ type: 'error', text: 'Username minimal 3 karakter.' });
            return;
        }
        setSavingProfile(true);
        try {
            const res = await userService.updateProfile({
                username: form.username.trim(),
                phone: form.phone.trim(),
                email: form.email.trim(),
            });
            if (res.success) {
                setProfileMsg({ type: 'ok', text: 'Profil berhasil diperbarui.' });
                await load();
            } else {
                setProfileMsg({ type: 'error', text: res.message || 'Gagal memperbarui profil' });
            }
        } catch (err) {
            setProfileMsg({ type: 'error', text: err.response?.data?.message || 'Gagal memperbarui profil' });
        } finally {
            setSavingProfile(false);
        }
    };

    const submitPassword = async (e) => {
        e.preventDefault();
        setPwdMsg(null);
        if (!pwd.current_password || !pwd.new_password) {
            setPwdMsg({ type: 'error', text: 'Isi password lama dan password baru.' });
            return;
        }
        if (pwd.new_password !== pwd.confirm) {
            setPwdMsg({ type: 'error', text: 'Konfirmasi password baru tidak cocok.' });
            return;
        }
        setSavingPwd(true);
        try {
            const res = await userService.changeOwnPassword(pwd.current_password, pwd.new_password);
            if (res.success) {
                setPwdMsg({ type: 'ok', text: 'Password berhasil diubah. Anda akan diminta login ulang…' });
                setPwd({ current_password: '', new_password: '', confirm: '' });
                // The server invalidates all sessions on a password change → force re-login.
                setTimeout(async () => {
                    try { await authService.logout(); } catch { /* ignore */ }
                    navigate('/admin/login');
                }, 1800);
            } else {
                setPwdMsg({ type: 'error', text: res.message || 'Gagal mengubah password' });
            }
        } catch (err) {
            const data = err.response?.data;
            const text = Array.isArray(data?.errors) && data.errors.length
                ? data.errors.join(' ')
                : (data?.message || 'Gagal mengubah password');
            setPwdMsg({ type: 'error', text });
        } finally {
            setSavingPwd(false);
        }
    };

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat akun…</div>;
    }

    const memberSince = profile?.created_at ? String(profile.created_at).slice(0, 10) : '—';
    const pwdChanged = profile?.password_changed_at ? String(profile.password_changed_at).replace('T', ' ').slice(0, 16) : null;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Profil */}
            <form onSubmit={submitProfile} className={cardClass}>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Profil Akun</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Data kontak akun Anda.</p>
                <div className="mt-4 space-y-3">
                    <div>
                        <label htmlFor="acc-username" className={labelClass}>Username <span className="font-normal text-gray-400">(untuk login)</span></label>
                        <input id="acc-username" value={form.username} onChange={(e) => { setForm({ ...form, username: e.target.value }); setProfileMsg(null); }} minLength={3} maxLength={50} className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="acc-phone" className={labelClass}>Nomor HP / WhatsApp</label>
                        <input id="acc-phone" value={form.phone} onChange={(e) => { setForm({ ...form, phone: e.target.value }); setProfileMsg(null); }} maxLength={20} inputMode="tel" placeholder="08xxxxxxxxxx" className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="acc-email" className={labelClass}>Email</label>
                        <input id="acc-email" type="email" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setProfileMsg(null); }} maxLength={120} placeholder="nama@email.com" className={inputClass} />
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Dipakai untuk notifikasi &amp; verifikasi pembayaran. Pastikan email valid &amp; aktif.</p>
                    </div>
                </div>
                <Msg msg={profileMsg} />
                <button type="submit" disabled={savingProfile || !dirty} className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50">
                    {savingProfile ? 'Menyimpan…' : 'Simpan Profil'}
                </button>
            </form>

            {/* Ubah Password */}
            <form onSubmit={submitPassword} className={cardClass}>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Ubah Password</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Demi keamanan, masukkan password lama untuk konfirmasi.</p>
                <div className="mt-4 space-y-3">
                    <div>
                        <label htmlFor="acc-curpwd" className={labelClass}>Password lama</label>
                        <input id="acc-curpwd" type="password" autoComplete="current-password" value={pwd.current_password} onChange={(e) => { setPwd({ ...pwd, current_password: e.target.value }); setPwdMsg(null); }} className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="acc-newpwd" className={labelClass}>Password baru</label>
                        <input id="acc-newpwd" type="password" autoComplete="new-password" value={pwd.new_password} onChange={(e) => { setPwd({ ...pwd, new_password: e.target.value }); setPwdMsg(null); }} className={inputClass} />
                    </div>
                    <div>
                        <label htmlFor="acc-confpwd" className={labelClass}>Ulangi password baru</label>
                        <input id="acc-confpwd" type="password" autoComplete="new-password" value={pwd.confirm} onChange={(e) => { setPwd({ ...pwd, confirm: e.target.value }); setPwdMsg(null); }} className={inputClass} />
                    </div>
                </div>
                {requirements.length > 0 && (
                    <ul className="mt-3 space-y-0.5 rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
                        <li className="font-medium text-gray-600 dark:text-gray-300">Syarat password baru:</li>
                        {requirements.map((r) => (<li key={r}>• {r}</li>))}
                    </ul>
                )}
                <Msg msg={pwdMsg} />
                <button type="submit" disabled={savingPwd} className="mt-4 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-50">
                    {savingPwd ? 'Menyimpan…' : 'Ubah Password'}
                </button>
            </form>

            {/* Informasi akun */}
            <div className={`${cardClass} lg:col-span-2`}>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Informasi Akun</h2>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                    <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Jenis akun</dt>
                        <dd className="mt-0.5 font-medium text-gray-900 dark:text-white">Pelanggan</dd>
                    </div>
                    <div>
                        <dt className="text-xs text-gray-500 dark:text-gray-400">Bergabung sejak</dt>
                        <dd className="mt-0.5 font-medium text-gray-900 dark:text-white">{memberSince}</dd>
                    </div>
                    {pwdChanged && (
                        <div>
                            <dt className="text-xs text-gray-500 dark:text-gray-400">Password diubah</dt>
                            <dd className="mt-0.5 font-medium text-gray-900 dark:text-white">{pwdChanged}</dd>
                        </div>
                    )}
                </dl>
                <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                    Ingin berhenti berlangganan atau menghapus akun? Hubungi admin RAF NET — langganan &amp; sisa saldo perlu diproses dulu.
                </p>
            </div>
        </div>
    );
}
