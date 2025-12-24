import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });

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

  // MediaMTX
  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL || 'http://localhost:9997',
    hlsUrl: process.env.MEDIAMTX_HLS_URL || 'http://localhost:8888',
    webrtcUrl: process.env.MEDIAMTX_WEBRTC_URL || 'http://localhost:8889',
  },

  // Database
  database: {
    path: process.env.DATABASE_PATH || './data/cctv.db',
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
      : ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  },
};

export default config;
