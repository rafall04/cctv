import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { brandingService } from '../services/brandingService';

const BrandingContext = createContext();

export function BrandingProvider({ children }) {
    const [branding, setBranding] = useState({
        company_name: 'RAF NET',
        company_tagline: 'CCTV Bojonegoro Online',
        company_description: 'RAF NET melayani pemasangan WiFi dan CCTV di wilayah Bojonegoro.',
        city_name: 'Bojonegoro',
        province_name: 'Jawa Timur',
        hero_title: 'Pantau CCTV Bojonegoro Secara Real-Time',
        hero_subtitle: 'Pantau keamanan wilayah secara real-time.',
        footer_text: 'Layanan pemantauan CCTV publik',
        copyright_text: 'Penyedia Internet & CCTV',
        meta_title: 'CCTV Online',
        meta_description: 'Pantau CCTV secara online',
        meta_keywords: 'cctv online',
        logo_text: 'R',
        primary_color: '#0ea5e9',
        show_powered_by: 'true',
        watermark_enabled: 'true',
        watermark_text: '',
        watermark_position: 'bottom-right',
        watermark_opacity: '0.9',
    });
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    const updateMetaTag = useCallback((name, content, attribute = 'name') => {
        if (!content) return;
        
        let element = document.querySelector(`meta[${attribute}="${name}"]`);
        if (element) {
            element.setAttribute('content', content);
        } else {
            element = document.createElement('meta');
            element.setAttribute(attribute, name);
            element.setAttribute('content', content);
            document.head.appendChild(element);
        }
    }, []);

    const loadBranding = useCallback(async () => {
        if (import.meta.env.MODE === 'test') {
            if (mountedRef.current) {
                setLoading(false);
            }
            return;
        }

        try {
            const data = await brandingService.getPublicBranding();
            if (!mountedRef.current) {
                return;
            }

            if (data) {
                setBranding(data);
                
                document.title = data.meta_title || 'CCTV Online';
                updateMetaTag('description', data.meta_description);
                updateMetaTag('keywords', data.meta_keywords);
                updateMetaTag('og:title', data.meta_title, 'property');
                updateMetaTag('og:description', data.meta_description, 'property');
                updateMetaTag('og:site_name', data.company_name, 'property');
                updateMetaTag('twitter:title', data.meta_title, 'property');
                updateMetaTag('twitter:description', data.meta_description, 'property');
                
                if (data.primary_color) {
                    document.documentElement.style.setProperty('--primary-color', data.primary_color);
                    
                    const hex = data.primary_color.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    document.documentElement.style.setProperty('--primary-color-rgb', `${r}, ${g}, ${b}`);
                }
            }
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [updateMetaTag]);

    useEffect(() => {
        mountedRef.current = true;
        loadBranding();
        return () => {
            mountedRef.current = false;
        };
    }, [loadBranding]);

    const refreshBranding = useCallback(async () => {
        if (mountedRef.current) {
            setLoading(true);
        }
        await loadBranding();
    }, [loadBranding]);

    return (
        <BrandingContext.Provider value={{ branding, loading, refreshBranding }}>
            {children}
        </BrandingContext.Provider>
    );
}

export function useBranding() {
    const context = useContext(BrandingContext);
    if (!context) {
        throw new Error('useBranding must be used within BrandingProvider');
    }
    return context;
}
