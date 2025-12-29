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

// Parse allowed origins from environment
const parseAllowedOrigins = () => {
  const defaultOrigins = [
    'https://cctv.raf.my.id',
    'http://cctv.raf.my.id',
    'http://172.17.11.12',
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:8080'
  ];
  
  if (process.env.ALLOWED_ORIGINS) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  }
  
  return defaultOrigins;
};

export const config = {
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiration: process.env.JWT_EXPIRATION || '1h',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
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

  // Security Configuration
  security: {
    // API Key Validation
    apiKeyValidationEnabled: process.env.API_KEY_VALIDATION_ENABLED !== 'false',
    apiKeySecret: process.env.API_KEY_SECRET || '',
    
    // CSRF Protection
    csrfSecret: process.env.CSRF_SECRET || '',
    csrfEnabled: process.env.CSRF_ENABLED !== 'false',
    
    // Rate Limiting
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitPublic: parseInt(process.env.RATE_LIMIT_PUBLIC || '100', 10),
    rateLimitAuth: parseInt(process.env.RATE_LIMIT_AUTH || '30', 10),
    rateLimitAdmin: parseInt(process.env.RATE_LIMIT_ADMIN || '60', 10),
    
    // Brute Force Protection
    bruteForceEnabled: process.env.BRUTE_FORCE_ENABLED !== 'false',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    maxIpAttempts: parseInt(process.env.MAX_IP_ATTEMPTS || '10', 10),
    lockoutDurationMinutes: parseInt(process.env.LOCKOUT_DURATION_MINUTES || '30', 10),
    ipBlockDurationMinutes: parseInt(process.env.IP_BLOCK_DURATION_MINUTES || '60', 10),
    
    // Session Management
    sessionAbsoluteTimeoutHours: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS || '24', 10),
    
    // Password Policy
    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '12', 10),
    passwordMaxAgeDays: parseInt(process.env.PASSWORD_MAX_AGE_DAYS || '90', 10),
    passwordHistoryCount: parseInt(process.env.PASSWORD_HISTORY_COUNT || '5', 10),
    
    // Audit Logging
    auditLogRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),
    
    // Allowed Origins
    allowedOrigins: parseAllowedOrigins(),
  },

  // Telegram Bot Configuration
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },
};

export default config;
