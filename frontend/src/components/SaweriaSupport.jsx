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
    const [isEnabled, setIsEnabled] = useState(true);
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
                
                const response = await fetch('/api/saweria/public', { 
                    signal: controller.signal 
                }).catch(() => null);
                
                clearTimeout(timeoutId);
                
                if (isMounted && response?.ok) {
                    const data = await response.json().catch(() => null);
                    if (data?.enabled === false) {
                        setIsEnabled(false);
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
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70">
                    <div className="absolute inset-0" onClick={handleModalClose} />
                    
                    <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-sm w-full max-h-[90vh] overflow-y-auto">
                        <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 text-center">
                            <div className="w-12 h-12 mx-auto mb-2 bg-white/30 rounded-full flex items-center justify-center text-white">
                                <CoffeeIcon />
                            </div>
                            <h2 className="text-lg font-bold text-white">{modalContent.title}</h2>
                            <p className="text-white/80 text-xs">{modalContent.subtitle}</p>
                        </div>

                        <div className="p-4">
                            <p className="text-gray-700 dark:text-gray-300 text-center text-sm mb-3">
                                Dukungan kamu sangat berarti untuk menjaga server tetap aktif 24/7!
                            </p>
                            
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleSupport}
                                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold py-2.5 px-4 rounded-xl text-sm"
                                >
                                    Traktir Kopi Sekarang
                                </button>
                                
                                <button
                                    onClick={handleModalClose}
                                    className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium py-2 px-4 rounded-xl text-sm"
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
                <div className={`fixed bottom-6 right-6 z-[9998] ${bannerMinimized ? 'w-14' : 'w-64'}`}>
                    {bannerMinimized ? (
                        <button
                            onClick={handleBannerMaximize}
                            className="w-14 h-14 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-full shadow-lg flex items-center justify-center"
                        >
                            <CoffeeIcon />
                        </button>
                    ) : (
                        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg overflow-hidden border border-orange-200 dark:border-orange-900/30">
                            <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-3 flex items-center justify-between">
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
                                <p className="text-gray-600 dark:text-gray-400 text-xs mb-2">Bantu server tetap aktif!</p>
                                <button
                                    onClick={handleBannerSupport}
                                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 text-white font-semibold py-2 rounded-lg text-xs"
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
