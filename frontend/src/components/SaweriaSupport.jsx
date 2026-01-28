import { useState, useEffect } from 'react';

/**
 * Saweria Support Component
 * 
 * Features:
 * 1. Modal popup on first visit (localStorage tracking)
 * 2. Floating banner (minimizable, persistent)
 * 3. Smooth animations and transitions
 * 
 * Usage:
 * <SaweriaSupport link="https://saweria.co/raflialdi" />
 */

const STORAGE_KEY = 'saweria_modal_shown';
const BANNER_MINIMIZED_KEY = 'saweria_banner_minimized';

export default function SaweriaSupport({ link = 'https://saweria.co/raflialdi' }) {
    const [showModal, setShowModal] = useState(false);
    const [showBanner, setShowBanner] = useState(false);
    const [bannerMinimized, setBannerMinimized] = useState(false);

    useEffect(() => {
        // Check if modal has been shown before
        const modalShown = localStorage.getItem(STORAGE_KEY);
        const bannerMinimized = localStorage.getItem(BANNER_MINIMIZED_KEY);

        if (!modalShown) {
            // Show modal after user scrolls a bit (shows engagement)
            let hasScrolled = false;
            
            const handleScroll = () => {
                if (!hasScrolled && window.scrollY > 100) {
                    hasScrolled = true;
                    setTimeout(() => {
                        setShowModal(true);
                    }, 1000); // 1 second after scroll
                    window.removeEventListener('scroll', handleScroll);
                }
            };

            // Fallback: show after 5 seconds if user doesn't scroll
            const fallbackTimer = setTimeout(() => {
                if (!hasScrolled) {
                    setShowModal(true);
                }
                window.removeEventListener('scroll', handleScroll);
            }, 5000);

            window.addEventListener('scroll', handleScroll);

            return () => {
                clearTimeout(fallbackTimer);
                window.removeEventListener('scroll', handleScroll);
            };
        } else {
            // If modal already shown, show banner after 3 seconds
            const bannerTimer = setTimeout(() => {
                setShowBanner(true);
                setBannerMinimized(bannerMinimized === 'true');
            }, 3000);

            return () => clearTimeout(bannerTimer);
        }
    }, []);

    const handleModalClose = () => {
        setShowModal(false);
        localStorage.setItem(STORAGE_KEY, 'true');
        
        // Show banner after closing modal
        setTimeout(() => {
            setShowBanner(true);
        }, 2000);
    };

    const handleModalSupport = () => {
        localStorage.setItem(STORAGE_KEY, 'true');
        window.open(link, '_blank', 'noopener,noreferrer');
        setShowModal(false);
        
        // Show banner after supporting
        setTimeout(() => {
            setShowBanner(true);
        }, 2000);
    };

    const handleBannerMinimize = () => {
        setBannerMinimized(true);
        localStorage.setItem(BANNER_MINIMIZED_KEY, 'true');
    };

    const handleBannerMaximize = () => {
        setBannerMinimized(false);
        localStorage.setItem(BANNER_MINIMIZED_KEY, 'false');
    };

    const handleBannerClose = () => {
        setShowBanner(false);
    };

    const handleBannerSupport = () => {
        window.open(link, '_blank', 'noopener,noreferrer');
    };

    return (
        <>
            {/* Modal Popup - First Visit Only */}
            {showModal && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 animate-fadeIn">
                    {/* Backdrop */}
                    <div 
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                        onClick={handleModalClose}
                    />
                    
                    {/* Modal Content */}
                    <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-slideUp">
                        {/* Gradient Header */}
                        <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 p-6 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center animate-bounce">
                                <span className="text-4xl">☕</span>
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">
                                Traktir Kopi Dong! 😊
                            </h2>
                            <p className="text-white/90 text-sm">
                                Biar semangat maintain server & kamera 24/7
                            </p>
                        </div>

                        {/* Body */}
                        <div className="p-6">
                            <p className="text-gray-700 dark:text-gray-300 text-center mb-4 leading-relaxed">
                                Halo! 👋 Senang banget kamu pakai layanan CCTV gratis ini.
                            </p>
                            <p className="text-gray-700 dark:text-gray-300 text-center mb-6 leading-relaxed">
                                Kalau kamu merasa terbantu, traktir kopi buat kami yuk! 
                                Seikhlasnya aja, berapapun sangat berarti buat jaga server tetap nyala ⚡
                            </p>

                            {/* Buttons */}
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={handleModalSupport}
                                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-3 px-6 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        <span>☕</span>
                                        <span>Traktir Kopi Sekarang</span>
                                    </span>
                                </button>
                                
                                <button
                                    onClick={handleModalClose}
                                    className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium py-3 px-6 rounded-xl transition-all duration-300"
                                >
                                    Lain Kali Aja 😅
                                </button>
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-4">
                                💝 Pesan ini cuma muncul sekali kok
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Banner - Persistent */}
            {showBanner && (
                <div className={`fixed bottom-6 right-6 z-[9998] transition-all duration-300 ${
                    bannerMinimized ? 'w-14' : 'w-80'
                }`} style={{ bottom: '5.5rem' }}> {/* Adjusted to avoid FeedbackWidget */}
                    {bannerMinimized ? (
                        /* Minimized State */
                        <button
                            onClick={handleBannerMaximize}
                            className="w-14 h-14 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-110 flex items-center justify-center text-2xl animate-bounce"
                            title="Traktir Kopi Yuk!"
                        >
                            ☕
                        </button>
                    ) : (
                        /* Expanded State */
                        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-orange-200 dark:border-orange-900/30 animate-slideInRight">
                            {/* Header */}
                            <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-2xl animate-bounce">☕</span>
                                    <div>
                                        <h3 className="text-white font-bold text-sm">
                                            Traktir Kopi Yuk!
                                        </h3>
                                        <p className="text-white/80 text-xs">
                                            Seikhlasnya aja 😊
                                        </p>
                                    </div>
                                </div>
                                
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={handleBannerMinimize}
                                        className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors flex items-center justify-center"
                                        title="Minimize"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={handleBannerClose}
                                        className="w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-colors flex items-center justify-center"
                                        title="Close"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {/* Body */}
                            <div className="p-4">
                                <p className="text-gray-700 dark:text-gray-300 text-sm mb-4 leading-relaxed">
                                    Biar server & kamera tetap nyala 24/7, traktir kopi dong! ☕✨
                                </p>

                                <button
                                    onClick={handleBannerSupport}
                                    className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 transform hover:scale-105 shadow-md hover:shadow-lg text-sm"
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        <span>☕</span>
                                        <span>Traktir Sekarang</span>
                                    </span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </>
    );
}

// Animations CSS (add to index.css or inline styles)
const styles = `
@keyframes fadeIn {
    from {
        opacity: 0;
    }
    to {
        opacity: 1;
    }
}

@keyframes slideUp {
    from {
        opacity: 0;
        transform: translateY(20px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
}

@keyframes slideInRight {
    from {
        opacity: 0;
        transform: translateX(100%);
    }
    to {
        opacity: 1;
        transform: translateX(0);
    }
}

.animate-fadeIn {
    animation: fadeIn 0.3s ease-out;
}

.animate-slideUp {
    animation: slideUp 0.4s ease-out;
}

.animate-slideInRight {
    animation: slideInRight 0.4s ease-out;
}
`;

// Export styles for use in index.css
export { styles as saweriaStyles };
