import { Suspense } from 'react';

export default function LandingMapPanel({
    MapView,
    cameras,
    areas,
    selectedArea,
    onAreaChange,
    focusedCameraId,
    onFocusHandled,
}) {
    return (
        <Suspense
            fallback={
                <div className="h-[450px] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
                </div>
            }
        >
            <MapView
                cameras={cameras}
                areas={areas}
                selectedArea={selectedArea}
                onAreaChange={onAreaChange}
                showAreaFilter={false}
                className="h-[450px] sm:h-[550px]"
                focusedCameraId={focusedCameraId}
                onFocusHandled={onFocusHandled}
            />
        </Suspense>
    );
}
