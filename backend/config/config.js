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
  // If explicitly set, use it
  if (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS.trim()) {
    return process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
  }
  
  // Auto-generate from domain config
  const origins = [];
  
  // Frontend domain
  if (process.env.FRONTEND_DOMAIN) {
    origins.push(`https://${process.env.FRONTEND_DOMAIN}`);
    origins.push(`http://${process.env.FRONTEND_DOMAIN}`);
    if (process.env.PORT_PUBLIC && process.env.PORT_PUBLIC !== '80' && process.env.PORT_PUBLIC !== '443') {
      origins.push(`http://${process.env.FRONTEND_DOMAIN}:${process.env.PORT_PUBLIC}`);
    }
  }
  
  // Server IP
  if (process.env.SERVER_IP) {
    origins.push(`http://${process.env.SERVER_IP}`);
    if (process.env.PORT_PUBLIC && process.env.PORT_PUBLIC !== '80') {
      origins.push(`http://${process.env.SERVER_IP}:${process.env.PORT_PUBLIC}`);
    }
  }
  
  // Development defaults
  if (process.env.NODE_ENV === 'development') {
    origins.push('http://localhost:5173');
    origins.push('http://localhost:3000');
    origins.push('http://localhost:3001');
  }
  
  // Fallback defaults if nothing configured
  // CRITICAL: These should only be used in development
  // Production MUST set environment variables!
  if (origins.length > 0) {
    return origins;
  }
  
  // Development-only fallback
  if (process.env.NODE_ENV === 'development') {
    return [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
  }
  
  // Production without config - log warning
  console.warn('⚠️  WARNING: No ALLOWED_ORIGINS configured! Set FRONTEND_DOMAIN, SERVER_IP in .env');
  return [];
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
    // Domain Configuration
    backendDomain: process.env.BACKEND_DOMAIN || '',
    frontendDomain: process.env.FRONTEND_DOMAIN || '',
    serverIp: process.env.SERVER_IP || '',
    
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
    // Chat ID untuk monitoring kamera (offline/online alerts)
    monitoringChatId: process.env.TELEGRAM_MONITORING_CHAT_ID || '',
    // Chat ID untuk kritik & saran
    feedbackChatId: process.env.TELEGRAM_FEEDBACK_CHAT_ID || '',
    // Legacy support - fallback to single chat ID
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_MONITORING_CHAT_ID || process.env.TELEGRAM_FEEDBACK_CHAT_ID)),
  },
};

export default config;
