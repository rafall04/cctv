import { useEffect, useRef, useMemo } from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { useCameras } from '../../contexts/CameraContext';
import { Icons } from '../ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';

function ClockDisplay({ disableAnimations }) {
    const timeRef = useRef(null);
    const intervalRef = useRef(null);

    useEffect(() => {
        const updateTime = () => {
            if (timeRef.current) {
                const now = new Date();
                timeRef.current.textContent = now.toLocaleTimeString('id-ID', { 
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: disableAnimations ? undefined : '2-digit' 
                });
            }
        };

        updateTime();
        
        const interval = disableAnimations ? 10000 : 1000;
        intervalRef.current = setInterval(updateTime, interval);

        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, [disableAnimations]);

    return (
        <span 
            ref={timeRef} 
            className="text-sm font-mono text-gray-600 dark:text-gray-300"
        />
    );
}

export default function Navbar({ branding, layoutMode, onLayoutToggle }) {
    const { isDark, toggleTheme } = useTheme();
    const { cameras } = useCameras();
    const disableAnimations = shouldDisableAnimations();

    const cameraCount = useMemo(() => cameras?.length || 0, [cameras]);

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
                        <ClockDisplay disableAnimations={disableAnimations} />
                        <div className="w-px h-4 bg-gray-300 dark:bg-gray-600"></div>
                        <span className="text-xs text-amber-500 dark:text-amber-400 font-medium flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z"/>
                                <path d="M10 5a1 1 0 011 1v3.586l2.707 2.707a1 1 0 01-1.414 1.414l-3-3A1 1 0 019 10V6a1 1 0 011-1z"/>
                            </svg>
                            Ramadan
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
