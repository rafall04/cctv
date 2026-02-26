import { useState, lazy, Suspense } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useBranding } from '../contexts/BrandingContext';
import { shouldDisableAnimations } from '../utils/animationControl';
import { useCameras } from '../contexts/CameraContext';

// Lazy load widgets to avoid conflicts with LandingPage
const FeedbackWidget = lazy(() => import('./FeedbackWidget'));


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
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white shadow-lg shadow-primary/30">
                            <span className="text-sm font-bold">{branding.logo_text}</span>
                        </div>
                    </a>

                    {/* Layout Mode & Theme Toggle */}
                    <div className="flex items-center gap-2">
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
    const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

    return (
        <>
            <footer className="py-8 border-t border-amber-200/50 dark:border-amber-900/50 bg-gradient-to-b from-transparent to-amber-50/30 dark:to-amber-950/20">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col items-center justify-center gap-2 text-center">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-amber-600 to-amber-800 flex items-center justify-center text-white text-xs font-bold">
                                {branding.logo_text}
                            </div>
                            <span className="font-bold text-lg text-gray-900 dark:text-white tracking-tight">{branding.company_name}</span>
                        </div>
                        
                        <span className="text-sm font-medium text-amber-600 dark:text-amber-500">Ramadan Kareem 1447 H 🌙</span>
                        
                        <p className="text-gray-400 dark:text-gray-500 text-xs mt-2">
                            © {new Date().getFullYear()} {branding.company_name} • {branding.copyright_text}
                        </p>
                        
                        {saweriaEnabled && saweriaLink && (
                            <p className="text-gray-400 dark:text-gray-600 text-[10px]">
                                Sistem donasi dikelola oleh Saweria
                            </p>
                        )}
                    </div>
                </div>
            </footer>
            <Suspense fallback={null}>
                <FeedbackWidget isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
            </Suspense>
        </>
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
                {/* Ramadan Banner */}
                <div className="py-6 px-4 text-center bg-gradient-to-b from-amber-100/50 to-transparent dark:from-amber-900/10 dark:to-transparent border-b border-amber-200/30 dark:border-amber-800/30">
                    <div className="inline-flex items-center justify-center gap-2 px-5 py-2 rounded-full border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 shadow-sm">
                        <span className="text-amber-700 dark:text-amber-400 font-semibold text-sm">🌙 Selamat Menjalankan Ibadah Puasa 1447 H</span>
                    </div>
                </div>

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
        </div>
    );
}
