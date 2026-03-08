import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNotification } from '../../../contexts/NotificationContext';
import { adminAPI } from '../../../services/api';

const EVENT_THEMES = [
    { value: 'ramadan', label: 'Ramadan' },
    { value: 'eid', label: 'Idul Fitri' },
    { value: 'national', label: 'Event Nasional' },
    { value: 'neutral', label: 'Netral' },
];

const ANNOUNCEMENT_STYLES = [
    { value: 'info', label: 'Informasi' },
    { value: 'warning', label: 'Peringatan' },
    { value: 'success', label: 'Sukses' },
];

const DEFAULT_SETTINGS = {
    landing_area_coverage: '',
    landing_hero_badge: '',
    landing_section_title: '',
    event_banner_enabled: false,
    event_banner_title: '',
    event_banner_text: '',
    event_banner_theme: 'neutral',
    event_banner_start_at: '',
    event_banner_end_at: '',
    event_banner_show_in_full: true,
    event_banner_show_in_simple: true,
    announcement_enabled: false,
    announcement_title: '',
    announcement_text: '',
    announcement_style: 'info',
    announcement_start_at: '',
    announcement_end_at: '',
    announcement_show_in_full: true,
    announcement_show_in_simple: true,
};

const SETTING_DESCRIPTIONS = {
    landing_area_coverage: 'Area coverage text displayed on landing page hero section',
    landing_hero_badge: 'Badge text displayed above hero title',
    landing_section_title: 'Main section title for camera list',
    event_banner_enabled: 'Enable themed event banner on public landing page',
    event_banner_title: 'Short label for the event banner',
    event_banner_text: 'Main text displayed in the event banner',
    event_banner_theme: 'Preset visual theme for the event banner',
    event_banner_start_at: 'Start datetime for event banner visibility',
    event_banner_end_at: 'End datetime for event banner visibility',
    event_banner_show_in_full: 'Whether event banner appears in full mode',
    event_banner_show_in_simple: 'Whether event banner appears in simple mode',
    announcement_enabled: 'Enable announcement bar on public landing page',
    announcement_title: 'Optional title for the announcement',
    announcement_text: 'Main text displayed in the announcement bar',
    announcement_style: 'Preset visual style for the announcement bar',
    announcement_start_at: 'Start datetime for announcement visibility',
    announcement_end_at: 'End datetime for announcement visibility',
    announcement_show_in_full: 'Whether announcement appears in full mode',
    announcement_show_in_simple: 'Whether announcement appears in simple mode',
};

const getApiUrl = () => {
    return import.meta.env.VITE_API_URL || 'http://localhost:3000';
};

function toLocalDateTimeValue(value) {
    if (!value) {
        return '';
    }

    return String(value).replace(' ', 'T').slice(0, 16);
}

function mapResponseToSettings(data) {
    return {
        landing_area_coverage: data?.area_coverage || '',
        landing_hero_badge: data?.hero_badge || '',
        landing_section_title: data?.section_title || '',
        event_banner_enabled: data?.eventBanner?.enabled === true,
        event_banner_title: data?.eventBanner?.title || '',
        event_banner_text: data?.eventBanner?.text || '',
        event_banner_theme: data?.eventBanner?.theme || 'neutral',
        event_banner_start_at: toLocalDateTimeValue(data?.eventBanner?.start_at),
        event_banner_end_at: toLocalDateTimeValue(data?.eventBanner?.end_at),
        event_banner_show_in_full: data?.eventBanner?.show_in_full !== false,
        event_banner_show_in_simple: data?.eventBanner?.show_in_simple !== false,
        announcement_enabled: data?.announcement?.enabled === true,
        announcement_title: data?.announcement?.title || '',
        announcement_text: data?.announcement?.text || '',
        announcement_style: data?.announcement?.style || 'info',
        announcement_start_at: toLocalDateTimeValue(data?.announcement?.start_at),
        announcement_end_at: toLocalDateTimeValue(data?.announcement?.end_at),
        announcement_show_in_full: data?.announcement?.show_in_full !== false,
        announcement_show_in_simple: data?.announcement?.show_in_simple !== false,
    };
}

function Field({ label, htmlFor, hint, children }) {
    return (
        <div>
            <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {label}
            </label>
            {children}
            {hint && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
        </div>
    );
}

function CheckboxField({ id, name, checked, onChange, label }) {
    return (
        <label className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
            <input
                id={id}
                name={name}
                type="checkbox"
                checked={checked}
                onChange={onChange}
                className="h-4 w-4 rounded border-gray-300 text-sky-500 focus:ring-sky-500"
            />
            <span>{label}</span>
        </label>
    );
}

function SectionCard({ title, description, children }) {
    return (
        <section className="rounded-2xl border border-gray-200 bg-gray-50/80 p-5 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="mb-5">
                <h4 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h4>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p>
            </div>
            <div className="space-y-5">{children}</div>
        </section>
    );
}

export default function GeneralSettingsPanel() {
    const { success, error: showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);

    const fetchSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${getApiUrl()}/api/settings/landing-page`);
            setSettings(mapResponseToSettings(response.data.data));
        } catch (requestError) {
            console.error('Error fetching settings:', requestError);
            showError('Gagal Memuat', 'Gagal memuat pengaturan landing page');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setSaving(true);
            await Promise.all(
                Object.entries(settings).map(([key, value]) =>
                    adminAPI.put(`/api/settings/${key}`, {
                        value: typeof value === 'boolean' ? String(value) : value,
                        description: SETTING_DESCRIPTIONS[key],
                    })
                )
            );
            success('Pengaturan Tersimpan', 'Pengaturan landing page berhasil disimpan.');
        } catch (requestError) {
            console.error('Error saving settings:', requestError);
            showError('Gagal Menyimpan', 'Gagal menyimpan pengaturan landing page');
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setSettings((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
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
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Landing Page Settings</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    Customize public landing page text, event banner, and announcement bar.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <SectionCard
                    title="Hero & Section Copy"
                    description="Teks utama yang selalu dipakai di landing page publik."
                >
                    <Field label="Hero Badge Text" htmlFor="landing_hero_badge">
                        <input
                            type="text"
                            id="landing_hero_badge"
                            name="landing_hero_badge"
                            value={settings.landing_hero_badge}
                            onChange={handleChange}
                            placeholder="LIVE STREAMING 24 JAM"
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </Field>

                    <Field label="Section Title" htmlFor="landing_section_title">
                        <input
                            type="text"
                            id="landing_section_title"
                            name="landing_section_title"
                            value={settings.landing_section_title}
                            onChange={handleChange}
                            placeholder="CCTV Publik"
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </Field>

                    <Field label="Area Coverage Text" htmlFor="landing_area_coverage">
                        <textarea
                            id="landing_area_coverage"
                            name="landing_area_coverage"
                            value={settings.landing_area_coverage}
                            onChange={handleChange}
                            rows={3}
                            placeholder="Saat ini area coverage kami baru mencakup <strong>Dander</strong> dan <strong>Tanjungharjo</strong>"
                            className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </Field>
                </SectionCard>

                <SectionCard
                    title="Event Banner"
                    description="Banner tematik untuk momen seperti Ramadan, Idul Fitri, atau event khusus."
                >
                    <CheckboxField
                        id="event_banner_enabled"
                        name="event_banner_enabled"
                        checked={settings.event_banner_enabled}
                        onChange={handleChange}
                        label="Aktifkan event banner"
                    />

                    <div className="grid gap-5 md:grid-cols-2">
                        <Field label="Title" htmlFor="event_banner_title" hint="Label singkat seperti Ramadan Kareem atau Idul Fitri.">
                            <input
                                type="text"
                                id="event_banner_title"
                                name="event_banner_title"
                                value={settings.event_banner_title}
                                onChange={handleChange}
                                placeholder="Ramadan Kareem"
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </Field>

                        <Field label="Theme" htmlFor="event_banner_theme">
                            <select
                                id="event_banner_theme"
                                name="event_banner_theme"
                                value={settings.event_banner_theme}
                                onChange={handleChange}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            >
                                {EVENT_THEMES.map((theme) => (
                                    <option key={theme.value} value={theme.value}>
                                        {theme.label}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <Field label="Banner Text" htmlFor="event_banner_text">
                        <textarea
                            id="event_banner_text"
                            name="event_banner_text"
                            value={settings.event_banner_text}
                            onChange={handleChange}
                            rows={3}
                            placeholder="Sambut momen spesial bersama RAF NET CCTV publik."
                            className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </Field>

                    <div className="grid gap-5 md:grid-cols-2">
                        <Field label="Start At" htmlFor="event_banner_start_at" hint="Mengikuti timezone sistem yang aktif.">
                            <input
                                type="datetime-local"
                                id="event_banner_start_at"
                                name="event_banner_start_at"
                                value={settings.event_banner_start_at}
                                onChange={handleChange}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </Field>

                        <Field label="End At" htmlFor="event_banner_end_at" hint="Kosongkan bila ingin tampil terus selama diaktifkan.">
                            <input
                                type="datetime-local"
                                id="event_banner_end_at"
                                name="event_banner_end_at"
                                value={settings.event_banner_end_at}
                                onChange={handleChange}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </Field>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <CheckboxField
                            id="event_banner_show_in_full"
                            name="event_banner_show_in_full"
                            checked={settings.event_banner_show_in_full}
                            onChange={handleChange}
                            label="Tampilkan di Full Mode"
                        />
                        <CheckboxField
                            id="event_banner_show_in_simple"
                            name="event_banner_show_in_simple"
                            checked={settings.event_banner_show_in_simple}
                            onChange={handleChange}
                            label="Tampilkan di Simple Mode"
                        />
                    </div>
                </SectionCard>

                <SectionCard
                    title="Announcement Bar"
                    description="Bar informasi operasional yang muncul rapi di bawah header landing page."
                >
                    <CheckboxField
                        id="announcement_enabled"
                        name="announcement_enabled"
                        checked={settings.announcement_enabled}
                        onChange={handleChange}
                        label="Aktifkan announcement"
                    />

                    <div className="grid gap-5 md:grid-cols-2">
                        <Field label="Title" htmlFor="announcement_title" hint="Opsional. Bila kosong akan memakai judul Pengumuman.">
                            <input
                                type="text"
                                id="announcement_title"
                                name="announcement_title"
                                value={settings.announcement_title}
                                onChange={handleChange}
                                placeholder="Info Layanan"
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </Field>

                        <Field label="Style" htmlFor="announcement_style">
                            <select
                                id="announcement_style"
                                name="announcement_style"
                                value={settings.announcement_style}
                                onChange={handleChange}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            >
                                {ANNOUNCEMENT_STYLES.map((style) => (
                                    <option key={style.value} value={style.value}>
                                        {style.label}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </div>

                    <Field label="Announcement Text" htmlFor="announcement_text">
                        <textarea
                            id="announcement_text"
                            name="announcement_text"
                            value={settings.announcement_text}
                            onChange={handleChange}
                            rows={3}
                            placeholder="Pemeliharaan jaringan akan dilakukan malam ini pukul 23.00."
                            className="w-full resize-none rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </Field>

                    <div className="grid gap-5 md:grid-cols-2">
                        <Field label="Start At" htmlFor="announcement_start_at" hint="Mengikuti timezone sistem yang aktif.">
                            <input
                                type="datetime-local"
                                id="announcement_start_at"
                                name="announcement_start_at"
                                value={settings.announcement_start_at}
                                onChange={handleChange}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </Field>

                        <Field label="End At" htmlFor="announcement_end_at" hint="Kosongkan bila ingin tampil terus selama diaktifkan.">
                            <input
                                type="datetime-local"
                                id="announcement_end_at"
                                name="announcement_end_at"
                                value={settings.announcement_end_at}
                                onChange={handleChange}
                                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                            />
                        </Field>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                        <CheckboxField
                            id="announcement_show_in_full"
                            name="announcement_show_in_full"
                            checked={settings.announcement_show_in_full}
                            onChange={handleChange}
                            label="Tampilkan di Full Mode"
                        />
                        <CheckboxField
                            id="announcement_show_in_simple"
                            name="announcement_show_in_simple"
                            checked={settings.announcement_show_in_simple}
                            onChange={handleChange}
                            label="Tampilkan di Simple Mode"
                        />
                    </div>
                </SectionCard>

                <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 dark:border-amber-500/20 dark:from-amber-500/10 dark:to-orange-500/10">
                    <div className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <div>
                            <span className="font-medium">Hero Badge:</span>{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">{settings.landing_hero_badge || 'LIVE STREAMING 24 JAM'}</span>
                        </div>
                        <div>
                            <span className="font-medium">Event Banner:</span>{' '}
                            {settings.event_banner_enabled
                                ? `${settings.event_banner_title || 'Tanpa judul'} - ${settings.event_banner_text || 'Belum ada isi'}`
                                : 'Nonaktif'}
                        </div>
                        <div>
                            <span className="font-medium">Announcement:</span>{' '}
                            {settings.announcement_enabled
                                ? `${settings.announcement_title || 'Pengumuman'} - ${settings.announcement_text || 'Belum ada isi'}`
                                : 'Nonaktif'}
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={fetchSettings}
                        disabled={saving}
                        className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                    >
                        Reset Form
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl transition-colors disabled:opacity-60"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan'}
                    </button>
                </div>
            </form>
        </div>
    );
}
