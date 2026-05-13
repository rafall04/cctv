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

const parseAllowedOrigins = () => {
  if (process.env.ALLOWED_ORIGINS && process.env.ALLOWED_ORIGINS.trim()) {
    return process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim());
  }

  const origins = [];

  if (process.env.FRONTEND_DOMAIN) {
    origins.push(`https://${process.env.FRONTEND_DOMAIN}`);
    origins.push(`http://${process.env.FRONTEND_DOMAIN}`);
    if (process.env.PORT_PUBLIC && process.env.PORT_PUBLIC !== '80' && process.env.PORT_PUBLIC !== '443') {
      origins.push(`http://${process.env.FRONTEND_DOMAIN}:${process.env.PORT_PUBLIC}`);
    }
  }

  if (process.env.SERVER_IP) {
    origins.push(`http://${process.env.SERVER_IP}`);
    if (process.env.PORT_PUBLIC && process.env.PORT_PUBLIC !== '80') {
      origins.push(`http://${process.env.SERVER_IP}:${process.env.PORT_PUBLIC}`);
    }
  }

  if (process.env.NODE_ENV === 'development') {
    origins.push('http://localhost:5173');
    origins.push('http://localhost:3000');
    origins.push('http://localhost:3001');
  }

  if (origins.length > 0) {
    return origins;
  }

  if (process.env.NODE_ENV === 'development') {
    return [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
  }

  console.warn('WARNING: No ALLOWED_ORIGINS configured! Set FRONTEND_DOMAIN, SERVER_IP in .env');
  return [];
};

const parseList = (value) => {
  if (!value || !value.trim()) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const defaultTrustedProxyCidrs = [
  '127.0.0.1/32',
  '::1/128',
];

const trustedProxyCidrs = parseList(process.env.TRUSTED_PROXY_CIDRS);

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
        ? process.env.CORS_ORIGIN.split(',').map((origin) => origin.trim())
        : true,
    credentials: true,
  },

  security: {
    backendDomain: process.env.BACKEND_DOMAIN || '',
    frontendDomain: process.env.FRONTEND_DOMAIN || '',
    serverIp: process.env.SERVER_IP || '',

    apiKeyValidationEnabled: process.env.API_KEY_VALIDATION_ENABLED !== 'false',
    apiKeySecret: process.env.API_KEY_SECRET || '',

    csrfSecret: process.env.CSRF_SECRET || '',
    csrfEnabled: process.env.CSRF_ENABLED !== 'false',

    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    rateLimitPublic: parseInt(process.env.RATE_LIMIT_PUBLIC || '100', 10),
    rateLimitAuth: parseInt(process.env.RATE_LIMIT_AUTH || '30', 10),
    rateLimitAdmin: parseInt(process.env.RATE_LIMIT_ADMIN || '60', 10),

    bruteForceEnabled: process.env.BRUTE_FORCE_ENABLED !== 'false',
    maxLoginAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10),
    maxIpAttempts: parseInt(process.env.MAX_IP_ATTEMPTS || '10', 10),
    lockoutDurationMinutes: parseInt(process.env.LOCKOUT_DURATION_MINUTES || '30', 10),
    ipBlockDurationMinutes: parseInt(process.env.IP_BLOCK_DURATION_MINUTES || '60', 10),

    sessionAbsoluteTimeoutHours: parseInt(process.env.SESSION_ABSOLUTE_TIMEOUT_HOURS || '24', 10),

    passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '12', 10),
    passwordMaxAgeDays: parseInt(process.env.PASSWORD_MAX_AGE_DAYS || '90', 10),
    passwordHistoryCount: parseInt(process.env.PASSWORD_HISTORY_COUNT || '5', 10),

    auditLogRetentionDays: parseInt(process.env.AUDIT_LOG_RETENTION_DAYS || '90', 10),

    allowedOrigins: parseAllowedOrigins(),
    ads: {
      scriptAllowedHosts: parseList(process.env.ADS_SCRIPT_ALLOWED_HOSTS),
      frameAllowedHosts: parseList(process.env.ADS_FRAME_ALLOWED_HOSTS),
      connectAllowedHosts: parseList(process.env.ADS_CONNECT_ALLOWED_HOSTS),
    },
    trustedProxyCidrs: trustedProxyCidrs.length > 0 ? trustedProxyCidrs : defaultTrustedProxyCidrs,
    hls: {
      maxSessionCacheEntries: parseInt(process.env.HLS_MAX_SESSION_CACHE_ENTRIES || '5000', 10),
      maxSessionCacheEntriesPerCamera: parseInt(process.env.HLS_MAX_SESSION_CACHE_ENTRIES_PER_CAMERA || '1000', 10),
      sessionCacheTtlMs: parseInt(process.env.HLS_SESSION_CACHE_TTL_MS || '25000', 10),
      sessionCleanupIntervalMs: parseInt(process.env.HLS_SESSION_CLEANUP_INTERVAL_MS || '10000', 10),
      cameraIdCacheTtlMs: parseInt(process.env.HLS_CAMERA_ID_CACHE_TTL_MS || '300000', 10),
      maxExternalPlaylistBytes: parseInt(process.env.HLS_MAX_EXTERNAL_PLAYLIST_BYTES || '1048576', 10),
      maxSessionCreatesPerWindow: parseInt(process.env.HLS_MAX_SESSION_CREATES_PER_WINDOW || '12', 10),
      maxCameraLookupMissesPerWindow: parseInt(process.env.HLS_MAX_CAMERA_LOOKUP_MISSES_PER_WINDOW || '30', 10),
      controlWindowMs: parseInt(process.env.HLS_CONTROL_WINDOW_MS || '60000', 10),
      maxLimiterKeys: parseInt(process.env.HLS_MAX_LIMITER_KEYS || '5000', 10),
      externalProxyAllowPrivateHosts: process.env.HLS_EXTERNAL_PROXY_ALLOW_PRIVATE_HOSTS === 'true',
      externalProxyAllowedHosts: parseList(process.env.HLS_EXTERNAL_PROXY_ALLOWED_HOSTS),
      externalProxyTimeoutMs: parseInt(process.env.HLS_EXTERNAL_PROXY_TIMEOUT_MS || '10000', 10),
    },
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    monitoringChatId: process.env.TELEGRAM_MONITORING_CHAT_ID || process.env.TELEGRAM_CHAT_ID || '',
    feedbackChatId: process.env.TELEGRAM_FEEDBACK_CHAT_ID || '',
    enabled: !!(
      process.env.TELEGRAM_BOT_TOKEN
      && (
        process.env.TELEGRAM_MONITORING_CHAT_ID
        || process.env.TELEGRAM_CHAT_ID
        || process.env.TELEGRAM_FEEDBACK_CHAT_ID
      )
    ),
  },
};

export default config;
