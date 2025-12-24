import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const buildPublicUrl = (path, defaultPath) => {
  const baseUrl = process.env.PUBLIC_STREAM_BASE_URL || '';
  const urlPath = path || defaultPath;
  
  if (baseUrl) {
    const cleanBase = baseUrl.replace(/\/$/, '');
    const cleanPath = urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
    return `${cleanBase}${cleanPath}`;
  }
  
  return urlPath.startsWith('/') ? urlPath : `/${urlPath}`;
};

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiration: process.env.JWT_EXPIRATION || '24h',
  },

  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL || 'http://localhost:9997',
    hlsUrlInternal: process.env.MEDIAMTX_HLS_URL_INTERNAL || 'http://localhost:8888',
    webrtcUrlInternal: process.env.MEDIAMTX_WEBRTC_URL_INTERNAL || 'http://localhost:8889',
    hlsUrl: buildPublicUrl(process.env.PUBLIC_HLS_PATH, '/hls'),
    webrtcUrl: buildPublicUrl(process.env.PUBLIC_WEBRTC_PATH, '/webrtc'),
    publicBaseUrl: process.env.PUBLIC_STREAM_BASE_URL || '',
  },

  database: {
    path: process.env.DATABASE_PATH || './data/cctv.db',
  },

  cors: {
    origin: process.env.CORS_ORIGIN === '*' 
      ? true 
      : process.env.CORS_ORIGIN 
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
        : true,
    credentials: true,
  },
};

export default config;
