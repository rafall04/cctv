import { Suspense } from 'react';

export default function LandingMapPanel({
    MapView,
    cameras,
    areas,
    selectedArea,
    onAreaChange,
    focusedCameraId,
    onFocusHandled,
    adsConfig,
    onCameraOpen,
}) {
    return (
        <Suspense
            fallback={
                <div className="h-[450px] bg-surface-sunken rounded-card flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-edge border-t-primary rounded-full animate-spin" />
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
                adsConfig={adsConfig}
                onCameraOpen={onCameraOpen}
            />
        </Suspense>
    );
}
