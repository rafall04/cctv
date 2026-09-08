/*
 * Purpose: A compact multi-select list of speaker-capable cameras for the Audio Broadcast surface.
 *   Shared by the Putar Sekarang tab and the schedule form so both pick cameras the same way.
 * Caller: components/admin/audio/PlayNowTab.jsx, ScheduleForm.jsx.
 * Deps: React only (token classes).
 * MainFuncs: CameraMultiSelect.
 * SideEffects: none — controlled by `value` + `onChange`.
 *
 * Not every internal camera exposes an ONVIF backchannel (an IMOU S41FE has a speaker but does not
 * expose it), so the list is "candidates" — a chosen camera without a backchannel simply reports its
 * failure at play time. The label says as much rather than promising every camera will play.
 */

/**
 * @param {Array<{id:number,name:string,area_name?:string}>} cameras
 * @param {number[]} value selected camera ids
 * @param {(ids:number[])=>void} onChange
 */
export default function CameraMultiSelect({ cameras = [], value = [], onChange, disabled = false }) {
    const selected = new Set(value);

    const toggle = (id) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id); else next.add(id);
        onChange([...next]);
    };

    const allIds = cameras.map((c) => c.id);
    const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-content-muted">
                    Kamera tujuan ({selected.size}/{cameras.length})
                </span>
                {cameras.length > 0 && (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(allOn ? [] : allIds)}
                        className="text-xs font-medium text-primary hover:underline disabled:opacity-60"
                    >
                        {allOn ? 'Kosongkan' : 'Pilih semua'}
                    </button>
                )}
            </div>

            {cameras.length === 0 ? (
                <p className="rounded-control border border-dashed border-edge bg-surface-sunken p-3 text-xs text-content-subtle">
                    Tidak ada kamera internal dengan RTSP. Audio hanya bisa dikirim ke kamera internal.
                </p>
            ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-control border border-edge bg-surface p-1">
                    {cameras.map((cam) => {
                        const on = selected.has(cam.id);
                        return (
                            <label
                                key={cam.id}
                                className={`flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-sm transition-colors ${
                                    on ? 'bg-primary/10 text-content' : 'text-content-muted hover:bg-surface-sunken'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={disabled}
                                    onChange={() => toggle(cam.id)}
                                    className="h-4 w-4 shrink-0 accent-primary"
                                />
                                <span className="min-w-0 flex-1 truncate">{cam.name}</span>
                                {cam.area_name && (
                                    <span className="shrink-0 text-xs text-content-subtle">{cam.area_name}</span>
                                )}
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
