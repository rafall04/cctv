import { useEffect, useRef } from 'react';

/**
 * Monetag Video Ad Component
 * Native Banner yang muncul HANYA saat video sedang play
 * Digunakan di modal video dan multi-view
 * 
 * Props:
 * - isPlaying: boolean - Apakah video sedang play
 * - className: string - Custom className (optional)
 * - size: 'small' | 'medium' | 'large' - Ukuran banner (default: 'medium')
 */

// Import config dari MonetagAds
const MONETAG_CONFIG = {
    nativeBanner: {
        enabled: true,
        zoneId: 'YOUR_NATIVE_ZONE_ID', // Akan di-sync dengan MonetagAds.jsx
    }
};

function MonetagVideoAd({ isPlaying = false, className = '', size = 'medium' }) {
    const containerRef = useRef(null);
    const scriptLoadedRef = useRef(false);
    const adLoadedRef = useRef(false);

    // Size configurations
    const sizes = {
        small: { width: 300, height: 250, label: 'Small' },
        medium: { width: 468, height: 60, label: 'Medium Banner' },
        large: { width: 728, height: 90, label: 'Large Banner' },
    };

    const currentSize = sizes[size] || sizes.medium;

    useEffect(() => {
        // Hanya load jika:
        // 1. Native banner enabled
        // 2. Video sedang play
        // 3. Zone ID sudah dikonfigurasi
        // 4. Belum pernah di-load
        if (!MONETAG_CONFIG.nativeBanner.enabled) return;
        if (!isPlaying) return;
        if (MONETAG_CONFIG.nativeBanner.zoneId === 'YOUR_NATIVE_ZONE_ID') {
            console.warn('[Monetag Video Ad] Native banner zone ID not configured');
            return;
        }
        if (!containerRef.current) return;
        if (scriptLoadedRef.current) return;

        // Load Monetag script
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${MONETAG_CONFIG.nativeBanner.zoneId}',
                'format' : 'iframe',
                'height' : ${currentSize.height},
                'width' : ${currentSize.width},
                'params' : {}
            };
        `;
        containerRef.current.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `//www.topcreativeformat.com/${MONETAG_CONFIG.nativeBanner.zoneId}/invoke.js`;
        invokeScript.async = true;
        invokeScript.onload = () => {
            adLoadedRef.current = true;
        };
        invokeScript.onerror = () => {
            console.error('[Monetag Video Ad] Failed to load ad script');
        };
        containerRef.current.appendChild(invokeScript);

        scriptLoadedRef.current = true;

        // Cleanup function
        return () => {
            if (containerRef.current) {
                // Clear container content
                containerRef.current.innerHTML = '';
            }
            scriptLoadedRef.current = false;
            adLoadedRef.current = false;
        };
    }, [isPlaying, currentSize.height, currentSize.width]);

    // Jangan render jika:
    // 1. Native banner disabled
    // 2. Video tidak play
    // 3. Zone ID belum dikonfigurasi
    if (!MONETAG_CONFIG.nativeBanner.enabled) return null;
    if (!isPlaying) return null;
    if (MONETAG_CONFIG.nativeBanner.zoneId === 'YOUR_NATIVE_ZONE_ID') return null;

    return (
        <div className={`monetag-video-ad ${className}`}>
            {/* Label "Advertisement" */}
            <div className="text-center mb-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    Advertisement
                </span>
            </div>

            {/* Ad Container */}
            <div 
                ref={containerRef}
                className="monetag-video-ad-container"
                style={{
                    minHeight: `${currentSize.height}px`,
                    width: '100%',
                    maxWidth: `${currentSize.width}px`,
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.05)',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                }}
            >
                {/* Loading placeholder - shown until ad loads */}
                {!adLoadedRef.current && (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-gray-400 text-xs">
                            Loading ad...
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default MonetagVideoAd;
