/**
 * Update HTML meta tags dynamically based on branding settings
 */
export function updateMetaTags(branding) {
    if (!branding) return;
    
    // Update title
    document.title = branding.meta_title || `${branding.company_tagline} - ${branding.company_name}`;
    
    // Update meta description
    updateMetaTag('name', 'description', branding.meta_description);
    updateMetaTag('name', 'keywords', branding.meta_keywords);
    updateMetaTag('name', 'author', branding.company_name);
    
    // Update Open Graph tags
    updateMetaTag('property', 'og:title', branding.meta_title);
    updateMetaTag('property', 'og:description', branding.meta_description);
    updateMetaTag('property', 'og:site_name', `${branding.company_name} CCTV ${branding.city_name}`);
    
    // Update Twitter tags
    updateMetaTag('property', 'twitter:title', branding.meta_title);
    updateMetaTag('property', 'twitter:description', branding.meta_description);
    
    // Update theme color if primary color is set
    if (branding.primary_color) {
        updateMetaTag('name', 'theme-color', branding.primary_color);
    }
    
    // Update geo tags
    updateMetaTag('name', 'geo.placename', branding.city_name);
    
    // Update structured data
    updateStructuredData(branding);
}

/**
 * Helper to update or create meta tag
 */
function updateMetaTag(attribute, name, content) {
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
}

/**
 * Update structured data (JSON-LD)
 */
function updateStructuredData(branding) {
    // Update LocalBusiness structured data
    const localBusinessScript = document.querySelector('script[type="application/ld+json"]');
    if (localBusinessScript) {
        try {
            const data = JSON.parse(localBusinessScript.textContent);
            if (data['@type'] === 'LocalBusiness') {
                data.name = `${branding.company_name} CCTV ${branding.city_name}`;
                data.description = branding.company_description;
                if (data.address) {
                    data.address.addressLocality = branding.city_name;
                    data.address.addressRegion = branding.province_name;
                }
                if (data.areaServed) {
                    data.areaServed.name = branding.city_name;
                }
                localBusinessScript.textContent = JSON.stringify(data);
            }
        } catch (e) {
            console.warn('Failed to update LocalBusiness structured data:', e);
        }
    }
}
