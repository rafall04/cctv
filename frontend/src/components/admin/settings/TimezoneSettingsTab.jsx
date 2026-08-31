/*
Purpose: Admin settings panel for selecting the application timezone — ANY IANA zone, not just Indonesia.
Caller: UnifiedSettings timezone tab.
Deps: React, ../../../services/api, lucide-react.
MainFuncs: TimezoneSettingsTab.
SideEffects: Reads and updates /api/admin/settings/timezone.
*/

import { useState, useEffect, useMemo } from 'react';
import { adminAPI } from '../../../services/api';
import { Clock, Save, AlertCircle } from 'lucide-react';

/** Every IANA zone the runtime knows. Not a fixed 3-item list — a future deployment could be anywhere. */
function useAllTimezones() {
    return useMemo(() => {
        try {
            const zones = Intl.supportedValuesOf('timeZone');
            if (Array.isArray(zones) && zones.length) return zones;
        } catch {
            // older engine without supportedValuesOf
        }
        return ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'UTC'];
    }, []);
}

/** Convenience labels for the deployment's home region; any other zone is picked by name. */
const QUICK_PICKS = [
    { tz: 'Asia/Jakarta', label: 'WIB' },
    { tz: 'Asia/Makassar', label: 'WITA' },
    { tz: 'Asia/Jayapura', label: 'WIT' },
];

/** "GMT+7" etc. + a live clock, so the operator can confirm the zone before saving. */
function zonePreview(tz) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false, timeZoneName: 'shortOffset',
        }).formatToParts(new Date());
        const time = `${parts.find((p) => p.type === 'hour')?.value}:${parts.find((p) => p.type === 'minute')?.value}:${parts.find((p) => p.type === 'second')?.value}`;
        const offset = parts.find((p) => p.type === 'timeZoneName')?.value || '';
        return `${time} ${offset}`;
    } catch {
        return null;
    }
}

export default function TimezoneSettingsTab() {
    const allZones = useAllTimezones();
    const [timezone, setTimezone] = useState('Asia/Jakarta');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        loadTimezone();
    }, []);

    const loadTimezone = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data } = await adminAPI.get('/api/admin/settings/timezone');
            // Use the IANA name so any region round-trips (shortName is only a label for WIB/WITA/WIT).
            setTimezone(data.data.timezone || 'Asia/Jakarta');
        } catch (error) {
            console.error('Failed to load timezone:', error);
            setError('Gagal memuat pengaturan timezone');
        } finally {
            setLoading(false);
        }
    };

    const isKnownZone = allZones.includes(timezone);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        setSuccess(false);
        try {
            await adminAPI.put('/api/admin/settings/timezone', { timezone });
            setSuccess(true);
            setTimeout(() => setSuccess(false), 3000);
        } catch (error) {
            console.error('Failed to update timezone:', error);
            setError(error?.response?.data?.message || 'Gagal menyimpan pengaturan timezone');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    const preview = zonePreview(timezone);

    return (
        <div className="bg-surface rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-6">
                <Clock className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-semibold text-content">
                    Pengaturan Zona Waktu
                </h2>
            </div>

            <div className="space-y-6">
                <div>
                    <label htmlFor="tz-input" className="block text-sm font-medium text-content-muted mb-2">
                        Zona Waktu (IANA)
                    </label>
                    <input
                        id="tz-input"
                        list="tz-zone-list"
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        disabled={saving}
                        placeholder="mis. Asia/Jakarta, America/New_York"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full px-4 py-2 border border-edge-strong rounded-lg
                                 bg-surface text-content
                                 focus:ring-2 focus:ring-primary focus:border-transparent
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <datalist id="tz-zone-list">
                        {allZones.map((z) => <option key={z} value={z} />)}
                    </datalist>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        {QUICK_PICKS.map(({ tz, label }) => (
                            <button
                                key={tz}
                                type="button"
                                onClick={() => setTimezone(tz)}
                                disabled={saving}
                                className={`rounded-control px-3 py-1 text-xs font-medium transition-colors ${timezone === tz ? 'bg-primary text-white' : 'bg-surface-sunken text-content-muted hover:bg-surface-raised'}`}
                            >
                                {label}
                            </button>
                        ))}
                        {preview && (
                            <span className="ml-auto text-xs tabular-nums text-content-subtle">
                                Sekarang di zona ini: <span className="font-medium text-content">{preview}</span>
                            </span>
                        )}
                    </div>

                    {!isKnownZone && (
                        <p className="mt-2 text-xs text-status-warn">
                            &quot;{timezone}&quot; bukan nama zona IANA yang dikenal. Pilih dari daftar (ketik untuk mencari) — server akan menolak zona tak valid.
                        </p>
                    )}
                </div>

                <div className="bg-surface-sunken border border-edge rounded-lg p-4">
                    <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-content-muted">
                            <p className="font-medium mb-2 text-content">Zona waktu ini dipakai untuk:</p>
                            <ul className="list-disc list-inside space-y-1 ml-2">
                                <li>Timestamp &amp; watermark pada recording</li>
                                <li>Log audit &amp; analytics</li>
                                <li>Tampilan waktu di seluruh aplikasi</li>
                            </ul>
                            <p className="mt-2 text-content-subtle">Batas hari tagihan langganan sengaja tetap terkunci pada zona penagihan (tak bergeser saat tampilan diubah), untuk mencegah salah tagih di dekat tengah malam.</p>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="bg-status-fault/10 border border-status-fault/30 rounded-lg p-4">
                        <p className="text-sm text-status-fault">{error}</p>
                    </div>
                )}

                {success && (
                    <div className="bg-status-live/10 border border-status-live/30 rounded-lg p-4">
                        <p className="text-sm text-status-live">
                            Pengaturan timezone berhasil disimpan
                        </p>
                    </div>
                )}

                <div className="flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={saving || !timezone}
                        className="flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-lg
                                 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed
                                 transition-colors"
                    >
                        <Save className="w-4 h-4" />
                        {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
                    </button>
                </div>
            </div>
        </div>
    );
}
