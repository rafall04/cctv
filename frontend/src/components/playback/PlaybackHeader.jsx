/*
 * Purpose: Render the playback page header — title, share action, and the camera picker.
 * Caller: Playback page (public preview and admin full scope).
 * Deps: Caller-provided camera list and change/share handlers.
 * MainFuncs: PlaybackHeader, cameraOptionLabel, groupCamerasByArea.
 * SideEffects: Invokes caller-provided camera change and share handlers.
 *
 * Deliberately ends at the picker. The access notice and auto-play toggle moved to PlaybackOptions,
 * which renders BELOW the video — so the picker sits directly above the player instead of the video
 * being pushed under five stacked blocks.
 *
 * The selected-camera summary card that used to sit here was removed: it repeated the name and
 * location the picker already shows on its selected option, so it cost a block of vertical space on
 * a phone and told the visitor nothing new.
 */

/**
 * Most cameras are named after their location, so "NAME - LOCATION" rendered as
 * "SIMPANG 4 BUNDARAN JETAK - SIMPANG 4 BUNDARAN JETAK" — every option a three-line wall of the
 * same words twice. Append the location only when it actually adds something.
 */
export function cameraOptionLabel(camera) {
    const name = String(camera?.name || '').trim();
    const location = String(camera?.location || '').trim();
    if (!location) return name;

    const a = name.toUpperCase();
    const b = location.toUpperCase();
    if (a === b || a.includes(b) || b.includes(a)) return name;
    return `${name} — ${location}`;
}

/**
 * Cameras grouped by area, areas and names both sorted, so scanning is predictable.
 *
 * A flat list of 36 meant someone looking for a Magetan junction scrolled past 14 Bojonegoro ones
 * first. <optgroup> is deliberately chosen over a custom search box: it keeps the native picker that
 * mobile users already know (and that Android renders as a grouped, flickable list), costs no
 * keyboard/aria work, and adds nothing to a page already at its size ceiling.
 *
 * Cameras without an area fall into a trailing group rather than disappearing.
 */
export function groupCamerasByArea(cameras) {
    const groups = new Map();
    for (const camera of cameras || []) {
        const key = (camera?.area_name || '').trim() || 'Lainnya';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(camera);
    }
    for (const list of groups.values()) {
        list.sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || ''), 'id'));
    }
    return [...groups.entries()]
        .sort(([a], [b]) => (a === 'Lainnya' ? 1 : b === 'Lainnya' ? -1 : a.localeCompare(b, 'id')))
        .map(([area, list]) => ({ area, cameras: list }));
}

export default function PlaybackHeader({
    cameras,
    selectedCamera,
    onCameraChange,
    onShare,
}) {
    const grouped = groupCamerasByArea(cameras);
    return (
        <div className="space-y-3 rounded-card border border-edge bg-surface p-3 sm:p-4">
            <div className="flex items-center justify-between gap-3">
                <h1 className="text-lg font-semibold text-content sm:text-xl">Playback Recording</h1>
                {onShare && (
                    <button
                        onClick={onShare}
                        className="flex shrink-0 items-center gap-2 rounded-control border border-edge px-3 py-1.5 text-sm font-medium text-content transition-colors hover:border-edge-strong hover:bg-surface-raised"
                        title="Bagikan tautan playback"
                    >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                        </svg>
                        <span className="hidden sm:inline">Bagikan</span>
                    </button>
                )}
            </div>

            <select
                value={selectedCamera?.id || ''}
                onChange={(e) => onCameraChange(cameras.find((c) => c.id === parseInt(e.target.value, 10)))}
                aria-label="Pilih kamera"
                className="w-full rounded-control border border-edge bg-surface px-3 py-2 text-content focus:border-transparent focus:ring-2 focus:ring-primary"
            >
                {grouped.map(({ area, cameras: list }) => (
                    <optgroup key={area} label={`${area} (${list.length})`}>
                        {list.map((camera, idx) => (
                            <option key={camera.id ?? `cam-${idx}`} value={camera.id}>
                                {cameraOptionLabel(camera)}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
        </div>
    );
}
