export default function LandingAreaFilter({
    selectedArea,
    onChange,
    areaOptions,
    searchFilteredCameras,
}) {
    if (areaOptions.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-content-subtle">
                Area
            </span>
            <select
                value={selectedArea}
                onChange={onChange}
                aria-label="Filter kamera berdasarkan area"
                /* text-base sm:text-sm — a <select> under 16px makes Safari iOS zoom the page in. */
                className="min-h-[40px] min-w-[180px] rounded-control border border-edge bg-surface px-3 py-2.5 text-base text-content outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 sm:min-h-0 sm:text-sm"
            >
                <option value="all">Semua Area ({searchFilteredCameras.length})</option>
                {areaOptions.map((area) => (
                    <option key={area} value={area}>
                        {area} ({searchFilteredCameras.filter((camera) => camera.area_name === area).length})
                    </option>
                ))}
            </select>
        </div>
    );
}
