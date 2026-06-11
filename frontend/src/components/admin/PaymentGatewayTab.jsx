/*
 * Purpose: Admin "Gateway Pembayaran" tab — configure the active payment gateway, iPaymu/Midtrans
 *          credentials, the enabled payment methods/banks, and run a read-only connection check,
 *          ALL from the admin page (no .env editing). Secrets are write-only (never shown back).
 * Caller: pages/BillingManagement.jsx.
 * Deps: billingAdminService, useNotification.
 * MainFuncs: PaymentGatewayTab.
 * SideEffects: Loads + persists gateway settings via billingAdminService.
 */

import { useCallback, useEffect, useState } from 'react';
import billingAdminService from '../../services/billingAdminService';
import { useNotification } from '../../contexts/NotificationContext';

const inputClass = 'w-full px-3 py-2 bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700/50 rounded-xl text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary';
const cardClass = 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-4';

export default function PaymentGatewayTab() {
    const { success, error: showError } = useNotification();
    const [view, setView] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);

    // Editable form state
    const [gateway, setGateway] = useState('manual');
    const [publicBaseUrl, setPublicBaseUrl] = useState('');
    const [ipaymuVa, setIpaymuVa] = useState('');
    const [ipaymuApiKey, setIpaymuApiKey] = useState(''); // blank = keep existing
    const [ipaymuProduction, setIpaymuProduction] = useState(false);
    const [methods, setMethods] = useState([]);
    const [midtransKey, setMidtransKey] = useState('');
    const [midtransProduction, setMidtransProduction] = useState(false);
    const [newMethod, setNewMethod] = useState({ method: '', channel: '', label: '' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await billingAdminService.getPaymentGateway();
            if (res.success) {
                const d = res.data;
                setView(d);
                setGateway(d.gateway);
                setPublicBaseUrl(d.public_base_url || '');
                setIpaymuVa(d.ipaymu.va || '');
                setIpaymuApiKey('');
                setIpaymuProduction(!!d.ipaymu.production);
                setMethods((d.ipaymu.methods || []).map((m) => ({ ...m })));
                setMidtransKey('');
                setMidtransProduction(!!d.midtrans.production);
            }
        } catch {
            showError('Gagal memuat', 'Pengaturan gateway tidak dapat dimuat.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        load();
    }, [load]);

    const toggleMethod = (idx) => {
        setMethods((prev) => prev.map((m, i) => (i === idx ? { ...m, enabled: !m.enabled } : m)));
    };
    const removeMethod = (idx) => {
        setMethods((prev) => prev.filter((_, i) => i !== idx));
    };
    const addMethod = () => {
        const method = newMethod.method.trim().toLowerCase();
        const channel = newMethod.channel.trim().toLowerCase();
        if (!/^[a-z0-9_]{2,20}$/.test(method) || !/^[a-z0-9_]{2,20}$/.test(channel)) {
            showError('Tidak valid', 'Method & channel hanya huruf kecil/angka/underscore (2-20).');
            return;
        }
        if (methods.some((m) => m.method === method && m.channel === channel)) {
            showError('Duplikat', 'Kombinasi method+channel sudah ada.');
            return;
        }
        setMethods((prev) => [...prev, { method, channel, label: newMethod.label.trim() || `${method.toUpperCase()} ${channel.toUpperCase()}`, enabled: true }]);
        setNewMethod({ method: '', channel: '', label: '' });
    };

    const handleSave = async () => {
        setSaving(true);
        setTestResult(null);
        try {
            const patch = {
                gateway,
                public_base_url: publicBaseUrl,
                ipaymu_va: ipaymuVa,
                ipaymu_production: ipaymuProduction,
                ipaymu_methods: methods,
                midtrans_production: midtransProduction,
            };
            // Only send secrets when the admin actually typed a new value.
            if (ipaymuApiKey.trim()) patch.ipaymu_api_key = ipaymuApiKey.trim();
            if (midtransKey.trim()) patch.midtrans_server_key = midtransKey.trim();

            const res = await billingAdminService.updatePaymentGateway(patch);
            if (res.success) {
                success('Tersimpan', 'Pengaturan gateway pembayaran disimpan.');
                await load();
            } else {
                showError('Gagal', res.message || 'Gagal menyimpan');
            }
        } catch (err) {
            showError('Gagal', err.response?.data?.message || 'Gagal menyimpan pengaturan.');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await billingAdminService.testPaymentGateway();
            setTestResult(res.data || { ok: false, message: 'Tidak ada respons.' });
        } catch (err) {
            setTestResult({ ok: false, message: err.response?.data?.message || 'Gagal menghubungi iPaymu.' });
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return <div className="py-16 text-center text-gray-500 dark:text-gray-400">Memuat pengaturan gateway…</div>;
    }

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
                <div className={cardClass}>
                    <h3 className="font-semibold text-gray-900 dark:text-white">Gateway Aktif</h3>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Semua konfigurasi di sini, tidak perlu edit file .env di server.
                    </p>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {(view?.supported_gateways || ['manual', 'midtrans', 'ipaymu']).map((g) => (
                            <button
                                key={g}
                                type="button"
                                onClick={() => setGateway(g)}
                                className={`rounded-xl border px-3 py-2 text-sm font-medium capitalize transition-colors ${gateway === g
                                    ? 'border-primary bg-primary text-white'
                                    : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                                }`}
                            >
                                {g === 'manual' ? 'Manual (konfirmasi admin)' : g}
                            </button>
                        ))}
                    </div>
                    <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">
                        Base URL publik (untuk callback/webhook)
                        <input value={publicBaseUrl} onChange={(e) => setPublicBaseUrl(e.target.value)} placeholder="https://cctv.domain.com" className={`mt-1 ${inputClass}`} />
                    </label>
                </div>

                {gateway === 'ipaymu' && (
                    <div className={cardClass}>
                        <h3 className="font-semibold text-gray-900 dark:text-white">Kredensial iPaymu</h3>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <label className="block text-xs text-gray-500 dark:text-gray-400">
                                VA / Kode Toko
                                <input value={ipaymuVa} onChange={(e) => setIpaymuVa(e.target.value)} placeholder="0000001234567890" className={`mt-1 ${inputClass}`} />
                            </label>
                            <label className="block text-xs text-gray-500 dark:text-gray-400">
                                API Key {view?.ipaymu?.api_key_set && <span className="text-emerald-600 dark:text-emerald-400">(tersimpan {view.ipaymu.api_key_hint})</span>}
                                <input type="password" value={ipaymuApiKey} onChange={(e) => setIpaymuApiKey(e.target.value)} placeholder={view?.ipaymu?.api_key_set ? 'Biarkan kosong = tidak diubah' : 'Masukkan API key'} className={`mt-1 ${inputClass}`} autoComplete="new-password" />
                            </label>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="checkbox" checked={ipaymuProduction} onChange={(e) => setIpaymuProduction(e.target.checked)} />
                            Mode Produksi (matikan untuk Sandbox/testing)
                        </label>
                        <div className="mt-3 flex items-center gap-3">
                            <button type="button" onClick={handleTest} disabled={testing} className="rounded-xl border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                                {testing ? 'Mengecek…' : 'Cek Saldo iPaymu'}
                            </button>
                            {testResult && (
                                <span className={`text-sm ${testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                    {testResult.ok ? `✓ ${testResult.message}${testResult.balance != null ? ` (saldo: Rp${Number(testResult.balance).toLocaleString('id-ID')})` : ''}` : `✗ ${testResult.message}`}
                                </span>
                            )}
                        </div>
                        <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">Simpan dulu sebelum mengecek agar memakai kredensial terbaru.</p>
                    </div>
                )}

                {gateway === 'ipaymu' && (
                    <div className={cardClass}>
                        <h3 className="font-semibold text-gray-900 dark:text-white">Metode & Bank Pembayaran</h3>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Aktifkan metode yang ingin ditawarkan ke pelanggan. Pastikan channel sudah aktif di akun iPaymu Anda.
                        </p>
                        <div className="mt-3 space-y-1">
                            {methods.map((m, idx) => (
                                <div key={`${m.method}:${m.channel}`} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2 py-1.5 dark:border-gray-800">
                                    <input type="checkbox" checked={m.enabled} onChange={() => toggleMethod(idx)} />
                                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200">{m.label}</span>
                                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{m.method}:{m.channel}</span>
                                    <button type="button" onClick={() => removeMethod(idx)} className="text-xs text-red-500 hover:text-red-600">hapus</button>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-4">
                            <input value={newMethod.method} onChange={(e) => setNewMethod({ ...newMethod, method: e.target.value })} placeholder="method (va)" className={inputClass} />
                            <input value={newMethod.channel} onChange={(e) => setNewMethod({ ...newMethod, channel: e.target.value })} placeholder="channel (bca)" className={inputClass} />
                            <input value={newMethod.label} onChange={(e) => setNewMethod({ ...newMethod, label: e.target.value })} placeholder="Label (VA BCA)" className={inputClass} />
                            <button type="button" onClick={addMethod} className="rounded-xl border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">+ Tambah</button>
                        </div>
                    </div>
                )}

                {gateway === 'midtrans' && (
                    <div className={cardClass}>
                        <h3 className="font-semibold text-gray-900 dark:text-white">Kredensial Midtrans</h3>
                        <label className="mt-3 block text-xs text-gray-500 dark:text-gray-400">
                            Server Key {view?.midtrans?.server_key_set && <span className="text-emerald-600 dark:text-emerald-400">(tersimpan {view.midtrans.server_key_hint})</span>}
                            <input type="password" value={midtransKey} onChange={(e) => setMidtransKey(e.target.value)} placeholder={view?.midtrans?.server_key_set ? 'Biarkan kosong = tidak diubah' : 'Masukkan server key'} className={`mt-1 ${inputClass}`} autoComplete="new-password" />
                        </label>
                        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input type="checkbox" checked={midtransProduction} onChange={(e) => setMidtransProduction(e.target.checked)} />
                            Mode Produksi
                        </label>
                    </div>
                )}

                {gateway === 'manual' && (
                    <div className={`${cardClass} text-sm text-gray-600 dark:text-gray-300`}>
                        Mode <b>Manual</b>: pelanggan membuat permintaan top-up, lalu Anda konfirmasi pembayaran di tab Pembayaran. Tidak perlu kredensial gateway.
                    </div>
                )}

                <button type="button" onClick={handleSave} disabled={saving} className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50">
                    {saving ? 'Menyimpan…' : 'Simpan Pengaturan Gateway'}
                </button>
            </div>

            <div className={`${cardClass} h-fit text-sm text-gray-600 dark:text-gray-300`}>
                <h3 className="font-semibold text-gray-900 dark:text-white">Panduan singkat</h3>
                <ul className="mt-2 space-y-2 text-xs">
                    <li>• <b>Manual</b>: tanpa gateway, konfirmasi pembayaran manual.</li>
                    <li>• <b>iPaymu</b>: isi VA/kode toko + API key dari dashboard iPaymu, pilih Sandbox dulu untuk uji coba, lalu aktifkan metode/bank yang diinginkan.</li>
                    <li>• <b>Midtrans</b>: isi Server Key (QRIS).</li>
                    <li>• Kunci rahasia tidak pernah ditampilkan kembali — kosongkan field key untuk mempertahankan yang tersimpan.</li>
                    <li>• Pastikan <b>Base URL publik</b> benar agar callback otomatis masuk.</li>
                </ul>
            </div>
        </div>
    );
}
