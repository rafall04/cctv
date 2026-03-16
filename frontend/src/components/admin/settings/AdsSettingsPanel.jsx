import { useCallback, useEffect, useState } from 'react';
import { useNotification } from '../../../contexts/NotificationContext';
import { settingsService } from '../../../services/settingsService';

const DEFAULT_SETTINGS = {
    ads_enabled: false,
    ads_provider: 'adsterra',
    ads_desktop_enabled: true,
    ads_mobile_enabled: true,
    ads_popup_slots_enabled: true,
    ads_popup_preferred_slot: 'bottom',
    ads_hide_social_bar_on_popup: true,
    ads_hide_floating_widgets_on_popup: true,
    ads_popup_desktop_max_height: 160,
    ads_popup_mobile_max_height: 220,
    ads_playback_popunder_enabled: false,
    ads_playback_popunder_script: '',
    ads_playback_popunder_desktop_enabled: true,
    ads_playback_popunder_mobile_enabled: true,
    ads_social_bar_enabled: false,
    ads_social_bar_script: '',
    ads_top_banner_enabled: false,
    ads_top_banner_script: '',
    ads_after_cameras_native_enabled: false,
    ads_after_cameras_native_script: '',
    ads_popup_top_banner_enabled: false,
    ads_popup_top_banner_script: '',
    ads_popup_bottom_native_enabled: false,
    ads_popup_bottom_native_script: '',
};

const SETTING_DESCRIPTIONS = {
    ads_enabled: 'Master toggle untuk semua iklan publik',
    ads_provider: 'Provider iklan aktif untuk seluruh placement',
    ads_desktop_enabled: 'Aktifkan iklan untuk viewport desktop',
    ads_mobile_enabled: 'Aktifkan iklan untuk viewport mobile',
    ads_popup_slots_enabled: 'Aktifkan slot iklan popup video',
    ads_popup_preferred_slot: 'Slot popup yang diprioritaskan pada desktop',
    ads_hide_social_bar_on_popup: 'Sembunyikan social bar saat popup live terbuka',
    ads_hide_floating_widgets_on_popup: 'Sembunyikan widget fixed internal saat popup live terbuka',
    ads_popup_desktop_max_height: 'Batas tinggi slot popup pada desktop',
    ads_popup_mobile_max_height: 'Batas tinggi slot popup pada mobile',
    ads_playback_popunder_enabled: 'Aktifkan popunder saat user masuk playback',
    ads_playback_popunder_script: 'Raw script popunder untuk mode playback',
    ads_playback_popunder_desktop_enabled: 'Aktifkan popunder playback pada desktop',
    ads_playback_popunder_mobile_enabled: 'Aktifkan popunder playback pada mobile',
    ads_social_bar_enabled: 'Aktifkan script social bar global',
    ads_social_bar_script: 'Raw script social bar untuk halaman publik',
    ads_top_banner_enabled: 'Aktifkan banner setelah hero landing page',
    ads_top_banner_script: 'Raw script banner untuk slot setelah hero',
    ads_after_cameras_native_enabled: 'Aktifkan native banner setelah cameras section',
    ads_after_cameras_native_script: 'Raw script native untuk slot setelah cameras section',
    ads_popup_top_banner_enabled: 'Aktifkan banner di atas popup video',
    ads_popup_top_banner_script: 'Raw script banner untuk bagian atas popup video',
    ads_popup_bottom_native_enabled: 'Aktifkan native banner di bawah popup video',
    ads_popup_bottom_native_script: 'Raw script native untuk bagian bawah popup video',
};

const SLOT_DEFINITIONS = [
    {
        enabledKey: 'ads_social_bar_enabled',
        scriptKey: 'ads_social_bar_script',
        title: 'Social Bar',
        description: 'Script global yang dimount sekali di halaman publik dan tetap aktif saat popup live terbuka.',
    },
    {
        enabledKey: 'ads_top_banner_enabled',
        scriptKey: 'ads_top_banner_script',
        title: 'Top Banner',
        description: 'Banner inline setelah hero dan sebelum daftar kamera pada full mode.',
    },
    {
        enabledKey: 'ads_after_cameras_native_enabled',
        scriptKey: 'ads_after_cameras_native_script',
        title: 'After Cameras Native',
        description: 'Native banner setelah section kamera dan sebelum blok Saweria/footer.',
    },
    {
        enabledKey: 'ads_popup_top_banner_enabled',
        scriptKey: 'ads_popup_top_banner_script',
        title: 'Popup Top Banner',
        description: 'Banner inline di bagian atas modal popup video, di luar body video.',
    },
    {
        enabledKey: 'ads_popup_bottom_native_enabled',
        scriptKey: 'ads_popup_bottom_native_script',
        title: 'Popup Bottom Native',
        description: 'Native/banner inline di bagian bawah popup video, di luar panel kontrol inti.',
    },
];

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value === 1;
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

function mapSettingsResponse(data = {}) {
    return {
        ads_enabled: normalizeBoolean(data.ads_enabled, false),
        ads_provider: data.ads_provider || 'adsterra',
        ads_desktop_enabled: normalizeBoolean(data.ads_desktop_enabled, true),
        ads_mobile_enabled: normalizeBoolean(data.ads_mobile_enabled, true),
        ads_popup_slots_enabled: normalizeBoolean(data.ads_popup_slots_enabled, true),
        ads_popup_preferred_slot: data.ads_popup_preferred_slot === 'top' ? 'top' : 'bottom',
        ads_hide_social_bar_on_popup: normalizeBoolean(data.ads_hide_social_bar_on_popup, true),
        ads_hide_floating_widgets_on_popup: normalizeBoolean(data.ads_hide_floating_widgets_on_popup, true),
        ads_popup_desktop_max_height: Number.parseInt(data.ads_popup_desktop_max_height, 10) > 0
            ? Number.parseInt(data.ads_popup_desktop_max_height, 10)
            : 160,
        ads_popup_mobile_max_height: Number.parseInt(data.ads_popup_mobile_max_height, 10) > 0
            ? Number.parseInt(data.ads_popup_mobile_max_height, 10)
            : 220,
        ads_playback_popunder_enabled: normalizeBoolean(data.ads_playback_popunder_enabled, false),
        ads_playback_popunder_script: data.ads_playback_popunder_script || '',
        ads_playback_popunder_desktop_enabled: normalizeBoolean(data.ads_playback_popunder_desktop_enabled, true),
        ads_playback_popunder_mobile_enabled: normalizeBoolean(data.ads_playback_popunder_mobile_enabled, true),
        ads_social_bar_enabled: normalizeBoolean(data.ads_social_bar_enabled, false),
        ads_social_bar_script: data.ads_social_bar_script || '',
        ads_top_banner_enabled: normalizeBoolean(data.ads_top_banner_enabled, false),
        ads_top_banner_script: data.ads_top_banner_script || '',
        ads_after_cameras_native_enabled: normalizeBoolean(data.ads_after_cameras_native_enabled, false),
        ads_after_cameras_native_script: data.ads_after_cameras_native_script || '',
        ads_popup_top_banner_enabled: normalizeBoolean(data.ads_popup_top_banner_enabled, false),
        ads_popup_top_banner_script: data.ads_popup_top_banner_script || '',
        ads_popup_bottom_native_enabled: normalizeBoolean(data.ads_popup_bottom_native_enabled, false),
        ads_popup_bottom_native_script: data.ads_popup_bottom_native_script || '',
    };
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

function ScriptField({ id, name, value, onChange }) {
    return (
        <textarea
            id={id}
            name={name}
            value={value}
            onChange={onChange}
            rows={5}
            spellCheck={false}
            placeholder="<script src=&quot;https://...&quot;></script>"
            className="w-full resize-y rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-xs text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
    );
}

function SelectField({ id, name, value, onChange, options, label }) {
    return (
        <div>
            <label htmlFor={id} className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {label}
            </label>
            <select
                id={id}
                name={name}
                value={value}
                onChange={onChange}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </div>
    );
}

function NumberField({ id, name, value, onChange, label, min = 1 }) {
    return (
        <div>
            <label htmlFor={id} className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {label}
            </label>
            <input
                id={id}
                name={name}
                type="number"
                min={min}
                value={value}
                onChange={onChange}
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
        </div>
    );
}

export default function AdsSettingsPanel() {
    const { success, error: showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);

    const fetchSettings = useCallback(async () => {
        try {
            setLoading(true);
            const response = await settingsService.getAllSettings();
            setSettings(mapSettingsResponse(response.data));
        } catch (requestError) {
            console.error('Error fetching ads settings:', requestError);
            showError('Gagal Memuat', 'Gagal memuat pengaturan iklan.');
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        fetchSettings();
    }, [fetchSettings]);

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setSettings((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        try {
            setSaving(true);
            await Promise.all(
                Object.entries(settings).map(([key, value]) =>
                    settingsService.updateSetting(
                        key,
                        typeof value === 'boolean' ? String(value) : value,
                        SETTING_DESCRIPTIONS[key]
                    )
                )
            );
            success('Pengaturan Tersimpan', 'Pengaturan iklan berhasil diperbarui.');
        } catch (requestError) {
            console.error('Error saving ads settings:', requestError);
            showError('Gagal Menyimpan', 'Gagal menyimpan pengaturan iklan.');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-sky-500"></div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 p-6 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Ads Settings</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    Kelola script iklan pihak ketiga per placement. Hanya admin tepercaya yang boleh mengubah field ini.
                </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 p-6">
                <SectionCard
                    title="Master Controls"
                    description="Kontrol global untuk mengaktifkan iklan dan target device."
                >
                    <CheckboxField
                        id="ads_enabled"
                        name="ads_enabled"
                        checked={settings.ads_enabled}
                        onChange={handleChange}
                        label="Aktifkan monetisasi iklan publik"
                    />

                    <div className="grid gap-3 md:grid-cols-2">
                        <CheckboxField
                            id="ads_desktop_enabled"
                            name="ads_desktop_enabled"
                            checked={settings.ads_desktop_enabled}
                            onChange={handleChange}
                            label="Aktifkan di desktop"
                        />
                        <CheckboxField
                            id="ads_mobile_enabled"
                            name="ads_mobile_enabled"
                            checked={settings.ads_mobile_enabled}
                            onChange={handleChange}
                            label="Aktifkan di mobile"
                        />
                    </div>

                    <div>
                        <label htmlFor="ads_provider" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Provider
                        </label>
                        <input
                            id="ads_provider"
                            name="ads_provider"
                            type="text"
                            value={settings.ads_provider}
                            onChange={handleChange}
                            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-gray-900 outline-none transition-all focus:border-transparent focus:ring-2 focus:ring-sky-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                        />
                    </div>
                </SectionCard>

                <SectionCard
                    title="Popup Layout Policy"
                    description="Atur perilaku iklan saat popup video dibuka agar player tetap menjadi fokus utama."
                >
                    <CheckboxField
                        id="ads_popup_slots_enabled"
                        name="ads_popup_slots_enabled"
                        checked={settings.ads_popup_slots_enabled}
                        onChange={handleChange}
                        label="Aktifkan slot iklan popup"
                    />

                    <div className="grid gap-3 md:grid-cols-2">
                        <CheckboxField
                            id="ads_hide_social_bar_on_popup"
                            name="ads_hide_social_bar_on_popup"
                            checked={settings.ads_hide_social_bar_on_popup}
                            onChange={handleChange}
                            label="Sembunyikan social bar saat popup aktif"
                        />
                        <CheckboxField
                            id="ads_hide_floating_widgets_on_popup"
                            name="ads_hide_floating_widgets_on_popup"
                            checked={settings.ads_hide_floating_widgets_on_popup}
                            onChange={handleChange}
                            label="Sembunyikan widget fixed internal saat popup aktif"
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        <SelectField
                            id="ads_popup_preferred_slot"
                            name="ads_popup_preferred_slot"
                            value={settings.ads_popup_preferred_slot}
                            onChange={handleChange}
                            label="Prioritas slot desktop"
                            options={[
                                { value: 'bottom', label: 'Bottom slot' },
                                { value: 'top', label: 'Top slot' },
                            ]}
                        />
                        <NumberField
                            id="ads_popup_desktop_max_height"
                            name="ads_popup_desktop_max_height"
                            value={settings.ads_popup_desktop_max_height}
                            onChange={handleChange}
                            label="Max height desktop (px)"
                        />
                        <NumberField
                            id="ads_popup_mobile_max_height"
                            name="ads_popup_mobile_max_height"
                            value={settings.ads_popup_mobile_max_height}
                            onChange={handleChange}
                            label="Max height mobile (px)"
                        />
                    </div>

                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
                        Gunakan creative compact atau vertikal untuk slot popup. Pada desktop, hanya satu slot popup yang diprioritaskan agar player tetap terbaca.
                    </div>
                </SectionCard>

                <SectionCard
                    title="Playback Popunder"
                    description="Popunder ini dipicu setiap kali user masuk ke mode playback dan tidak akan diulang oleh rerender internal playback."
                >
                    <CheckboxField
                        id="ads_playback_popunder_enabled"
                        name="ads_playback_popunder_enabled"
                        checked={settings.ads_playback_popunder_enabled}
                        onChange={handleChange}
                        label="Aktifkan popunder playback"
                    />

                    <div className="grid gap-3 md:grid-cols-2">
                        <CheckboxField
                            id="ads_playback_popunder_desktop_enabled"
                            name="ads_playback_popunder_desktop_enabled"
                            checked={settings.ads_playback_popunder_desktop_enabled}
                            onChange={handleChange}
                            label="Tampilkan di desktop"
                        />
                        <CheckboxField
                            id="ads_playback_popunder_mobile_enabled"
                            name="ads_playback_popunder_mobile_enabled"
                            checked={settings.ads_playback_popunder_mobile_enabled}
                            onChange={handleChange}
                            label="Tampilkan di mobile"
                        />
                    </div>

                    <div>
                        <label htmlFor="ads_playback_popunder_script" className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                            Script
                        </label>
                        <ScriptField
                            id="ads_playback_popunder_script"
                            name="ads_playback_popunder_script"
                            value={settings.ads_playback_popunder_script}
                            onChange={handleChange}
                        />
                    </div>
                </SectionCard>

                {SLOT_DEFINITIONS.map((slot) => (
                    <SectionCard
                        key={slot.enabledKey}
                        title={slot.title}
                        description={slot.description}
                    >
                        <CheckboxField
                            id={slot.enabledKey}
                            name={slot.enabledKey}
                            checked={settings[slot.enabledKey]}
                            onChange={handleChange}
                            label={`Aktifkan ${slot.title}`}
                        />

                        <div>
                            <label htmlFor={slot.scriptKey} className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                                Script
                            </label>
                            <ScriptField
                                id={slot.scriptKey}
                                name={slot.scriptKey}
                                value={settings[slot.scriptKey]}
                                onChange={handleChange}
                            />
                        </div>
                    </SectionCard>
                ))}

                <div className="rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 text-sm text-gray-700 dark:border-amber-500/20 dark:from-amber-500/10 dark:to-orange-500/10 dark:text-gray-300">
                    Script pihak ketiga akan dijalankan langsung di browser pengunjung. Pastikan hanya domain dan script monetisasi yang sudah Anda percaya yang dimasukkan di sini.
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={fetchSettings}
                        disabled={saving}
                        className="rounded-xl bg-gray-100 px-4 py-2.5 text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700/50 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                        Reset Form
                    </button>
                    <button
                        type="submit"
                        disabled={saving}
                        className="rounded-xl bg-sky-500 px-4 py-2.5 text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
                    >
                        {saving ? 'Menyimpan...' : 'Simpan'}
                    </button>
                </div>
            </form>
        </div>
    );
}
