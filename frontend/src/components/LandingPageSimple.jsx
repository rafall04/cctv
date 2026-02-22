import { useState, lazy, Suspense } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useBranding } from '../contexts/BrandingContext';
import { shouldDisableAnimations } from '../utils/animationControl';
import { useCameras } from '../contexts/CameraContext';

// Lazy load widgets to avoid conflicts with LandingPage
const FeedbackWidget = lazy(() => import('./FeedbackWidget'));
const SaweriaSupport = lazy(() => import('./SaweriaSupport'));

// ============================================
// ICONS
// ============================================
const Icons = {
    Sun: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>,
    Moon: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>,
    Grid: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>,
    Map: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.447 2.724A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>,
    Playback: () => <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
};

// ============================================
// SIMPLE HEADER - Compact navigation with layout toggle
// ============================================
function SimpleHeader({ branding, layoutMode, onLayoutToggle }) {
    const { isDark, toggleTheme } = useTheme();
    const disableAnimations = shouldDisableAnimations();

    return (
        <header className={`sticky top-0 z-[1001] bg-white/90 dark:bg-gray-900/90 ${disableAnimations ? '' : 'backdrop-blur-xl'} border-b border-emerald-200/30 dark:border-emerald-700/30`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14">
                    {/* Logo */}
                    <a href="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity" title={branding.company_name}>
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/30">
                            <span className="text-sm font-bold">{branding.logo_text}</span>
                        </div>
                        <div className="hidden sm:block">
                            <span className="text-base font-bold text-gray-900 dark:text-white">{branding.company_name}</span>
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 ml-1">• Ramadan Kareem</span>
                        </div>
                    </a>

                    {/* Layout Mode & Theme Toggle */}
                    <div className="flex items-center gap-2">
                        {/* Ramadan Badge */}
                        <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z"/>
                            </svg>
                            <span>1447 H</span>
                        </div>

                        {/* Layout Mode Toggle */}
                        <button
                            onClick={onLayoutToggle}
                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={layoutMode === 'simple' ? 'Switch to Full Layout' : 'Switch to Simple Layout'}
                        >
                            {layoutMode === 'simple' ? <Icons.Grid /> : <Icons.Grid />}
                        </button>

                        {/* Dark Mode Toggle */}
                        <button
                            onClick={toggleTheme}
                            className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={isDark ? 'Light Mode' : 'Dark Mode'}
                        >
                            {isDark ? <Icons.Sun /> : <Icons.Moon />}
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}

// ============================================
// SIMPLE FOOTER - Minimal information
// ============================================
function SimpleFooter({ branding, saweriaEnabled, saweriaLink }) {
    return (
        <footer className="py-4 border-t border-emerald-200/30 dark:border-emerald-700/30 bg-gradient-to-r from-emerald-50/50 to-green-50/50 dark:from-emerald-950/20 dark:to-green-950/20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center space-y-1">
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">Ramadan Kareem 1447 H</span> • CCTV {branding.company_name}
                    </p>
                    <div className="flex items-center justify-center gap-3 text-xs text-gray-500 dark:text-gray-500">
                        <span>© 2026 {branding.company_name}</span>
                        <span>•</span>
                        <a
                            href="#feedback"
                            onClick={(e) => {
                                e.preventDefault();
                                document.querySelector('[data-feedback-widget]')?.click();
                            }}
                            className="hover:text-emerald-500 transition-colors"
                        >
                            Feedback
                        </a>
                        {saweriaEnabled && saweriaLink && (
                            <>
                                <span>•</span>
                                <a
                                    href={saweriaLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-emerald-500 transition-colors"
                                >
                                    Dukung
                                </a>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </footer>
    );
}

// ============================================
// LANDING PAGE SIMPLE - Minimal layout
// ============================================
export default function LandingPageSimple({
    onCameraClick,
    onAddMulti,
    multiCameras,
    saweriaEnabled,
    saweriaLink,
    CamerasSection,
    layoutMode,
    onLayoutToggle,
    favorites,
    onToggleFavorite,
    isFavorite,
}) {
    const { branding } = useBranding();
    const { cameras, areas, loading } = useCameras();
    const [viewMode, setViewMode] = useState('grid');

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
            <SimpleHeader
                branding={branding}
                layoutMode={layoutMode}
                onLayoutToggle={onLayoutToggle}
            />

            {/* Main Content - CamerasSection handles all view modes */}
            <main className="flex-1 min-h-0">
                {CamerasSection && (
                    <CamerasSection
                        onCameraClick={onCameraClick}
                        onAddMulti={onAddMulti}
                        multiCameras={multiCameras}
                        viewMode={viewMode}
                        setViewMode={setViewMode}
                        favorites={favorites}
                        onToggleFavorite={onToggleFavorite}
                        isFavorite={isFavorite}
                    />
                )}
            </main>

            <SimpleFooter
                branding={branding}
                saweriaEnabled={saweriaEnabled}
                saweriaLink={saweriaLink}
            />

            {/* Feedback Widget */}
            <Suspense fallback={null}>
                <FeedbackWidget />
            </Suspense>

            {/* Saweria Support */}
            <Suspense fallback={null}>
                <SaweriaSupport />
            </Suspense>
        </div>
    );
}
