import { Suspense } from 'react';

export default function LandingPlaybackPanel({ Playback, cameras, selectedCamera, adsConfig = null }) {
    return (
        <Suspense
            fallback={
                <div className="h-[600px] bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
                </div>
            }
        >
            <Playback cameras={cameras} selectedCamera={selectedCamera} adsConfig={adsConfig} />
        </Suspense>
    );
}
