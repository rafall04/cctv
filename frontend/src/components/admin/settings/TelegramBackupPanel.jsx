/*
Purpose: Configure the daily off-box database backup to Telegram — chat/group id, on/off, send now.
Caller: BackupSettingsTab (Pengaturan > Cadangan).
Deps: React, ../../../services/api, lucide-react.
SideEffects: Reads/writes /api/admin/backup/telegram; "Kirim sekarang" uploads a snapshot to Telegram.
*/

import { useCallback, useEffect, useState } from 'react';
import { adminAPI } from '../../../services/api';
import { Send, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';

export default function TelegramBackupPanel() {
    const [config, setConfig] = useState({ enabled: false, chatId: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);

    const load = useCallback(async () => {
        try {
            const { data } = await adminAPI.get('/api/admin/backup/telegram');
            if (data?.data) setConfig({ enabled: !!data.data.enabled, chatId: data.data.chatId || '' });
        } catch {
            setError('Gagal memuat pengaturan backup.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            await adminAPI.put('/api/admin/backup/telegram', config);
            setNotice('Pengaturan disimpan.');
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal menyimpan pengaturan.');
        } finally {
            setSaving(false);
        }
    };

    const sendNow = async () => {
        setSending(true);
        setError(null);
        setNotice(null);
        try {
            const { data } = await adminAPI.post('/api/admin/backup/telegram/send');
            setNotice(data?.message || 'Backup terkirim.');
        } catch (err) {
            setError(err?.response?.data?.message || 'Gagal mengirim backup.');
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return <div className="rounded-card border border-edge bg-surface p-6 text-content-muted">Memuat…</div>;
    }

    return (
        <div className="rounded-card border border-edge bg-surface p-6 space-y-4">
            <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-status-live shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                    <h3 className="font-semibold text-content">Backup otomatis ke Telegram</h3>
                    <p className="text-sm text-content-muted mt-1">
                        Sekali sehari, salinan utuh database dikirim ke chat/grup Telegram pilihan Anda.
                        Salinan dibuat dengan <code className="text-xs">VACUUM INTO</code> lalu dikompresi, jadi
                        aman diambil saat sistem sedang berjalan.
                    </p>
                </div>
            </div>

            <div role="note" className="flex items-start gap-2 rounded-control border border-status-warn/40 bg-status-warn/10 p-3">
                <AlertTriangle className="h-4 w-4 text-status-warn shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm text-content">
                    <span className="font-semibold">Gunakan chat PRIBADI saja.</span> Berkas ini berisi{' '}
                    <span className="italic">seluruh</span> database — termasuk kata sandi, saldo, dan token.
                    Kirim ke grup/channel yang hanya bisa Anda akses, <span className="font-medium">jangan</span> ke grup warga.
                </p>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
                <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
                    className="h-4 w-4 rounded border-edge-strong"
                />
                <span className="text-sm text-content">Aktifkan backup harian</span>
            </label>

            <div>
                <label htmlFor="backup-chat-id" className="block text-sm font-medium text-content mb-1.5">
                    Chat ID / Grup tujuan
                </label>
                <input
                    id="backup-chat-id"
                    type="text"
                    value={config.chatId}
                    onChange={(e) => setConfig((c) => ({ ...c, chatId: e.target.value }))}
                    placeholder="-1001234567890"
                    className="w-full rounded-control border border-edge-strong bg-surface-sunken px-3 py-2 text-content
                               placeholder:text-content-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <p className="text-xs text-content-subtle mt-1.5">
                    Cara mendapatkannya: buat grup Telegram pribadi (isi Anda sendiri), tambahkan bot{' '}
                    <code>@cctv_rafnet_bot</code>, lalu kirim <code>/chatid</code> di grup itu — bot membalas
                    ID-nya (grup diawali tanda minus, mis. <code>-1001234567890</code>). Atau kirim{' '}
                    <code>/chatid</code> japri ke bot untuk memakai chat pribadi Anda sendiri. Setelah diisi,
                    tekan <span className="font-medium">Kirim sekarang</span> untuk menguji jalurnya.
                </p>
            </div>

            {error && (
                <div role="alert" className="flex items-start gap-2 rounded-control border border-status-fault/40 bg-status-fault/10 p-3">
                    <AlertTriangle className="h-4 w-4 text-status-fault shrink-0 mt-0.5" aria-hidden="true" />
                    <p className="text-sm text-content">{error}</p>
                </div>
            )}
            {notice && (
                <div role="status" className="rounded-control border border-status-live/40 bg-status-live/10 p-3">
                    <p className="text-sm text-content">{notice}</p>
                </div>
            )}

            <div className="flex flex-wrap gap-3 pt-1">
                <button
                    type="button"
                    onClick={save}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-control bg-primary px-4 py-2 text-sm font-medium text-white
                               disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    Simpan
                </button>
                <button
                    type="button"
                    onClick={sendNow}
                    disabled={sending || !config.chatId}
                    title={!config.chatId ? 'Isi Chat ID dulu' : 'Kirim satu backup sekarang untuk menguji jalurnya'}
                    className="inline-flex items-center gap-2 rounded-control border border-edge-strong px-4 py-2 text-sm font-medium
                               text-content hover:bg-surface-raised disabled:opacity-50
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                    {sending ? 'Mengirim…' : 'Kirim sekarang'}
                </button>
            </div>
        </div>
    );
}
