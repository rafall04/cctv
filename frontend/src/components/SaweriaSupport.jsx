/*
 * Purpose: Render optional public Saweria support modal and floating banner without colliding with other mobile public actions.
 * Caller: Public landing full/simple pages.
 * Deps: React hooks, browser fetch/localStorage/window.open.
 * MainFuncs: SaweriaSupport.
 * SideEffects: Fetches Saweria config, stores banner preferences, opens Saweria external link, and registers temporary scroll/timer handlers.
 */

import { useState, useEffect, useMemo, memo } from 'react';

const STORAGE_KEY = 'saweria_dont_show';
const BANNER_MINIMIZED_KEY = 'saweria_banner_minimized';

// Simple icon - no multiple variations
const CoffeeIcon = () => (
    <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 8h1a4 4 0 010 8h-1" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
    </svg>
);

const SaweriaSupport = memo(function SaweriaSupport() {
    const [showModal, setShowModal] = useState(false);
    const [showBanner, setShowBanner] = useState(false);
    const [bannerMinimized, setBannerMinimized] = useState(false);
    const [isEnabled, setIsEnabled] = useState(false);
    const [isReady, setIsReady] = useState(false);

    // Simplified - just use one variation
    const modalContent = useMemo(() => ({
        title: 'Traktir Kopi Dong!',
        subtitle: 'Biar semangat maintain server & kamera 24/7',
    }), []);

    // Fetch config once with timeout
    useEffect(() => {
        let isMounted = true;

        const fetchConfig = async () => {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000);

                const response = await fetch('/api/saweria/config', {
                    signal: controller.signal
                }).catch(() => null);

                clearTimeout(timeoutId);

                if (isMounted && response?.ok) {
                    const data = await response.json().catch(() => null);
                    if (data?.data?.enabled === true) {
                        setIsEnabled(true);
                    }
                }
            } catch (e) {
                // Use default - enabled
            } finally {
                if (isMounted) {
                    setIsReady(true);
                }
            }
        };

        fetchConfig();

        return () => { isMounted = false; };
    }, []);

    // Show logic after ready
    useEffect(() => {
        if (!isReady) return;

        const dontShow = localStorage.getItem(STORAGE_KEY);

        if (dontShow === 'true') {
            // Show banner after delay
            const timer = setTimeout(() => {
                setShowBanner(true);
                setBannerMinimized(localStorage.getItem(BANNER_MINIMIZED_KEY) === 'true');
            }, 3000);
            return () => clearTimeout(timer);
        }

        // Show modal after scroll or timeout
        let hasScrolled = false;

        const handleScroll = () => {
            if (!hasScrolled && window.scrollY > 100) {
                hasScrolled = true;
                const timer = setTimeout(() => setShowModal(true), 1500);
                window.removeEventListener('scroll', handleScroll);
                return () => clearTimeout(timer);
            }
        };

        const fallbackTimer = setTimeout(() => {
            if (!hasScrolled) {
                setShowModal(true);
            }
            window.removeEventListener('scroll', handleScroll);
        }, 8000);

        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            clearTimeout(fallbackTimer);
            window.removeEventListener('scroll', handleScroll);
        };
    }, [isReady]);

    const handleModalClose = () => {
        setShowModal(false);
        setTimeout(() => setShowBanner(true), 2000);
    };

    const handleModalDontShow = () => {
        setShowModal(false);
        localStorage.setItem(STORAGE_KEY, 'true');
        setTimeout(() => setShowBanner(true), 2000);
    };

    const handleSupport = () => {
        window.open('https://saweria.co/raflialdi', '_blank', 'noopener,noreferrer');
        setShowModal(false);
        setTimeout(() => setShowBanner(true), 2000);
    };

    const handleBannerMinimize = () => {
        setBannerMinimized(true);
        localStorage.setItem(BANNER_MINIMIZED_KEY, 'true');
    };

    const handleBannerMaximize = () => {
        setBannerMinimized(false);
        localStorage.setItem(BANNER_MINIMIZED_KEY, 'false');
    };

    const handleBannerClose = () => setShowBanner(false);
    const handleBannerSupport = () => window.open('https://saweria.co/raflialdi', '_blank', 'noopener,noreferrer');

    if (!isReady || !isEnabled) return null;

    return (
        <>
            {/* Modal - Simplified, no animations */}
            {showModal && (
                <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/70">
                    <div className="absolute inset-0" onClick={handleModalClose} />

                    <div className="relative bg-surface border border-edge rounded-card shadow-e2 max-w-sm w-full max-h-[90vh] overflow-y-auto">
                        <div className="bg-amber-500 p-4 text-center">
                            <div className="w-12 h-12 mx-auto mb-2 bg-white/30 rounded-full flex items-center justify-center text-white">
                                <CoffeeIcon />
                            </div>
                            <h2 className="text-lg font-bold text-white">{modalContent.title}</h2>
                            <p className="text-white/80 text-xs">{modalContent.subtitle}</p>
                        </div>

                        <div className="p-4">
                            <p className="text-content-muted text-center text-sm mb-3">
                                Dukungan kamu sangat berarti untuk menjaga server tetap aktif 24/7!
                            </p>

                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleSupport}
                                    className="w-full bg-amber-500 text-white font-semibold py-2.5 px-4 rounded-control text-sm transition-colors hover:bg-amber-600"
                                >
                                    Traktir Kopi Sekarang
                                </button>

                                <button
                                    onClick={handleModalClose}
                                    className="w-full border border-edge text-content-muted font-medium py-2 px-4 rounded-control text-sm transition-colors hover:bg-surface-raised"
                                >
                                    Lain Kali Aja
                                </button>

                                <button
                                    onClick={handleModalDontShow}
                                    className="w-full text-gray-500 dark:text-gray-400 text-xs py-1"
                                >
                                    Jangan Tampilkan Lagi
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Banner - Simplified */}
            {showBanner && (
                <div
                    data-testid="saweria-floating-banner"
                    // Same rule as FeedbackWidget: a fixed element must never be sized with
                    // `100vw`, because it escapes the root overflow guard and can widen the page.
                    className={`fixed bottom-24 left-4 z-[99998] sm:bottom-24 sm:left-auto sm:right-6 ${bannerMinimized ? 'w-14' : 'right-[6.5rem] max-w-52 sm:right-6 sm:w-64 sm:max-w-none'}`}
                >
                    {bannerMinimized ? (
                        <button
                            onClick={handleBannerMaximize}
                            className="w-14 h-14 bg-amber-500 text-white rounded-full shadow-e2 flex items-center justify-center transition-colors hover:bg-amber-600"
                        >
                            <CoffeeIcon />
                        </button>
                    ) : (
                        <div className="bg-surface rounded-card shadow-e2 overflow-hidden border border-edge">
                            <div className="bg-amber-500 p-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <CoffeeIcon />
                                    <span className="text-white font-bold text-sm">Dukung Kami</span>
                                </div>
                                <div className="flex gap-1">
                                    <button onClick={handleBannerMinimize} className="w-6 h-6 rounded bg-white/20 text-white flex items-center justify-center">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                    </button>
                                    <button onClick={handleBannerClose} className="w-6 h-6 rounded bg-white/20 text-white flex items-center justify-center">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="p-3">
                                <p className="text-content-muted text-xs mb-2">Bantu server tetap aktif!</p>
                                <button
                                    onClick={handleBannerSupport}
                                    className="w-full bg-amber-500 text-white font-semibold py-2 rounded-control text-xs transition-colors hover:bg-amber-600"
                                >
                                    Traktir Kopi
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
});

export default SaweriaSupport;
