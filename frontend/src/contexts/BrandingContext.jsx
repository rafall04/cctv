import { createContext, useContext, useState, useEffect } from 'react';
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

    useEffect(() => {
        loadBranding();
    }, []);

    const loadBranding = async () => {
        try {
            const data = await brandingService.getPublicBranding();
            if (data) {
                setBranding(data);
                
                // Update document title
                document.title = data.meta_title || 'CCTV Online';
                
                // Update meta tags
                updateMetaTag('description', data.meta_description);
                updateMetaTag('keywords', data.meta_keywords);
                
                // Update Open Graph tags
                updateMetaTag('og:title', data.meta_title, 'property');
                updateMetaTag('og:description', data.meta_description, 'property');
                updateMetaTag('og:site_name', data.company_name, 'property');
                
                // Update Twitter tags
                updateMetaTag('twitter:title', data.meta_title, 'property');
                updateMetaTag('twitter:description', data.meta_description, 'property');
            }
        } catch (error) {
            console.error('Failed to load branding:', error);
        } finally {
            setLoading(false);
        }
    };

    const updateMetaTag = (name, content, attribute = 'name') => {
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
    };

    const refreshBranding = async () => {
        await loadBranding();
    };

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
