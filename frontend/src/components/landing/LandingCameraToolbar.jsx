import LandingAreaFilter from './LandingAreaFilter';
import LandingSearchBox from './LandingSearchBox';
import LandingViewModeSwitch from './LandingViewModeSwitch';

export default function LandingCameraToolbar({
    title,
    camerasCount,
    viewMode,
    onViewModeChange,
    searchProps,
    showAreaFilter,
    areaFilterProps,
}) {
    return (
        <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {title}
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                        {camerasCount} kamera tersedia | Streaming langsung 24/7
                    </p>
                </div>

                <LandingViewModeSwitch viewMode={viewMode} onChange={onViewModeChange} />
            </div>

            <LandingSearchBox {...searchProps} />

            {showAreaFilter && <LandingAreaFilter {...areaFilterProps} />}
        </div>
    );
}
