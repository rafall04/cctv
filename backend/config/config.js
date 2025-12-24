import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

/**
 * Build public stream URL for frontend
 * 
 * Stream URL Strategy:
 * 1. If PUBLIC_STREAM_BASE_URL is set (e.g., https://api-cctv.raf.my.id), use it as base
 * 2. Otherwise, use relative paths (e.g., /hls) which frontend will prepend with API URL
 * 
 * This allows flexibility for different deployment scenarios:
 * - Production: PUBLIC_STREAM_BASE_URL=https://api-cctv.raf.my.id (absolute URLs)
 * - Development: No PUBLIC_STREAM_BASE_URL (relative URLs, frontend prepends API URL)
 */
const buildPublicUrl = (path, defaultPath) => {
  const baseUrl = process.env.PUBLIC_STREAM_BASE_URL || '';
  const urlPath = path || defaultPath;
  
  // If base URL is set, return absolute URL
  if (baseUrl) {
    // Remove trailing slash from base and leading slash from path
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
    return `${cleanBase}${cleanPath}`;
  }
  
  // Otherwise return relative path (frontend will prepend API URL)
  return urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
};

export const config = {
  // Server
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiration: process.env.JWT_EXPIRATION || '24h',
  },

  // MediaMTX Configuration
  // 
  // ARCHITECTURE:
  // Frontend -> Backend API -> MediaMTX (internal)
  // Frontend NEVER accesses MediaMTX directly
  //
  // URL Configuration:
  // - Internal URLs: Backend uses these to communicate with MediaMTX (localhost)
  // - Public URLs: Returned to frontend, proxied through nginx or backend
  //
  mediamtx: {
    // Internal API URL - backend communicates with MediaMTX directly
    apiUrl: process.env.MEDIAMTX_API_URL || 'http://localhost:9997',
    
    // Internal URLs - backend uses these to communicate with MediaMTX
    hlsUrlInternal: process.env.MEDIAMTX_HLS_URL_INTERNAL || 'http://localhost:8888',
    webrtcUrlInternal: process.env.MEDIAMTX_WEBRTC_URL_INTERNAL || 'http://localhost:8889',
    
    // Public URLs - returned to frontend
    // Can be:
    // 1. Relative paths (e.g., /hls) - frontend prepends API URL
    // 2. Absolute URLs (e.g., https://api-cctv.raf.my.id/hls) - used directly
    //
    // Set PUBLIC_STREAM_BASE_URL in .env to use absolute URLs
    // Example: PUBLIC_STREAM_BASE_URL=https://api-cctv.raf.my.id
    hlsUrl: buildPublicUrl(process.env.PUBLIC_HLS_PATH, '/hls'),
    webrtcUrl: buildPublicUrl(process.env.PUBLIC_WEBRTC_PATH, '/webrtc'),
    
    // Base URL for streams (optional, for absolute URLs)
    // If set, all stream URLs will be absolute
    // If not set, stream URLs will be relative (frontend prepends API URL)
    publicBaseUrl: process.env.PUBLIC_STREAM_BASE_URL || '',
  },

  // Database
  database: {
    path: process.env.DATABASE_PATH || './data/cctv.db',
  },

  // CORS - Accept all origins for Ubuntu 20.04 production
  cors: {
    origin: process.env.CORS_ORIGIN === '*' 
      ? true 
      : process.env.CORS_ORIGIN 
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
        : true, // Default: accept all origins
    credentials: true,
  },
};

export default config;
