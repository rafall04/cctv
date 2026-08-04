/*
 * Purpose: Let an admin set the security policy (rate limits, brute force, password rules, session
 *          lifetimes) from the panel instead of by SSH-ing in to edit backend/.env.
 * Caller: UnifiedSettings "Keamanan" tab.
 * Deps: apiClient, NotificationContext, ui primitives.
 * MainFuncs: SecuritySettingsPanel.
 * SideEffects: GET/PUT /api/admin/settings/security.
 */

import { useCallback, useEffect, useState } from 'react';
import apiClient from '../../../services/apiClient';
import { useNotification } from '../../../contexts/NotificationContext';
import { Alert, Button, Card } from '../../ui';

const GROUPS = [
    {
        title: 'Batas Permintaan',
        hint: 'Berapa banyak permintaan per menit dari satu alamat IP sebelum ditolak (429).',
        fields: [
            { key: 'rateLimitEnabled', label: 'Aktifkan batas permintaan', type: 'boolean' },
            { key: 'rateLimitPublic', label: 'Halaman publik', suffix: '/menit', hint: 'Satu muat halaman memicu ~8–10 permintaan.' },
            { key: 'rateLimitAuth', label: 'Login & autentikasi', suffix: '/menit' },
            { key: 'rateLimitAdmin', label: 'Panel admin', suffix: '/menit' },
        ],
    },
    {
        title: 'Perlindungan Brute Force',
        hint: 'Penguncian setelah gagal login berulang. Dihitung dalam jendela 15 menit.',
        fields: [
            { key: 'bruteForceEnabled', label: 'Aktifkan perlindungan', type: 'boolean' },
            { key: 'maxLoginAttempts', label: 'Gagal maksimal per username', suffix: 'kali' },
            { key: 'maxIpAttempts', label: 'Gagal maksimal per IP', suffix: 'kali' },
            { key: 'lockoutDurationMinutes', label: 'Lama kunci username', suffix: 'menit' },
            { key: 'ipBlockDurationMinutes', label: 'Lama blokir IP', suffix: 'menit' },
        ],
    },
    {
        title: 'Kebijakan Kata Sandi',
        hint: 'Berlaku untuk pendaftaran pelanggan dan pembuatan/penggantian akun admin.',
        fields: [
            { key: 'passwordMinLength', label: 'Panjang minimal', suffix: 'karakter', hint: 'Tidak boleh di bawah 8.' },
            { key: 'passwordMaxAgeDays', label: 'Wajib ganti setelah', suffix: 'hari', hint: '0 = tidak pernah kedaluwarsa.' },
            { key: 'passwordHistoryCount', label: 'Tidak boleh sama dengan', suffix: 'sandi terakhir' },
        ],
    },
    {
        title: 'Sesi & Token',
        hint: 'Durasi memakai format angka + satuan: s, m, h, d (mis. 30m, 12h, 7d).',
        fields: [
            { key: 'accessTokenExpiry', label: 'Masa token akses', type: 'duration' },
            { key: 'refreshTokenExpiry', label: 'Masa token refresh', type: 'duration' },
            { key: 'sessionAbsoluteTimeoutHours', label: 'Batas mutlak sesi', suffix: 'jam', hint: 'Setelah ini wajib login ulang, seaktif apa pun.' },
        ],
    },
];

const SOURCE_LABEL = {
    panel: null, // saved here — the normal case, no badge needed
    env: 'dari .env',
    default: 'bawaan',
};

export default function SecuritySettingsPanel() {
    const { success, error: showError } = useNotification();
    const [form, setForm] = useState(null);
    // What the server reported on load, so Save can send only what the admin actually touched.
    const [loaded, setLoaded] = useState(null);
    const [sources, setSources] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [fieldErrors, setFieldErrors] = useState([]);

    const load = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const { data } = await apiClient.get('/api/admin/settings/security');
            const settings = data?.data?.settings || null;
            setForm(settings);
            setLoaded(settings);
            setSources(data?.data?.sources || {});
        } catch {
            setLoadError('Gagal memuat pengaturan keamanan.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

    const handleSave = async () => {
        setSaving(true);
        setFieldErrors([]);
        try {
            // Only what actually changed. Sending the whole form would promote every value
            // still inherited from .env into the database on the first save, silently making the
            // file irrelevant for fields nobody touched — and the "dari .env" badges would all
            // vanish at once for no reason the operator can see.
            const patch = Object.fromEntries(
                Object.entries(form).filter(([key, value]) => value !== loaded?.[key])
            );
            if (Object.keys(patch).length === 0) {
                success('Tidak ada perubahan', 'Belum ada nilai yang diubah.');
                return;
            }
            const { data } = await apiClient.put('/api/admin/settings/security', patch);
            const settings = data?.data?.settings || form;
            setForm(settings);
            setLoaded(settings);
            setSources(data?.data?.sources || sources);
            success('Tersimpan', 'Pengaturan keamanan langsung berlaku, tanpa perlu restart.');
        } catch (err) {
            const body = err?.response?.data;
            setFieldErrors(body?.errors || []);
            showError('Gagal Menyimpan', body?.message || 'Pengaturan keamanan tidak tersimpan.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <p className="text-sm text-content-muted">Memuat…</p>;
    if (loadError) {
        return (
            <div className="space-y-3">
                <Alert type="error" message={loadError} />
                <Button onClick={load}>Coba lagi</Button>
            </div>
        );
    }
    if (!form) return null;

    return (
        <div className="space-y-4">
            {/*
              * Said plainly because it was NOT true before: every one of these used to be a
              * hardcoded constant, with same-named variables in .env that nothing ever read.
              */}
            <Alert
                type="info"
                message="Nilai di sini berlaku seketika untuk permintaan berikutnya — backend tidak perlu di-restart. Yang disimpan di sini mengalahkan backend/.env."
            />

            {fieldErrors.length > 0 && (
                <Alert type="error" message={fieldErrors.join(' · ')} />
            )}

            {GROUPS.map((group) => (
                <Card key={group.title}>
                    <h3 className="font-semibold text-content">{group.title}</h3>
                    <p className="mt-0.5 text-xs text-content-muted">{group.hint}</p>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {group.fields.map((field) => {
                            const badge = SOURCE_LABEL[sources[field.key]];
                            return (
                                <label key={field.key} className="block">
                                    <span className="flex items-center gap-2 text-sm font-medium text-content">
                                        {field.label}
                                        {badge && (
                                            <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium text-content-muted">
                                                {badge}
                                            </span>
                                        )}
                                    </span>

                                    {field.type === 'boolean' ? (
                                        <select
                                            value={form[field.key] ? 'true' : 'false'}
                                            onChange={(e) => setField(field.key, e.target.value === 'true')}
                                            className="mt-1 w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content"
                                        >
                                            <option value="true">Aktif</option>
                                            <option value="false">Nonaktif</option>
                                        </select>
                                    ) : (
                                        <span className="mt-1 flex items-center gap-2">
                                            <input
                                                type={field.type === 'duration' ? 'text' : 'number'}
                                                value={form[field.key] ?? ''}
                                                onChange={(e) => setField(
                                                    field.key,
                                                    field.type === 'duration' ? e.target.value : Number(e.target.value)
                                                )}
                                                className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-sm text-content"
                                            />
                                            {field.suffix && (
                                                <span className="shrink-0 text-xs text-content-muted">{field.suffix}</span>
                                            )}
                                        </span>
                                    )}

                                    {field.hint && (
                                        <span className="mt-1 block text-xs text-content-subtle">{field.hint}</span>
                                    )}
                                </label>
                            );
                        })}
                    </div>
                </Card>
            ))}

            <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saving}>
                    {saving ? 'Menyimpan…' : 'Simpan'}
                </Button>
                <Button variant="secondary" onClick={load} disabled={saving}>Batalkan perubahan</Button>
            </div>
        </div>
    );
}
