import { Suspense } from 'react';
import { InlineErrorBoundary } from '../ui/ErrorBoundary';

export default function LandingPlaybackPanel({ Playback, cameras, selectedCamera, adsConfig = null, accessScope = 'public_preview' }) {
    return (
        <Suspense
            fallback={
                <div className="h-[600px] bg-surface-sunken rounded-card flex items-center justify-center">
                    <div className="w-6 h-6 border-2 border-edge border-t-primary rounded-full animate-spin" />
                </div>
            }
        >
            {/* LandingPage renders the mobile dock; Playback must not add a second one.
                Boundary: a playback render crash must not take down the landing page. */}
            <InlineErrorBoundary title="Pemutar ulang gagal dimuat">
                <Playback cameras={cameras} selectedCamera={selectedCamera} adsConfig={adsConfig} accessScope={accessScope} showMobileDock={false} />
            </InlineErrorBoundary>
        </Suspense>
    );
}
