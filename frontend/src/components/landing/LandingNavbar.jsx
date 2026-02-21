import { useEffect, useState } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useCameras } from '../../contexts/CameraContext';
import { Icons } from '../ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';

export default function Navbar({ branding, layoutMode, onLayoutToggle }) {
    const { isDark, toggleTheme } = useTheme();
    const { cameras } = useCameras();
    const cameraCount = cameras?.length || 0;
    const [currentTime, setCurrentTime] = useState(new Date());
    const disableAnimations = shouldDisableAnimations();

    useEffect(() => {
        const clockInterval = disableAnimations ? 10000 : 1000;
        const timer = setInterval(() => setCurrentTime(new Date()), clockInterval);
        return () => clearInterval(timer);
    }, [disableAnimations]);

    return (
        <nav className={`sticky top-0 z-[1001] bg-white/90 dark:bg-gray-900/90 ${disableAnimations ? '' : 'backdrop-blur-xl'} border-b border-gray-200/50 dark:border-gray-800/50`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <a href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity" title={`${branding.company_tagline} - ${branding.company_name}`}>
                        <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-600 flex items-center justify-center text-white shadow-lg shadow-primary/30">
                                <span className="text-lg font-bold">{branding.logo_text}</span>
                            </div>
                            {cameraCount > 0 && (
                                <span className={`absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white dark:border-gray-900 ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            )}
                        </div>
                        <div>
                            <span className="text-lg font-bold text-gray-900 dark:text-white">{branding.company_name}</span>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">{branding.company_tagline}</p>
                        </div>
                    </a>

                    <div className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl bg-gray-100/80 dark:bg-gray-800/80">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full bg-emerald-500 ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">LIVE</span>
                        </div>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">{branding.city_name}</span>
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-sm font-mono text-gray-600 dark:text-gray-300">
                            {currentTime.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: disableAnimations ? undefined : '2-digit' })}
                        </span>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={onLayoutToggle}
                            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={layoutMode === 'simple' ? 'Switch to Full Layout' : 'Switch to Simple Layout'}
                            aria-label={layoutMode === 'simple' ? 'Beralih ke Tampilan Lengkap' : 'Beralih ke Tampilan Sederhana'}
                        >
                            {layoutMode === 'simple' ? <Icons.Layout /> : <Icons.Grid />}
                        </button>

                        <button
                            onClick={toggleTheme}
                            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                            aria-label={isDark ? 'Aktifkan Mode Terang' : 'Aktifkan Mode Gelap'}
                        >
                            {isDark ? <Icons.Sun /> : <Icons.Moon />}
                        </button>
                    </div>
                </div>
            </div>
        </nav>
    );
}
