import { useEffect, useRef, useState } from 'react';
import { monetagService } from '../services/monetagService';

/**
 * Monetag Ads Component
 * Supports multiple ad formats: Popunder, Native, Banner, Push Notifications
 * 
 * Config is now loaded from database via API (managed from admin panel)
 */

/**
 * Monetag Popunder Component
 * Muncul 1x per user per 24 jam, tidak mengganggu UX
 */
export function MonetagPopunder() {
    const scriptLoaded = useRef(false);
    const [config, setConfig] = useState(null);

    useEffect(() => {
        // Load config from API
        monetagService.getPublicMonetagConfig()
            .then(response => {
                if (response.success) {
                    setConfig(response.data);
                }
            })
            .catch(error => {
                console.error('[Monetag] Failed to load config:', error);
            });
    }, []);

    useEffect(() => {
        if (!config) return;
        if (!config.popunder.enabled) return;
        if (scriptLoaded.current) return;

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${config.popunder.zoneId}',
                'format' : 'iframe',
                'height' : 90,
                'width' : 728,
                'params' : {}
            };
        `;
        document.body.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `http://www.topcreativeformat.com/${config.popunder.zoneId}/invoke.js`;
        invokeScript.async = true;
        document.body.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            // Cleanup
            if (script.parentNode) script.parentNode.removeChild(script);
            if (invokeScript.parentNode) invokeScript.parentNode.removeChild(invokeScript);
        };
    }, [config]);

    return null; // Popunder tidak memerlukan UI element
}

/**
 * Monetag Native Banner Component
 * Banner yang blend dengan konten website
 */
export function MonetagNativeBanner({ className = '' }) {
    const containerRef = useRef(null);
    const scriptLoaded = useRef(false);
    const [config, setConfig] = useState(null);

    useEffect(() => {
        // Load config from API
        monetagService.getPublicMonetagConfig()
            .then(response => {
                if (response.success) {
                    setConfig(response.data);
                }
            })
            .catch(error => {
                console.error('[Monetag] Failed to load config:', error);
            });
    }, []);

    useEffect(() => {
        if (!config) return;
        if (!config.nativeBanner.enabled) return;
        if (!containerRef.current) return;
        if (scriptLoaded.current) return;

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${config.nativeBanner.zoneId}',
                'format' : 'iframe',
                'height' : 250,
                'width' : 300,
                'params' : {}
            };
        `;
        containerRef.current.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `http://www.topcreativeformat.com/${config.nativeBanner.zoneId}/invoke.js`;
        invokeScript.async = true;
        containerRef.current.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, [config]);

    if (!config || !config.nativeBanner.enabled) return null;

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
    const [config, setConfig] = useState(null);

    const sizes = {
        leaderboard: { width: 728, height: 90 },
        rectangle: { width: 300, height: 250 },
        skyscraper: { width: 160, height: 600 },
        mobile: { width: 320, height: 100 },
    };

    const currentSize = sizes[size] || sizes.leaderboard;

    useEffect(() => {
        // Load config from API
        monetagService.getPublicMonetagConfig()
            .then(response => {
                if (response.success) {
                    setConfig(response.data);
                }
            })
            .catch(error => {
                console.error('[Monetag] Failed to load config:', error);
            });
    }, []);

    useEffect(() => {
        if (!config) return;
        if (!config.directLink.enabled) return;
        if (!containerRef.current) return;
        if (scriptLoaded.current) return;

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${config.directLink.zoneId}',
                'format' : 'iframe',
                'height' : ${currentSize.height},
                'width' : ${currentSize.width},
                'params' : {}
            };
        `;
        containerRef.current.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `http://www.topcreativeformat.com/${config.directLink.zoneId}/invoke.js`;
        invokeScript.async = true;
        containerRef.current.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            if (containerRef.current) {
                containerRef.current.innerHTML = '';
            }
        };
    }, [config, currentSize.height, currentSize.width]);

    if (!config || !config.directLink.enabled) return null;

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
    const [config, setConfig] = useState(null);

    useEffect(() => {
        // Load config from API
        monetagService.getPublicMonetagConfig()
            .then(response => {
                if (response.success) {
                    setConfig(response.data);
                }
            })
            .catch(error => {
                console.error('[Monetag] Failed to load config:', error);
            });
    }, []);

    useEffect(() => {
        if (!config) return;
        if (!config.pushNotifications.enabled) return;
        if (initialized.current) return;

        // Check if service worker is supported
        if (!('serviceWorker' in navigator)) {
            console.warn('[Monetag] Service Worker not supported');
            return;
        }

        // Register service worker
        navigator.serviceWorker.register(config.pushNotifications.swPath)
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
                        ${config.pushNotifications.zoneId},
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
    }, [config]);

    return null; // Push notifications tidak memerlukan UI element
}

/**
 * Monetag Social Bar
 * Sticky bar at bottom of page
 */
export function MonetagSocialBar() {
    const scriptLoaded = useRef(false);
    const [config, setConfig] = useState(null);

    useEffect(() => {
        // Load config from API
        monetagService.getPublicMonetagConfig()
            .then(response => {
                if (response.success) {
                    setConfig(response.data);
                }
            })
            .catch(error => {
                console.error('[Monetag] Failed to load config:', error);
            });
    }, []);

    useEffect(() => {
        if (!config) return;
        if (!config.socialBar.enabled) return;
        if (scriptLoaded.current) return;

        const script = document.createElement('script');
        script.type = 'text/javascript';
        script.innerHTML = `
            atOptions = {
                'key' : '${config.socialBar.zoneId}',
                'format' : 'iframe',
                'height' : 60,
                'width' : 468,
                'params' : {}
            };
        `;
        document.body.appendChild(script);

        const invokeScript = document.createElement('script');
        invokeScript.type = 'text/javascript';
        invokeScript.src = `http://www.topcreativeformat.com/${config.socialBar.zoneId}/invoke.js`;
        invokeScript.async = true;
        document.body.appendChild(invokeScript);

        scriptLoaded.current = true;

        return () => {
            if (script.parentNode) script.parentNode.removeChild(script);
            if (invokeScript.parentNode) invokeScript.parentNode.removeChild(invokeScript);
        };
    }, [config]);

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
