import LandingSearchBox from './LandingSearchBox';
import LandingViewModeSwitch from './LandingViewModeSwitch';

export default function LandingCameraToolbar({
    title,
    camerasCount,
    isLoading = false,
    viewMode,
    onViewModeChange,
    searchProps,
    contextualControls = null,
}) {
    return (
        <div className="mb-5 flex flex-col gap-4 sm:mb-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-h-[3.75rem] space-y-1">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-white">
                        {title}
                    </h2>
                    <p className="mt-1 min-h-[1.25rem] text-sm text-gray-500 dark:text-gray-400">
                        {isLoading ? 'Memuat kamera...' : `${camerasCount} kamera tersedia`}
                    </p>
                </div>

                <LandingViewModeSwitch viewMode={viewMode} onChange={onViewModeChange} />
            </div>

            <LandingSearchBox {...searchProps} />

            {contextualControls && (
                <div className="flex min-h-[4.25rem] flex-col gap-3 rounded-2xl border border-gray-200/70 bg-white/85 px-4 py-3 shadow-sm dark:border-gray-700/60 dark:bg-gray-900/70">
                    {contextualControls}
                </div>
            )}
        </div>
    );
}
