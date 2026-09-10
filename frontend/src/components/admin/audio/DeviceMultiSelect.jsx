/*
 * Purpose: Reusable Titik Speaker (STB node) multi-select — a chip toggle list of ENABLED speaker nodes,
 *   for adding them as broadcast targets alongside cameras (schedule / emergency / soundboard / play-now).
 *   Self-fetches the node list and renders NOTHING when no nodes are configured, so tabs stay unchanged on
 *   deployments without any STB. Mirrors CameraMultiSelect's shape (value = array of ids, onChange(ids)).
 * Caller: ScheduleTab, EmergencyPanel, SoundboardTab, PlayNowTab.
 * Deps: audioService.getDevices.
 */

import { useEffect, useState } from 'react';
import { getDevices } from '../../../services/audioService';

export default function DeviceMultiSelect({ value = [], onChange, disabled = false, label = 'Titik Speaker (STB)', hint }) {
    const [devices, setDevices] = useState([]);
    useEffect(() => {
        let cancelled = false;
        getDevices().then((r) => { if (!cancelled && r.success) setDevices((r.data || []).filter((d) => d.enabled)); });
        return () => { cancelled = true; };
    }, []);
    if (devices.length === 0) return null; // no nodes configured -> nothing to show

    const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    return (
        <div>
            <span className="mb-1.5 block text-xs font-semibold text-content-muted">
                📻 {label}{value.length ? ` — ${value.length} dipilih` : ''}
            </span>
            <div className="flex flex-wrap gap-1.5">
                {devices.map((d) => {
                    const on = value.includes(d.id);
                    return (
                        <button
                            key={d.id} type="button" disabled={disabled}
                            onClick={() => toggle(d.id)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${on ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}
                        >
                            <span className={`h-1.5 w-1.5 rounded-full ${d.online ? 'bg-status-live' : 'bg-edge-strong'}`} aria-hidden="true" />
                            {d.name}
                        </button>
                    );
                })}
            </div>
            {hint && <p className="mt-1 text-xs text-content-subtle">{hint}</p>}
        </div>
    );
}
