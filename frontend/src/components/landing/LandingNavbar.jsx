import { useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useCameras } from '../../contexts/CameraContext';
import { Icons } from '../ui/Icons';
import { shouldDisableAnimations } from '../../utils/animationControl';
import LayoutModeToggle from './LayoutModeToggle';
import { getPublicCameraStats } from '../../utils/publicCameraStats';

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
            className="text-sm font-mono tabular-nums text-content-muted"
        />
    );
}

export default function Navbar({ branding, layoutMode, onLayoutToggle }) {
    const { isDark, toggleTheme } = useTheme();
    const { cameras } = useCameras();
    const disableAnimations = shouldDisableAnimations();

    const cameraCount = useMemo(() => cameras?.length || 0, [cameras]);
    const onlineCount = useMemo(() => getPublicCameraStats(cameras).online, [cameras]);
    const handleLayoutChange = (nextMode) => {
        if (nextMode !== layoutMode) {
            onLayoutToggle();
        }
    };

    return (
        <nav className={`sticky top-0 z-[1001] bg-surface ${disableAnimations ? '' : 'supports-[backdrop-filter]:bg-surface/85 supports-[backdrop-filter]:backdrop-blur-lg'} border-b border-edge`}>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity" title={`${branding.company_tagline} - ${branding.company_name}`}>
                        {/* Flat primary, no gradient, no coloured drop shadow — the same call
                            already made for the admin shell logo tile. */}
                        <div className="relative">
                            <div className="w-10 h-10 rounded-control bg-primary flex items-center justify-center text-white">
                                <span className="text-lg font-bold">{branding.logo_text}</span>
                            </div>
                            {cameraCount > 0 && (
                                <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-status-live ring-2 ring-surface`}></span>
                            )}
                        </div>
                        <div>
                            <span className="text-lg font-bold text-content">{branding.company_name}</span>
                            <p className="text-[10px] text-content-subtle -mt-0.5">{branding.company_tagline}</p>
                        </div>
                    </Link>

                    {/* Operational pulse: live online count + clock, in mono. The old
                        city label lived here — dropped so the public identity reads as a
                        multi-city network, not one town. */}
                    <div className="hidden md:flex items-center gap-3 rounded-control border border-edge bg-surface px-3.5 py-1.5">
                        <div className="flex items-center gap-2" title="Kamera daring sekarang">
                            <span className={`h-1.5 w-1.5 rounded-full bg-status-live ${disableAnimations ? '' : 'animate-pulse'}`}></span>
                            <span className="text-xs font-mono font-semibold tabular-nums text-content">{onlineCount}</span>
                            <span className="text-[10px] font-mono uppercase tracking-[0.12em] text-status-live">Online</span>
                        </div>
                        <div className="w-px h-4 bg-edge"></div>
                        <ClockDisplay disableAnimations={disableAnimations} />
                    </div>

                    <div className="flex items-center gap-2">
                        <LayoutModeToggle
                            layoutMode={layoutMode}
                            onChange={handleLayoutChange}
                            compact
                        />
                        <button
                            onClick={toggleTheme}
                            className="rounded-control border border-edge p-2.5 text-content-muted transition-colors hover:border-edge-strong hover:bg-surface-raised hover:text-content"
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
