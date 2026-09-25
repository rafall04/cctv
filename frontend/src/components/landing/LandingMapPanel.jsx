import { Suspense } from 'react';
import { InlineErrorBoundary } from '../ui/ErrorBoundary';

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
            {/* Leaflet/DOM crashes in MapView must not take down the landing page. */}
            <InlineErrorBoundary title="Peta gagal dimuat">
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
            </InlineErrorBoundary>
        </Suspense>
    );
}
