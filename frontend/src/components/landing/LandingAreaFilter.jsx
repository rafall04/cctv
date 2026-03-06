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
        <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filter Area:</span>
            <select
                value={selectedArea}
                onChange={onChange}
                className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
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
