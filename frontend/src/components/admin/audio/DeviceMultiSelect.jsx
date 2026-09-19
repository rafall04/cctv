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
import { StatusDot } from '../../ui';

export default function DeviceMultiSelect({ value = [], onChange, disabled = false, label = 'Titik Speaker (STB)', hint, pollInterval = 0, className = '' }) {
    const [devices, setDevices] = useState([]);
    useEffect(() => {
        let cancelled = false;
        const load = () => getDevices().then((r) => { if (!cancelled && r.success) setDevices((r.data || []).filter((d) => d.enabled)); });
        load();
        // Live target pickers (e.g. TalkTab paging) need fresh online state — the chips
        // badge it, and only online nodes actually sound.
        const t = pollInterval > 0 ? setInterval(load, pollInterval) : null;
        return () => { cancelled = true; if (t) clearInterval(t); };
    }, [pollInterval]);
    if (devices.length === 0) return null; // no nodes configured -> nothing to show

    const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
    return (
        <div className={className || undefined}>
            <span className="mb-1.5 block text-xs font-semibold text-content-muted">
                {label}{value.length ? ` — ${value.length} dipilih` : ''}
            </span>
            <div className="flex flex-wrap gap-1.5">
                {devices.map((d) => {
                    const on = value.includes(d.id);
                    return (
                        <button
                            key={d.id} type="button" disabled={disabled}
                            aria-pressed={on}
                            onClick={() => toggle(d.id)}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${on ? 'border-primary bg-primary/10 text-primary' : 'border-edge bg-surface text-content-muted hover:border-edge-strong'}`}
                        >
                            <StatusDot small tone={d.online ? 'live' : 'neutral'} label={d.online ? 'online' : 'offline'} />
                            {d.name}
                        </button>
                    );
                })}
            </div>
            {hint && <p className="mt-1 text-xs text-content-subtle">{hint}</p>}
        </div>
    );
}
