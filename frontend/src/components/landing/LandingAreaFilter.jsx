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
        <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
                Area
            </span>
            <select
                value={selectedArea}
                onChange={onChange}
                className="min-w-[180px] rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
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
