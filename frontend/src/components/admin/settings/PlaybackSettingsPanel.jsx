import { useCallback, useEffect, useState } from 'react';
import { useNotification } from '../../../contexts/NotificationContext';
import { settingsService } from '../../../services/settingsService';

const DEFAULT_SETTINGS = {
    public_playback_enabled: true,
    public_playback_preview_minutes: 10,
    public_playback_notice_enabled: true,
    public_playback_notice_title: 'Akses Playback Publik Terbatas',
    public_playback_notice_text: 'Playback publik dibatasi untuk menjaga privasi. Untuk akses lebih lanjut silakan hubungi admin.',
    public_playback_contact_mode: 'branding_whatsapp',
};

const PREVIEW_OPTIONS = [0, 10, 20, 30, 60];

const SETTING_DESCRIPTIONS = {
    public_playback_enabled: 'Enable public playback preview access',
    public_playback_preview_minutes: 'Limit public playback preview duration in minutes',
    public_playback_notice_enabled: 'Show public playback privacy notice',
    public_playback_notice_title: 'Title shown in the public playback privacy notice',
    public_playback_notice_text: 'Body copy shown in the public playback privacy notice',
    public_playback_contact_mode: 'Contact mode for public playback privacy notice',
};

function parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') {
            return true;
        }
        if (normalized === 'false' || normalized === '0') {
            return false;
        }
    }

    return fallback;
}

export default function PlaybackSettingsPanel() {
    const { success, error: showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);

    const loadSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await settingsService.getAllSettings();
            const data = response?.data || {};
            setSettings({
                public_playback_enabled: parseBoolean(data.public_playback_enabled, true),
                public_playback_preview_minutes: PREVIEW_OPTIONS.includes(parseInt(data.public_playback_preview_minutes, 10))
                    ? parseInt(data.public_playback_preview_minutes, 10)
                    : 10,
                public_playback_notice_enabled: parseBoolean(data.public_playback_notice_enabled, true),
                public_playback_notice_title: data.public_playback_notice_title || DEFAULT_SETTINGS.public_playback_notice_title,
                public_playback_notice_text: data.public_playback_notice_text || DEFAULT_SETTINGS.public_playback_notice_text,
                public_playback_contact_mode: data.public_playback_contact_mode || 'branding_whatsapp',
            });
        } catch (requestError) {
            console.error('Failed to load playback settings:', requestError);
            showError('Gagal Memuat', 'Gagal memuat pengaturan playback.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setSettings((previous) => ({
            ...previous,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setSaving(true);
            await Promise.all(
                Object.entries(settings).map(([key, value]) => (
                    settingsService.updateSetting(
                        key,
                        typeof value === 'boolean' ? String(value) : value,
                        SETTING_DESCRIPTIONS[key]
                    )
                ))
            );
            success('Pengaturan Tersimpan', 'Pengaturan playback berhasil diperbarui.');
        } catch (requestError) {
            console.error('Failed to save playback settings:', requestError);
            showError('Gagal Menyimpan', 'Gagal menyimpan pengaturan playback.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500"></div>
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Playback Settings</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Batasi playback publik menjadi preview singkat dan atur pesan privasi untuk pengguna.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-5 dark:border-gray-700 dark:bg-gray-900/40 space-y-5">
                    <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                        <input
                            type="checkbox"
                            name="public_playback_enabled"
                            checked={settings.public_playback_enabled}
                            onChange={handleChange}
                            className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-500"
                        />
                        <span>Aktifkan playback publik sebagai preview terbatas</span>
                    </label>

                    <div>
                        <label htmlFor="public_playback_preview_minutes" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Batas Preview Publik
                        </label>
                        <select
                            id="public_playback_preview_minutes"
                            name="public_playback_preview_minutes"
                            value={settings.public_playback_preview_minutes}
                            onChange={handleChange}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            {PREVIEW_OPTIONS.map((value) => (
                                <option key={value} value={value}>
                                    {value === 0 ? '0 menit (mati)' : `${value} menit`}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-5 dark:border-gray-700 dark:bg-gray-900/40 space-y-5">
                    <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
                        <input
                            type="checkbox"
                            name="public_playback_notice_enabled"
                            checked={settings.public_playback_notice_enabled}
                            onChange={handleChange}
                            className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-500"
                        />
                        <span>Tampilkan notice privasi di playback publik</span>
                    </label>

                    <div>
                        <label htmlFor="public_playback_notice_title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Judul Notice
                        </label>
                        <input
                            id="public_playback_notice_title"
                            name="public_playback_notice_title"
                            value={settings.public_playback_notice_title}
                            onChange={handleChange}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </div>

                    <div>
                        <label htmlFor="public_playback_notice_text" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Isi Notice
                        </label>
                        <textarea
                            id="public_playback_notice_text"
                            name="public_playback_notice_text"
                            value={settings.public_playback_notice_text}
                            onChange={handleChange}
                            rows={4}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </div>

                    <div>
                        <label htmlFor="public_playback_contact_mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Sumber Kontak
                        </label>
                        <select
                            id="public_playback_contact_mode"
                            name="public_playback_contact_mode"
                            value={settings.public_playback_contact_mode}
                            onChange={handleChange}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-sky-500 focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        >
                            <option value="branding_whatsapp">WhatsApp dari branding</option>
                        </select>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Kontak publik akan memakai `whatsapp_number` yang sudah ada di Branding Settings.
                        </p>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button
                        type="submit"
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan Pengaturan Playback'}
                    </button>
                </div>
            </form>
        </div>
    );
}
