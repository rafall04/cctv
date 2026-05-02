/*
Purpose: Render configured third-party ad banner placeholders and inject ad network scripts.
Caller: Legacy/public ad placements.
Deps: React effect/ref and browser document script APIs.
MainFuncs: AdBanner.
SideEffects: Mutates ad container DOM by appending third-party script tags.
*/

import { useEffect, useRef } from 'react';

/**
 * AdBanner Component
 * Menampilkan iklan dari berbagai ad network
 * 
 * Props:
 * - network: 'medianet' | 'adsterra' | 'propellerads' | 'custom'
 * - position: 'top' | 'bottom' | 'sidebar' | 'inline'
 * - size: 'leaderboard' | 'rectangle' | 'skyscraper' | 'mobile'
 */
function AdBanner({ 
    network = 'medianet', 
    position = 'top',
    size = 'leaderboard',
    className = ''
}) {
    const adContainerRef = useRef(null);

    // Ad sizes configuration
    const adSizes = {
        leaderboard: { width: 728, height: 90 },    // Desktop horizontal
        rectangle: { width: 300, height: 250 },     // Medium rectangle
        skyscraper: { width: 160, height: 600 },    // Sidebar vertical
        mobile: { width: 320, height: 100 },        // Mobile banner
    };

    const currentSize = adSizes[size] || adSizes.leaderboard;

    useEffect(() => {
        const container = adContainerRef.current;
        if (!container) return;

        const loadMediaNetAd = () => {
            const script = document.createElement('script');
            script.innerHTML = `
                window._mNHandle = window._mNHandle || {};
                window._mNHandle.queue = window._mNHandle.queue || [];
                medianet_width = "${currentSize.width}";
                medianet_height = "${currentSize.height}";
                medianet_crid = "YOUR_MEDIA_NET_CRID";
                medianet_versionId = "3111299";
            `;
            container.appendChild(script);

            const adScript = document.createElement('script');
            adScript.src = '//contextual.media.net/nmedianet.js?cid=YOUR_MEDIA_NET_CID';
            adScript.async = true;
            container.appendChild(adScript);
        };

        const loadAdsterraAd = () => {
            const script = document.createElement('script');
            script.type = 'text/javascript';
            script.innerHTML = `
                atOptions = {
                    'key' : 'YOUR_ADSTERRA_KEY',
                    'format' : 'iframe',
                    'height' : ${currentSize.height},
                    'width' : ${currentSize.width},
                    'params' : {}
                };
            `;
            container.appendChild(script);

            const adScript = document.createElement('script');
            adScript.type = 'text/javascript';
            adScript.src = '//www.topcreativeformat.com/YOUR_ADSTERRA_ID/invoke.js';
            adScript.async = true;
            container.appendChild(adScript);
        };

        const loadPropellerAd = () => {
            const script = document.createElement('script');
            script.async = true;
            script.setAttribute('data-cfasync', 'false');
            script.src = '//pl123456.puhtml.com/YOUR_ZONE_ID.js';
            container.appendChild(script);
        };

        // Load ad script based on network
        const loadAd = () => {
            switch (network) {
                case 'medianet':
                    loadMediaNetAd();
                    break;
                case 'adsterra':
                    loadAdsterraAd();
                    break;
                case 'propellerads':
                    loadPropellerAd();
                    break;
                default:
                    break;
            }
        };

        loadAd();

        // Cleanup
        return () => {
            container.innerHTML = '';
        };
    }, [currentSize.height, currentSize.width, network]);

    return (
        <div 
            className={`ad-banner ad-${position} ${className}`}
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
                overflow: 'hidden'
            }}
        >
            <div ref={adContainerRef} style={{ width: '100%', textAlign: 'center' }}>
                {/* Ad akan dimuat di sini */}
            </div>
        </div>
    );
}

export default AdBanner;
