import { useEffect, useRef } from 'react';

/**
 * Monetag Ads Component
 * Supports multiple ad formats: Popunder, Native, Banner, Push Notifications
 * 
 * SETUP INSTRUCTIONS:
 * 1. Daftar di https://www.monetag.com/
 * 2. Tambahkan website Anda
 * 3. Buat ad zones untuk setiap format
 * 4. Copy zone IDs dan update di sini
 */

// ============================================
// MONETAG CONFIGURATION
// ============================================
// Ganti dengan Zone IDs dari Monetag dashboard Anda
const MONETAG_CONFIG = {
    // Popunder - Muncul 1x per user per 24 jam (CPM tertinggi)
    // RECOMMENDED: Mulai dengan ini dulu!
    popunder: {
        enabled: true,
        zoneId: 'YOUR_POPUNDER_ZONE_ID', // Contoh: '8360606'
    },
    
    // Native Banner - Iklan yang blend dengan konten
    // OPTIONAL: Aktifkan jika mau tambah revenue
    nativeBanner: {
        enabled: false, // Set true jika mau gunakan
        zoneId: 'YOUR_NATIVE_ZONE_ID', // Contoh: '8360607'
    },
    
    // Direct Link - Banner ads
    // OPTIONAL: Jarang digunakan
    directLink: {
        enabled: false, // Set true jika mau gunakan
        zoneId: 'YOUR_DIRECT_LINK_ZONE_ID', // Contoh: '8360608'
    },
    
    // Push Notifications - Requires service worker
    // OPTIONAL: Setup lebih kompleks, aktifkan nanti jika perlu
    pushNotifications: {
        enabled: false, // Set true jika mau gunakan
        zoneId: 'YOUR_PUSH_ZONE_ID', // Contoh: '8360609'
        swPath: '/sw.js', // Service worker path
    },
    
    // Social Bar - Sticky bar at bottom
    // OPTIONAL: Bisa mengganggu UX
    socialBar: {
        enabled: false, // Set true jika ingin gunakan
        zoneId: 'YOUR_SOCIAL_BAR_ZONE_ID',
    }
};

/**
 * Monetag Popunder Component
 * Muncul 1x per user per 24 jam, tidak mengganggu UX
 */
export function MonetagPopunder() {
    const scriptLoaded = useRef(false);

    useEffect(() => {
        if (!MONETAG_CONFIG.popunder.enabled) return;
        if (scriptLoaded.current) return;
        if (MONETAG_CONFIG.popunder.zoneId === 'YOUR_POPUNDER_ZONE_ID') {
            console.warn('[Monetag] Popunder zone ID not configured');
            return;
        }

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${MONETAG_CONFIG.popunder.zoneId}',
                'format' : 'iframe',
                'height' : 90,
                'width' : 728,
                'params' : {}
            };
        `;
        document.body.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `//www.topcreativeformat.com/${MONETAG_CONFIG.popunder.zoneId}/invoke.js`;
        invokeScript.async = true;
        document.body.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            // Cleanup
            if (script.parentNode) script.parentNode.removeChild(script);
            if (invokeScript.parentNode) invokeScript.parentNode.removeChild(invokeScript);
        };
    }, []);

    return null; // Popunder tidak memerlukan UI element
}

/**
 * Monetag Native Banner Component
 * Banner yang blend dengan konten website
 */
export function MonetagNativeBanner({ className = '' }) {
    const containerRef = useRef(null);
    const scriptLoaded = useRef(false);

    useEffect(() => {
        if (!MONETAG_CONFIG.nativeBanner.enabled) return;
        if (!containerRef.current) return;
        if (scriptLoaded.current) return;
        if (MONETAG_CONFIG.nativeBanner.zoneId === 'YOUR_NATIVE_ZONE_ID') {
            console.warn('[Monetag] Native banner zone ID not configured');
            return;
        }

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${MONETAG_CONFIG.nativeBanner.zoneId}',
                'format' : 'iframe',
                'height' : 250,
                'width' : 300,
                'params' : {}
            };
        `;
        containerRef.current.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `//www.topcreativeformat.com/${MONETAG_CONFIG.nativeBanner.zoneId}/invoke.js`;
        invokeScript.async = true;
        containerRef.current.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, []);

    if (!MONETAG_CONFIG.nativeBanner.enabled) return null;

    return (
        <div 
            ref={containerRef}
            className={`monetag-native-banner ${className}`}
            style={{
                minHeight: '250px',
                width: '100%',
                maxWidth: '300px',
                margin: '0 auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.05)',
                borderRadius: '8px',
                overflow: 'hidden'
            }}
        />
    );
}

/**
 * Monetag Direct Link Banner
 * Standard banner ads
 */
export function MonetagBanner({ size = 'leaderboard', className = '' }) {
    const containerRef = useRef(null);
    const scriptLoaded = useRef(false);

    const sizes = {
        leaderboard: { width: 728, height: 90 },
        rectangle: { width: 300, height: 250 },
        skyscraper: { width: 160, height: 600 },
        mobile: { width: 320, height: 100 },
    };

    const currentSize = sizes[size] || sizes.leaderboard;

    useEffect(() => {
        if (!MONETAG_CONFIG.directLink.enabled) return;
        if (!containerRef.current) return;
        if (scriptLoaded.current) return;
        if (MONETAG_CONFIG.directLink.zoneId === 'YOUR_DIRECT_LINK_ZONE_ID') {
            console.warn('[Monetag] Direct link zone ID not configured');
            return;
        }

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${MONETAG_CONFIG.directLink.zoneId}',
                'format' : 'iframe',
                'height' : ${currentSize.height},
                'width' : ${currentSize.width},
                'params' : {}
            };
        `;
        containerRef.current.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `//www.topcreativeformat.com/${MONETAG_CONFIG.directLink.zoneId}/invoke.js`;
        invokeScript.async = true;
        containerRef.current.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, [currentSize.height, currentSize.width]);

    if (!MONETAG_CONFIG.directLink.enabled) return null;

    return (
        <div 
            ref={containerRef}
            className={`monetag-banner ${className}`}
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
        />
    );
}

/**
 * Monetag Push Notifications
 * Requires service worker (sw.js)
 */
export function MonetagPushNotifications() {
    const initialized = useRef(false);

    useEffect(() => {
        if (!MONETAG_CONFIG.pushNotifications.enabled) return;
        if (initialized.current) return;
        if (MONETAG_CONFIG.pushNotifications.zoneId === 'YOUR_PUSH_ZONE_ID') {
            console.warn('[Monetag] Push notifications zone ID not configured');
            return;
        }

        // Check if service worker is supported
        if (!('serviceWorker' in navigator)) {
            console.warn('[Monetag] Service Worker not supported');
            return;
        }

        // Register service worker
        navigator.serviceWorker.register(MONETAG_CONFIG.pushNotifications.swPath)
            .then(registration => {
                console.log('[Monetag] Service Worker registered:', registration);
                
                // Load Monetag push script
                const script = document.createElement('script');
                script.type = 'text/javascript';
                script.innerHTML = `
                    (function(s,u,z,p){
                        s.src=u,s.setAttribute('data-zone',z),p.appendChild(s);
                    })(
                        document.createElement('script'),
                        'https://inklinkor.com/tag.min.js',
                        ${MONETAG_CONFIG.pushNotifications.zoneId},
                        document.body||document.documentElement
                    )
                `;
                document.body.appendChild(script);
                
                initialized.current = true;
            })
            .catch(error => {
                console.error('[Monetag] Service Worker registration failed:', error);
            });

        return () => {
            // Cleanup if needed
        };
    }, []);

    return null; // Push notifications tidak memerlukan UI element
}

/**
 * Monetag Social Bar
 * Sticky bar at bottom of page
 */
export function MonetagSocialBar() {
    const scriptLoaded = useRef(false);

    useEffect(() => {
        if (!MONETAG_CONFIG.socialBar.enabled) return;
        if (scriptLoaded.current) return;
        if (MONETAG_CONFIG.socialBar.zoneId === 'YOUR_SOCIAL_BAR_ZONE_ID') {
            console.warn('[Monetag] Social bar zone ID not configured');
            return;
        }

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${MONETAG_CONFIG.socialBar.zoneId}',
                'format' : 'iframe',
                'height' : 60,
                'width' : 468,
                'params' : {}
            };
        `;
        document.body.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `//www.topcreativeformat.com/${MONETAG_CONFIG.socialBar.zoneId}/invoke.js`;
        invokeScript.async = true;
        document.body.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            if (script.parentNode) script.parentNode.removeChild(script);
            if (invokeScript.parentNode) invokeScript.parentNode.removeChild(invokeScript);
        };
    }, []);

    return null;
}

/**
 * All-in-One Monetag Component
 * Loads all enabled ad formats
 */
export function MonetagAds() {
    return (
        <>
            <MonetagPopunder />
            <MonetagPushNotifications />
            <MonetagSocialBar />
        </>
    );
}

export default MonetagAds;
