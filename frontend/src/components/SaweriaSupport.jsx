import { useState, useEffect, useMemo } from 'react';
import { detectDeviceTier } from '../utils/deviceDetector';
import { getPublicSaweriaConfig } from '../services/saweriaService';

/**
 * Saweria Support Component - Optimized for Low-End Devices
 * 
 * Features:
 * 1. Modal popup on every visit with random variations (user-friendly)
 * 2. Floating banner (minimizable, persistent)
 * 3. Device-adaptive animations (disabled on low-end)
 * 4. "Don't show again" option for users who don't want to see it
 * 5. Dynamic link from admin settings
 * 
 * Performance optimizations:
 * - Detect device tier and disable heavy animations on low-end
 * - Use simple fade instead of backdrop blur on low-end
 * - Memoize modal variation to prevent re-renders
 * - Use CSS transforms for better performance
 * 
 * Usage:
 * <SaweriaSupport />
 */

const STORAGE_KEY = 'saweria_dont_show';
const BANNER_MINIMIZED_KEY = 'saweria_banner_minimized';

// Icon components for modal variations - Standardized sizes
const CoffeeIcon = () => (
    <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 8h1a4 4 0 010 8h-1" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 4v1M10 4v1M14 4v1" />
    </svg>
);

const CameraIcon = () => (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
    </svg>
);

const RocketIcon = () => (
    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
);

const BoltIcon = () => (
    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
);

// Modal variations for variety (random selection)
const MODAL_VARIATIONS = [
    {
        icon: <CoffeeIcon />,
        title: 'Traktir Kopi Dong!',
        subtitle: 'Biar semangat maintain server & kamera 24/7',
        message1: 'Halo! Senang banget kamu pakai layanan CCTV gratis ini.',
        message2: 'Dukungan kamu akan membantu kami untuk:',
        features: [
            { icon: <CameraIcon />, text: 'Menambah titik CCTV di lokasi strategis' },
            { icon: <BoltIcon />, text: 'Upgrade server biar makin cepat' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>, text: 'Maintenance rutin semua kamera' }
        ],
        footer: 'Seikhlasnya aja, berapapun sangat berarti!',
        gradient: 'from-orange-500 via-amber-500 to-yellow-500',
    },
    {
        icon: <CameraIcon />,
        title: 'Bantu Tambah CCTV Yuk!',
        subtitle: 'Lebih banyak kamera = lebih aman',
        message1: 'Saat ini ada beberapa lokasi strategis yang belum terpasang CCTV.',
        message2: 'Dengan dukungan kamu, kami bisa:',
        features: [
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" /><circle cx="12" cy="11" r="3" /></svg>, text: 'Pasang CCTV di titik-titik penting' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>, text: 'Expand coverage area monitoring' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>, text: 'Tingkatkan keamanan lingkungan' }
        ],
        footer: 'Yuk bantu wujudkan! Nominal berapa aja sangat membantu.',
        gradient: 'from-blue-500 via-cyan-500 to-teal-500',
    },
    {
        icon: <RocketIcon />,
        title: 'Mari Berkembang Bersama!',
        subtitle: 'Dari kamu, untuk lingkungan lebih aman',
        message1: 'Terima kasih sudah pakai layanan CCTV gratis kami!',
        message2: 'Dukungan kamu akan kami gunakan untuk:',
        features: [
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" /></svg>, text: 'Beli & pasang CCTV di lokasi baru' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>, text: 'Upgrade bandwidth untuk streaming HD' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>, text: 'Bayar listrik & internet 24/7' }
        ],
        footer: 'Seikhlasnya dari hati, sangat berarti buat kami!',
        gradient: 'from-purple-500 via-violet-500 to-indigo-500',
    },
    {
        icon: <BoltIcon />,
        title: 'Keep The Server Running!',
        subtitle: 'Plus tambah kamera di lokasi strategis',
        message1: 'Server ini nyala 24/7 biar kamu bisa pantau CCTV kapan aja!',
        message2: 'Bantu kami untuk:',
        features: [
            { icon: <CameraIcon />, text: 'Tambah kamera di area yang belum ter-cover' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>, text: 'Maintain server & bandwidth' },
            { icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>, text: 'Service rutin semua perangkat' }
        ],
        footer: 'Traktir kopi kami dong! Yang penting dari hati.',
        gradient: 'from-pink-500 via-rose-500 to-red-500',
    },
];

export default function SaweriaSupport() {
    const [showModal, setShowModal] = useState(false);
    const [showBanner, setShowBanner] = useState(false);
    const [bannerMinimized, setBannerMinimized] = useState(false);
    const [saweriaLink, setSaweriaLink] = useState('https://saweria.co/raflialdi'); // Default fallback
    const [isEnabled, setIsEnabled] = useState(true);
    const [configLoaded, setConfigLoaded] = useState(false);
    
    // Detect device tier once and memoize
    const deviceTier = useMemo(() => detectDeviceTier(), []);
    const isLowEnd = deviceTier === 'low';
    
    // Select random modal variation once and memoize
    const modalVariation = useMemo(() => {
        const randomIndex = Math.floor(Math.random() * MODAL_VARIATIONS.length);
        return MODAL_VARIATIONS[randomIndex];
    }, []);

    // Fetch Saweria config from API - only once on mount
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const response = await getPublicSaweriaConfig();
                if (response.success && response.data) {
                    setIsEnabled(response.data.enabled);
                    if (response.data.saweria_link) {
                        setSaweriaLink(response.data.saweria_link);
                    }
                }
            } catch (error) {
                console.error('Failed to fetch Saweria config:', error);
                // Keep default values on error
            } finally {
                setConfigLoaded(true);
            }
        };
        
        fetchConfig();
    }, []);

    useEffect(() => {
        // Wait for config to load
        if (!configLoaded) return;
        
        // Don't show anything if disabled
        if (!isEnabled) return;
        
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
    }, [configLoaded, isEnabled]);

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
        window.open(saweriaLink, '_blank', 'noopener,noreferrer');
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
        window.open(saweriaLink, '_blank', 'noopener,noreferrer');
    };

    // Don't render if disabled from admin
    if (!isEnabled) {
        return null;
    }

    return (
        <>
            {/* Modal Popup - Device-Adaptive */}
            {showModal && (
                <div className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 ${isLowEnd ? '' : 'animate-fadeIn'}`}>
                    {/* Backdrop - No blur on low-end */}
                    <div 
                        className={`absolute inset-0 ${isLowEnd ? 'bg-black/70' : 'bg-black/60 backdrop-blur-sm'}`}
                        onClick={handleModalClose}
                    />
                    
                    {/* Modal Content - Responsive with scroll */}
                    <div className={`relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto ${isLowEnd ? '' : 'animate-slideUp'}`}>
                        {/* Gradient Header - Responsive padding */}
                        <div className={`bg-gradient-to-r ${modalVariation.gradient} p-4 sm:p-6 text-center`}>
                            <div className={`w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 ${isLowEnd ? 'bg-white/30' : 'bg-white/20 backdrop-blur-sm'} rounded-full flex items-center justify-center text-white ${isLowEnd ? '' : 'animate-bounce'}`}>
                                {modalVariation.icon}
                            </div>
                            <h2 className="text-xl sm:text-2xl font-bold text-white mb-1.5 sm:mb-2">
                                {modalVariation.title}
                            </h2>
                            <p className="text-white/90 text-xs sm:text-sm">
                                {modalVariation.subtitle}
                            </p>
                        </div>

                        {/* Body - Responsive padding */}
                        <div className="p-4 sm:p-6">
                            <p className="text-gray-700 dark:text-gray-300 text-center mb-3 sm:mb-4 leading-relaxed text-sm">
                                {modalVariation.message1}
                            </p>
                            <p className="text-gray-700 dark:text-gray-300 text-center mb-2.5 sm:mb-3 font-medium text-sm">
                                {modalVariation.message2}
                            </p>

                            {/* Features List - Compact spacing */}
                            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 sm:p-4 mb-3 sm:mb-4">
                                <ul className="space-y-2">
                                    {modalVariation.features.map((feature, index) => (
                                        <li key={index} className="text-gray-700 dark:text-gray-300 text-xs sm:text-sm flex items-center gap-2.5">
                                            <span className="flex-shrink-0 text-gray-500 dark:text-gray-400">{feature.icon}</span>
                                            <span>{feature.text}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <p className="text-gray-600 dark:text-gray-400 text-center text-xs sm:text-sm mb-4 sm:mb-6 italic">
                                {modalVariation.footer}
                            </p>

                            {/* Buttons - Compact spacing */}
                            <div className="flex flex-col gap-2.5">
                                <button
                                    onClick={handleModalSupport}
                                    className={`w-full bg-gradient-to-r ${modalVariation.gradient} hover:opacity-90 text-white font-semibold py-2.5 sm:py-3 px-4 sm:px-6 rounded-xl transition-opacity shadow-lg text-sm`}
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        <CoffeeIcon />
                                        <span>Traktir Kopi Sekarang</span>
                                    </span>
                                </button>
                                
                                <button
                                    onClick={handleModalClose}
                                    className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium py-2.5 sm:py-3 px-4 sm:px-6 rounded-xl transition-colors text-sm"
                                >
                                    Lain Kali Aja
                                </button>

                                <button
                                    onClick={handleModalDontShow}
                                    className="w-full text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 text-xs sm:text-sm py-1.5 sm:py-2 transition-colors"
                                >
                                    Jangan Tampilkan Lagi
                                </button>
                            </div>

                            <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-3 sm:mt-4 flex items-center justify-center gap-1.5">
                                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-pink-500" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                                <span>Terima kasih atas pengertiannya</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Banner - Persistent, Device-Adaptive */}
            {showBanner && (
                <div className={`fixed bottom-6 right-6 z-[9998] transition-all ${
                    bannerMinimized ? 'w-14' : 'w-80'
                }`} style={{ bottom: '5.5rem' }}>
                    {bannerMinimized ? (
                        /* Minimized State - No animations on low-end */
                        <button
                            onClick={handleBannerMaximize}
                            className={`w-14 h-14 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white rounded-full shadow-lg transition-colors flex items-center justify-center ${isLowEnd ? '' : 'animate-bounce'}`}
                            title="Traktir Kopi Yuk!"
                        >
                            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18 8h1a4 4 0 010 8h-1" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 4v1M10 4v1M14 4v1" />
                            </svg>
                        </button>
                    ) : (
                        /* Expanded State - No animations on low-end */
                        <div className={`bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-orange-200 dark:border-orange-900/30 ${isLowEnd ? '' : 'animate-slideInRight'}`}>
                            {/* Header */}
                            <div className="bg-gradient-to-r from-orange-500 to-amber-500 p-4 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className={`${isLowEnd ? '' : 'animate-bounce'}`}>
                                        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 8h1a4 4 0 010 8h-1" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4v1M10 4v1M14 4v1" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h3 className="text-white font-bold text-sm">
                                            Traktir Kopi Yuk!
                                        </h3>
                                        <p className="text-white/80 text-xs">
                                            Seikhlasnya aja
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
                                
                                <ul className="text-gray-600 dark:text-gray-400 text-xs space-y-2 mb-4">
                                    <li className="flex items-center gap-2">
                                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                        </svg>
                                        <span>Tambah CCTV di lokasi strategis</span>
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                        <span>Jaga server tetap nyala 24/7</span>
                                    </li>
                                </ul>

                                <button
                                    onClick={handleBannerSupport}
                                    className={`w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors shadow-md text-sm`}
                                >
                                    <span className="flex items-center justify-center gap-2">
                                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 8h1a4 4 0 010 8h-1" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 4v1M10 4v1M14 4v1" />
                                        </svg>
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
