/**
 * Dynamic Meta Tags Configuration
 * This script updates meta tags based on branding settings from API
 * 
 * Usage: Include this script in index.html BEFORE the main app loads
 */

(function() {
  // Get frontend domain from environment or current hostname
  const getFrontendDomain = () => {
    // Try to get from window.__ENV__ (injected by build process)
    if (window.__ENV__ && window.__ENV__.VITE_FRONTEND_DOMAIN) {
      return window.__ENV__.VITE_FRONTEND_DOMAIN;
    }
    
    // Fallback to current hostname
    const hostname = window.location.hostname;
    const port = window.location.port;
    
    // If port is standard (80/443), don't include it
    if (port && port !== '80' && port !== '443') {
      return `${hostname}:${port}`;
    }
    
    return hostname;
  };
  
  const domain = getFrontendDomain();
  const protocol = window.location.protocol;
  const baseUrl = `${protocol}//${domain}`;
  
  // Function to update meta tags with branding data
  const updateMetaTags = (branding) => {
    // Update page title
    if (branding.meta_title) {
      document.title = branding.meta_title;
      const titleMeta = document.querySelector('meta[name="title"]');
      if (titleMeta) titleMeta.content = branding.meta_title;
    }
    
    // Update meta description
    if (branding.meta_description) {
      const descMeta = document.querySelector('meta[name="description"]');
      if (descMeta) descMeta.content = branding.meta_description;
    }
    
    // Update meta keywords
    if (branding.meta_keywords) {
      const keywordsMeta = document.querySelector('meta[name="keywords"]');
      if (keywordsMeta) keywordsMeta.content = branding.meta_keywords;
    }
    
    // Update author
    if (branding.company_name) {
      const authorMeta = document.querySelector('meta[name="author"]');
      if (authorMeta) authorMeta.content = branding.company_name;
    }
    
    // Update Open Graph tags
    if (branding.meta_title) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.content = branding.meta_title;
    }
    
    if (branding.meta_description) {
      const ogDesc = document.querySelector('meta[property="og:description"]');
      if (ogDesc) ogDesc.content = branding.meta_description;
    }
    
    if (branding.company_name) {
      const ogSiteName = document.querySelector('meta[property="og:site_name"]');
      if (ogSiteName) ogSiteName.content = branding.company_name;
    }
    
    // Update Twitter tags
    if (branding.meta_title) {
      const twitterTitle = document.querySelector('meta[property="twitter:title"]');
      if (twitterTitle) twitterTitle.content = branding.meta_title;
    }
    
    if (branding.meta_description) {
      const twitterDesc = document.querySelector('meta[property="twitter:description"]');
      if (twitterDesc) twitterDesc.content = branding.meta_description;
    }
    
    // Update JSON-LD structured data
    const updateSchema = (schemaId, updates) => {
      const script = document.getElementById(schemaId);
      if (script) {
        try {
          const data = JSON.parse(script.textContent);
          Object.assign(data, updates);
          script.textContent = JSON.stringify(data);
        } catch (e) {
          console.warn(`Failed to update ${schemaId}:`, e);
        }
      }
    };
    
    // Update Local Business schema
    updateSchema('schema-local-business', {
      name: branding.company_name || 'CCTV System',
      description: branding.company_description || branding.meta_description,
      address: {
        '@type': 'PostalAddress',
        addressLocality: branding.city_name || '',
        addressRegion: branding.province_name || '',
        addressCountry: 'ID'
      }
    });
    
    // Update WebSite schema
    updateSchema('schema-website', {
      name: branding.company_name || 'CCTV System',
      alternateName: [branding.company_tagline || 'CCTV Online'],
      description: branding.meta_description || 'Pantau CCTV secara online'
    });
    
    // Update VideoObject schema
    updateSchema('schema-video', {
      name: `Live CCTV ${branding.city_name || ''}`.trim(),
      description: branding.meta_description || 'Live streaming CCTV'
    });
    
    console.log('✅ Meta tags updated with branding:', branding.company_name);
  };
  
  // Update URLs first
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.href = `${baseUrl}/`;
  }
  
  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) {
    ogUrl.content = `${baseUrl}/`;
  }
  
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    ogImage.content = `${baseUrl}/og-image.jpg`;
  }
  
  const twitterUrl = document.querySelector('meta[property="twitter:url"]');
  if (twitterUrl) {
    twitterUrl.content = `${baseUrl}/`;
  }
  
  const twitterImage = document.querySelector('meta[property="twitter:image"]');
  if (twitterImage) {
    twitterImage.content = `${baseUrl}/og-image.jpg`;
  }
  
  // Update JSON-LD URLs
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      
      if (data.url) data.url = baseUrl;
      if (data.logo) data.logo = `${baseUrl}/logo.png`;
      if (data.image) data.image = `${baseUrl}/og-image.jpg`;
      if (data.thumbnailUrl) data.thumbnailUrl = `${baseUrl}/og-image.jpg`;
      if (data.contentUrl) data.contentUrl = baseUrl;
      if (data.embedUrl) data.embedUrl = baseUrl;
      if (data.potentialAction && data.potentialAction.target) {
        data.potentialAction.target = `${baseUrl}/?search={search_term_string}`;
      }
      
      script.textContent = JSON.stringify(data);
    } catch (e) {
      console.warn('Failed to update structured data:', e);
    }
  });
  
  console.log('✅ URLs updated for domain:', domain);
  
  // Fetch branding data from API
  const apiUrl = window.__ENV__?.VITE_API_URL || `${protocol}//${domain.replace(':5173', ':3000')}`;
  
  fetch(`${apiUrl}/api/branding/public`)
    .then(response => response.json())
    .then(data => {
      if (data) {
        updateMetaTags(data);
      }
    })
    .catch(error => {
      console.warn('Failed to load branding data:', error);
    });
})();
