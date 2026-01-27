import { useEffect, useRef, useState } from 'react';
import { monetagService } from '../services/monetagService';

/**
 * Monetag Video Ad Component
 * Native Banner yang muncul HANYA saat video sedang play
 * Digunakan di modal video dan multi-view
 * 
 * Config is now loaded from database via API (managed from admin panel)
 * 
 * Props:
 * - isPlaying: boolean - Apakah video sedang play
 * - className: string - Custom className (optional)
 * - size: 'small' | 'medium' | 'large' - Ukuran banner (default: 'medium')
 */

function MonetagVideoAd({ isPlaying = false, className = '', size = 'medium' }) {
    const containerRef = useRef(null);
    const scriptLoadedRef = useRef(false);
    const adLoadedRef = useRef(false);
    const [config, setConfig] = useState(null);

    // Size configurations
    const sizes = {
        small: { width: 300, height: 250, label: 'Small' },
        medium: { width: 468, height: 60, label: 'Medium Banner' },
        large: { width: 728, height: 90, label: 'Large Banner' },
    };

    const currentSize = sizes[size] || sizes.medium;

    useEffect(() => {
        // Load config from API
        monetagService.getPublicMonetagConfig()
            .then(response => {
                if (response.success) {
                    setConfig(response.data);
                }
            })
            .catch(error => {
                console.error('[Monetag Video Ad] Failed to load config:', error);
            });
    }, []);

    useEffect(() => {
        // Hanya load jika:
        // 1. Config sudah loaded
        // 2. Native banner enabled
        // 3. Video sedang play
        // 4. Belum pernah di-load
        if (!config) return;
        if (!config.nativeBanner.enabled) return;
        if (!isPlaying) return;
        if (!containerRef.current) return;
        if (scriptLoadedRef.current) return;

        // Load Monetag script
        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${config.nativeBanner.zoneId}',
                'format' : 'iframe',
                'height' : ${currentSize.height},
                'width' : ${currentSize.width},
                'params' : {}
            };
        `;
        containerRef.current.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `//www.topcreativeformat.com/${config.nativeBanner.zoneId}/invoke.js`;
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
    }, [config, isPlaying, currentSize.height, currentSize.width]);

    // Jangan render jika:
    // 1. Config belum loaded
    // 2. Native banner disabled
    // 3. Video tidak play
    if (!config) return null;
    if (!config.nativeBanner.enabled) return null;
    if (!isPlaying) return null;

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
