import { lazy, Suspense } from 'react';

const LocationPicker = lazy(() => import('../../LocationPicker'));

export default function CameraLocationSection({
    latitude,
    longitude,
    isSubmitting,
    onLocationChange,
    isTunnel,
    onTunnelToggle,
}) {
    return (
        <>
            <div className="p-3 bg-sky-50 dark:bg-primary/10 border border-sky-200 dark:border-primary/20 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-lg bg-sky-100 dark:bg-primary/20 flex items-center justify-center text-primary-600 dark:text-primary-400 shrink-0">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                            <circle cx="12" cy="11" r="3" />
                        </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Lokasi Kamera</p>
                </div>
                <Suspense fallback={<div className="h-10 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center"><span className="text-gray-500 dark:text-gray-400 text-xs">Loading...</span></div>}>
                    <LocationPicker
                        latitude={latitude}
                        longitude={longitude}
                        onLocationChange={onLocationChange}
                    />
                </Suspense>
            </div>

            <div className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Koneksi Tunnel</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">Kurang stabil</p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onTunnelToggle}
                    disabled={isSubmitting}
                    className={`relative w-11 h-6 rounded-full transition-colors disabled:opacity-50 shrink-0 ${isTunnel ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${isTunnel ? 'left-5' : 'left-0.5'}`}></div>
                </button>
            </div>
        </>
    );
}
