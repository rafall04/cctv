/**
 * Dynamic Meta Tags Configuration
 * This script updates meta tags based on environment variables at runtime
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
  
  // Update canonical URL
  const canonical = document.querySelector('link[rel="canonical"]');
  if (canonical) {
    canonical.href = `${baseUrl}/`;
  }
  
  // Update Open Graph URLs
  const ogUrl = document.querySelector('meta[property="og:url"]');
  if (ogUrl) {
    ogUrl.content = `${baseUrl}/`;
  }
  
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    ogImage.content = `${baseUrl}/og-image.jpg`;
  }
  
  // Update Twitter URLs
  const twitterUrl = document.querySelector('meta[property="twitter:url"]');
  if (twitterUrl) {
    twitterUrl.content = `${baseUrl}/`;
  }
  
  const twitterImage = document.querySelector('meta[property="twitter:image"]');
  if (twitterImage) {
    twitterImage.content = `${baseUrl}/og-image.jpg`;
  }
  
  // Update JSON-LD structured data
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  scripts.forEach(script => {
    try {
      const data = JSON.parse(script.textContent);
      
      // Update URLs in structured data
      if (data.url) {
        data.url = baseUrl;
      }
      if (data.logo) {
        data.logo = `${baseUrl}/logo.png`;
      }
      if (data.image) {
        data.image = `${baseUrl}/og-image.jpg`;
      }
      if (data.thumbnailUrl) {
        data.thumbnailUrl = `${baseUrl}/og-image.jpg`;
      }
      if (data.contentUrl) {
        data.contentUrl = baseUrl;
      }
      if (data.embedUrl) {
        data.embedUrl = baseUrl;
      }
      if (data.potentialAction && data.potentialAction.target) {
        data.potentialAction.target = `${baseUrl}/?search={search_term_string}`;
      }
      
      script.textContent = JSON.stringify(data);
    } catch (e) {
      console.warn('Failed to update structured data:', e);
    }
  });
  
  console.log('✅ Meta tags updated for domain:', domain);
})();
