/*
Purpose: "Integrasi & Kunci API" — one place to enter the external-service keys that were previously buried
         inside feature pages (Gemini TTS key was only reachable from Pustaka, and unreachable at that; IMOU
         cloud creds lived under the audio Panel). Aggregates the EXISTING masked endpoints — no new backend,
         no raw GET /api/settings (which would leak unmasked secrets). Secrets are write-only: only a masked
         hint ever comes back.
Caller: UnifiedSettings "Kunci API" tab.
Deps: audioService (tts/imou config), components/ui, contexts (notification), react-router (Link).
MainFuncs: ApiKeySettings.
SideEffects: saves the Gemini key + IMOU credentials via the audio admin API.
*/

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTtsConfig, setTtsConfig, getImouConfig, setImouConfig, testImou } from '../../../services/audioService';
import { useNotification } from '../../../contexts/NotificationContext';
import { Button, Field } from '../../ui';

// A compact card that reads "configured" (masked) vs "belum diisi", used for BOTH the editable keys and the
// pointers to integrations managed on their own pages.
function IntegrationCard({ title, desc, configured, hint, children, footer }) {
    return (
        <section className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-e1">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-content">{title}</h3>
                    {desc ? <p className="mt-0.5 text-xs text-content-muted">{desc}</p> : null}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    configured ? 'bg-status-live/10 text-status-live' : 'bg-surface-sunken text-content-subtle'
                }`}>
                    {configured ? (hint ? `✓ terpasang · ${hint}` : '✓ terpasang') : 'belum diisi'}
                </span>
            </div>
            {children}
            {footer}
        </section>
    );
}

export default function ApiKeySettings() {
    const [tts, setTts] = useState(null);       // { gemini_configured, gemini_source, gemini_hint }
    const [imou, setImou] = useState(null);     // { configured, app_id, base_url }
    const [geminiKey, setGeminiKey] = useState('');
    const [appId, setAppId] = useState('');
    const [appSecret, setAppSecret] = useState('');
    const [busy, setBusy] = useState('');
    const { showNotification } = useNotification();

    const load = useCallback(async () => {
        const [t, i] = await Promise.all([getTtsConfig(), getImouConfig()]);
        if (t.success) setTts(t.data);
        if (i.success) setImou(i.data);
    }, []);
    useEffect(() => { load(); }, [load]);

    const saveGemini = async () => {
        if (!geminiKey.trim()) { showNotification({ type: 'error', title: 'Tempel kunci API dulu' }); return; }
        setBusy('gemini');
        const r = await setTtsConfig({ geminiApiKey: geminiKey.trim() });
        setBusy('');
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setGeminiKey('');
        showNotification({ type: 'success', title: 'Kunci Gemini disimpan', message: 'Mesin suara Gemini aktif.' });
        load();
    };
    const removeGemini = async () => {
        setBusy('gemini');
        const r = await setTtsConfig({ geminiApiKey: '' });
        setBusy('');
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        showNotification({ type: 'success', title: 'Kunci Gemini dihapus' });
        load();
    };

    const saveImou = async () => {
        if (!appId.trim() || !appSecret.trim()) { showNotification({ type: 'error', title: 'Isi appId & appSecret' }); return; }
        setBusy('imou');
        const r = await setImouConfig({ appId: appId.trim(), appSecret: appSecret.trim() });
        setBusy('');
        if (!r.success) { showNotification({ type: 'error', title: 'Gagal', message: r.message }); return; }
        setAppSecret('');
        showNotification({ type: 'success', title: 'Kredensial IMOU disimpan' });
        load();
    };
    const testImouConn = async () => {
        setBusy('imou-test');
        const r = await testImou();
        setBusy('');
        showNotification({ type: r.success ? 'success' : 'error', title: r.success ? 'Koneksi IMOU OK' : 'Gagal', message: r.message });
    };
    const editImou = () => { setImou((c) => ({ ...c, configured: false })); setAppId(''); setAppSecret(''); };

    return (
        <div className="space-y-5">
            <div className="rounded-card border border-edge bg-surface-sunken p-3">
                <p className="text-sm text-content-muted">
                    Satu tempat untuk semua kunci layanan luar. Kunci hanya tersimpan di server (tak pernah tampil utuh
                    lagi setelah disimpan). Integrasi yang punya halaman sendiri ditautkan di bawah.
                </p>
            </div>

            {/* Gemini — the key that used to be impossible to enter (chicken-and-egg in Pustaka). */}
            <IntegrationCard
                title="Google Gemini — suara TTS (gratis)"
                desc="Suara pengumuman paling natural. Buat kunci API gratis (tanpa kartu) di aistudio.google.com/apikey."
                configured={Boolean(tts?.gemini_configured)}
                hint={tts?.gemini_configured ? (tts.gemini_source === 'env' ? 'dari server' : tts.gemini_hint) : ''}
                footer={
                    <p className="text-xs text-content-subtle">
                        Buat kunci di{' '}
                        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">aistudio.google.com/apikey</a>.
                        Dipakai di Siaran Audio → Pustaka → mesin suara “Gemini”.
                    </p>
                }
            >
                {tts?.gemini_configured ? (
                    tts.gemini_source === 'ui' ? (
                        <Button variant="secondary" loading={busy === 'gemini'} onClick={removeGemini}>Hapus kunci</Button>
                    ) : (
                        <p className="text-xs text-content-muted">Kunci diambil dari variabel server (.env). Ubah lewat SSH, atau tempel kunci baru untuk menggantinya.</p>
                    )
                ) : null}
                {(!tts?.gemini_configured || tts?.gemini_source === 'env') && (
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            type="password"
                            value={geminiKey}
                            onChange={(e) => setGeminiKey(e.target.value)}
                            placeholder="Tempel kunci API Gemini (AIza…)"
                            className="min-w-0 flex-1 rounded-control border border-edge bg-surface px-2.5 py-1.5 text-sm text-content focus:border-primary focus:outline-none"
                        />
                        <Button variant="primary" loading={busy === 'gemini'} onClick={saveGemini} disabled={!geminiKey.trim()}>Simpan kunci</Button>
                    </div>
                )}
            </IntegrationCard>

            {/* IMOU cloud creds (SN mapping + siren buttons stay in the audio Panel where they are used). */}
            <IntegrationCard
                title="IMOU Cloud — sirene native"
                desc="Kredensial OpenAPI untuk memicu sirene bawaan kamera (jauh lebih keras dari jalur suara biasa)."
                configured={Boolean(imou?.configured)}
                hint={imou?.configured ? `appId ${imou.app_id}` : ''}
                footer={
                    <p className="text-xs text-content-subtle">
                        Daftar app di <span className="font-medium">open.imoulife.com</span>. Pemetaan SN kamera & tombol sirene ada di{' '}
                        <span className="font-medium">Siaran Audio → Panel</span>.
                    </p>
                }
            >
                {imou && !imou.configured ? (
                    <div className="space-y-2">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <Field label="appId" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="lc..." />
                            <Field label="appSecret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="••••••" />
                        </div>
                        <Button variant="primary" loading={busy === 'imou'} disabled={!appId.trim() || !appSecret.trim()} onClick={saveImou}>Simpan kredensial</Button>
                    </div>
                ) : imou ? (
                    <div className="flex flex-wrap items-center gap-2">
                        <Button variant="secondary" loading={busy === 'imou-test'} onClick={testImouConn}>Tes koneksi</Button>
                        <button type="button" onClick={editImou} className="rounded-control border border-edge px-2.5 py-1.5 text-xs font-medium text-content-muted hover:border-edge-strong">Ubah kredensial</button>
                    </div>
                ) : null}
            </IntegrationCard>

            {/* Pointers to integrations that keep their own richer editors — one overview, no duplication. */}
            <section className="space-y-2 rounded-card border border-edge bg-surface p-4 shadow-e1">
                <h3 className="text-sm font-semibold text-content">Integrasi lain (dikelola di halamannya)</h3>
                <ul className="space-y-1.5 text-sm text-content-muted">
                    <li>• <span className="font-medium text-content">Bot Telegram</span> (token bot notifikasi) — tab <span className="font-medium">Bot Telegram</span> di halaman ini.</li>
                    <li>• <span className="font-medium text-content">Gateway pembayaran</span> (Midtrans / iPaymu) — <Link to="/admin/billing" className="font-medium text-primary hover:underline">halaman Tagihan</Link> → tab Gateway.</li>
                    <li>• <span className="font-medium text-content">Cadangan ke Telegram</span> (chat id) — tab <span className="font-medium">Cadangan</span> di halaman ini.</li>
                </ul>
            </section>
        </div>
    );
}
