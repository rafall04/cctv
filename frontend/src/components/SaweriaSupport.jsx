import { useState, useEffect, useMemo } from 'react';
import { detectDeviceTier } from '../utils/deviceDetector';

/**
 * Saweria Support Component - Optimized for Low-End Devices
 * 
 * Features:
 * 1. Modal popup on every visit with random variations (user-friendly)
 * 2. Floating banner (minimizable, persistent)
 * 3. Device-adaptive animations (disabled on low-end)
 * 4. "Don't show again" option for users who don't want to see it
 * 
 * Performance optimizations:
 * - Detect device tier and disable heavy animations on low-end
 * - Use simple fade instead of backdrop blur on low-end
 * - Memoize modal variation to prevent re-renders
 * - Use CSS transforms for better performance
 * 
 * Usage:
 * <SaweriaSupport link="https://saweria.co/raflialdi" />
 */

const STORAGE_KEY = 'saweria_dont_show';
const BANNER_MINIMIZED_KEY = 'saweria_banner_minimized';

// Modal variations for variety (random selection)
const MODAL_VARIATIONS = [
    {
        emoji: '☕',
        title: 'Traktir Kopi Dong! 😊',
        subtitle: 'Biar semangat maintain server & kamera 24/7',
        message1: 'Halo! 👋 Senang banget kamu pakai layanan CCTV gratis ini.',
        message2: 'Dukungan kamu akan membantu kami untuk:',
        features: [
            '🎥 Menambah titik CCTV di lokasi strategis',
            '⚡ Upgrade server biar makin cepat',
            '🔧 Maintenance rutin semua kamera'
        ],
        footer: 'Seikhlasnya aja, berapapun sangat berarti! 💝',
        gradient: 'from-orange-500 via-amber-500 to-yellow-500',
    },
    {
        emoji: '🎥',
        title: 'Bantu Tambah CCTV Yuk! 📹',
        subtitle: 'Lebih banyak kamera = lebih aman',
        message1: 'Saat ini ada beberapa lokasi strategis yang belum terpasang CCTV 😢',
        message2: 'Dengan dukungan kamu, kami bisa:',
        features: [
            '📍 Pasang CCTV di titik-titik penting',
            '🌐 Expand coverage area monitoring',
            '💪 Tingkatkan keamanan lingkungan'
        ],
        footer: 'Yuk bantu wujudkan! Nominal berapa aja sangat membantu 🙏',
        gradient: 'from-blue-500 via-cyan-500 to-teal-500',
    },
    {
        emoji: '🚀',
        title: 'Mari Berkembang Bersama!',
        subtitle: 'Dari kamu, untuk lingkungan lebih aman',
        message1: 'Terima kasih sudah pakai layanan CCTV gratis kami! 🎉',
        message2: 'Dukungan kamu akan kami gunakan untuk:',
        features: [
            '🎯 Beli & pasang CCTV di lokasi baru',
            '📡 Upgrade bandwidth untuk streaming HD',
            '🔋 Bayar listrik & internet 24/7'
        ],
        footer: 'Seikhlasnya dari hati, sangat berarti buat kami! ❤️',
        gradient: 'from-purple-500 via-violet-500 to-indigo-500',
    },
    {
        emoji: '⚡',
        title: 'Keep The Server Running!',
        subtitle: 'Plus tambah kamera di lokasi strategis',
        message1: 'Server ini nyala 24/7 biar kamu bisa pantau CCTV kapan aja! ⏰',
        message2: 'Bantu kami untuk:',
        features: [
            '🎬 Tambah kamera di area yang belum ter-cover',
            '💻 Maintain server & bandwidth',
            '🛠️ Service rutin semua perangkat'
        ],
        footer: 'Traktir kopi kami dong! Yang penting dari hati 💝',
        gradient: 'from-pink-500 via-rose-500 to-red-500',
    },
];

export default function SaweriaSupport({ link = 'https://saweria.co/raflialdi' }) {
    const [showModal, setShowModal] = useState(false);
    const [showBanner, setShowBanner] = useState(false);
    const [bannerMinimized, setBannerMinimized] = useState(false);
    
    // Detect device tier once and memoize
    const deviceTier = useMemo(() => detectDeviceTier(), []);
    const isLowEnd = deviceTier === 'low';
    
    // Select random modal variation once and memoize
    const modalVariation = useMemo(() => {
        const randomIndex = Math.floor(Math.random() * MODAL_VARIATIONS.length);
        return MODAL_VARIATIONS[randomIndex];
    }, []);

    useEffect(() => {
        // Check if user chose "don't show again"
        const dontShow = localStorage.getItem(STORAGE_KEY);
        const bannerMinimized = localStorage.getItem(BANNER_MINIMIZED_KEY);

        if (dontShow !== 'true') {
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

            window.addEventListener('scroll', handleScroll, { passive: true });

            return () => {
                clearTimeout(fallbackTimer);
                window.removeEventListener('scroll', handleScroll);
            };
        } else {
            // If user chose "don't show", show banner after 3 seconds
            const bannerTimer = setTimeout(() => {
                setShowBanner(true);
                setBannerMinimized(bannerMinimized === 'true');
            }, 3000);

            return () => clearTimeout(bannerTimer);
        }
    }, []);

    const handleModalClose = () => {
        setShowModal(false);
        
        // Show banner after closing modal
        setTimeout(() => {
            setShowBanner(true);
        }, 2000);
    };

    const handleModalDontShow = () => {
        setShowModal(false);
        localStorage.setItem(STORAGE_KEY, 'true');
        
        // Show banner after choosing "don't show"
        setTimeout(() => {
            setShowBanner(true);
        }, 2000);
    };

    const handleModalSupport = () => {
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
            {/* Modal Popup - Device-Adaptive */}
            {showModal && (
                <div className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 ${isLowEnd ? 'animate-fadeIn' : 'animate-fadeIn'}`}>
                    {/* Backdrop - Simple on low-end, blur on high-end */}
                    <div 
                        className={`absolute inset-0 bg-black/60 ${isLowEnd ? '' : 'backdrop-blur-sm'}`}
                        onClick={handleModalClose}
                    />
                    
                    {/* Modal Content - Simplified animations on low-end */}
                    <div className={`relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden ${isLowEnd ? 'animate-fadeIn' : 'animate-slideUp'}`}>
                        {/* Gradient Header - Dynamic based on variation */}
                        <div className={`bg-gradient-to-r ${modalVariation.gradient} p-6 text-center`}>
                            <div className={`w-16 h-16 mx-auto mb-4 bg-white/20 ${isLowEnd ? '' : 'backdrop-blur-sm'} rounded-full flex items-center justify-center ${isLowEnd ? '' : 'animate-bounce'}`}>
                                <span className="text-4xl">{modalVariation.emoji}</span>
                            </div>
                            <h2 className="text-2xl font-bold text-white mb-2">
                                {modalVariation.title}
                            </h2>
                            <p className="text-white/90 text-sm">
                                {modalVariation.subtitle}
                            </p>
                        </div>

                        {/* Body */}
                        <div className="p-6">
                            <p className="text-gray-700 dark:text-gray-300 text-center mb-4 leading-relaxed">
                                {modalVariation.message1}
                            </p>
                            <p className="text-gray-700 dark:text-gray-300 text-center mb-3 font-medium">
                                {modalVariation.message2}
                            </p>

                            {/* Features List */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 mb-4">
                                <ul className="space-y-2">
                                    {modalVariation.features.map((feature, index) => (
                                        <li key={index} className="text-gray-700 dark:text-gray-300 text-sm flex items-start gap-2">
                                            <span className="flex-shrink-0 mt-0.5">{feature.split(' ')[0]}</span>
                                            <span>{feature.substring(feature.indexOf(' ') + 1)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <p className="text-gray-600 dark:text-gray-400 text-center text-sm mb-6 italic">
                                {modalVariation.footer}
                            </p>

                            {/* Buttons - Simplified hover on low-end */}
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={handleModalSupport}
                                    className={`w-full bg-gradient-to-r ${modalVariation.gradient} hover:opacity-90 text-white font-semibold py-3 px-6 rounded-xl transition-opacity duration-300 ${isLowEnd ? '' : 'transform hover:scale-105'} shadow-lg`}
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        <span>{modalVariation.emoji}</span>
                                        <span>Traktir Kopi Sekarang</span>
                                    </span>
                                </button>
                                
                                <button
                                    onClick={handleModalClose}
                                    className={`w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium py-3 px-6 rounded-xl transition-colors duration-300`}
                                >
                                    Lain Kali Aja 😅
                                </button>

                                <button
                                    onClick={handleModalDontShow}
                                    className="w-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-sm py-2 transition-colors"
                                >
                                    Jangan Tampilkan Lagi
                                </button>
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-4">
                                💝 Terima kasih atas pengertiannya
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Banner - Persistent, Device-Adaptive */}
            {showBanner && (
                <div className={`fixed bottom-6 right-6 z-[9998] transition-all duration-300 ${
                    bannerMinimized ? 'w-14' : 'w-80'
                }`} style={{ bottom: '5.5rem' }}> {/* Adjusted to avoid FeedbackWidget */}
                    {bannerMinimized ? (
                        /* Minimized State - Simplified on low-end */
                        <button
                            onClick={handleBannerMaximize}
                            className={`w-14 h-14 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full shadow-lg transition-all duration-300 ${isLowEnd ? '' : 'hover:shadow-xl transform hover:scale-110'} flex items-center justify-center text-2xl ${isLowEnd ? '' : 'animate-bounce'}`}
                            title="Traktir Kopi Yuk!"
                        >
                            ☕
                        </button>
                    ) : (
                        /* Expanded State - Simplified animations on low-end */
                        <div className={`bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-orange-200 dark:border-orange-900/30 ${isLowEnd ? 'animate-fadeIn' : 'animate-slideInRight'}`}>
                            {/* Header */}
                            <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className={`text-2xl ${isLowEnd ? '' : 'animate-bounce'}`}>☕</span>
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
                                <p className="text-gray-700 dark:text-gray-300 text-sm mb-3 leading-relaxed font-medium">
                                    Bantu kami untuk:
                                </p>
                                
                                <ul className="text-gray-600 dark:text-gray-400 text-xs space-y-1.5 mb-4">
                                    <li className="flex items-start gap-1.5">
                                        <span>🎥</span>
                                        <span>Tambah CCTV di lokasi strategis</span>
                                    </li>
                                    <li className="flex items-start gap-1.5">
                                        <span>⚡</span>
                                        <span>Jaga server tetap nyala 24/7</span>
                                    </li>
                                </ul>

                                <button
                                    onClick={handleBannerSupport}
                                    className={`w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-all duration-300 ${isLowEnd ? '' : 'transform hover:scale-105'} shadow-md text-sm`}
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
