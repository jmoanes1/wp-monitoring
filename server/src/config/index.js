import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');
const projectRoot = path.resolve(serverRoot, '..');
const onVercel = Boolean(process.env.VERCEL);
const seedDir = path.join(serverRoot, 'data');
const dataDir = onVercel ? path.join('/tmp', 'wp-monitor-data') : seedDir;

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(serverRoot, '.env') });

const MIN_MONITOR_INTERVAL_MS = 5 * 60 * 1000;

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const monitorInterval = Math.max(
  MIN_MONITOR_INTERVAL_MS,
  parsePositiveInt(process.env.MONITOR_INTERVAL, 15 * 60 * 1000)
);

export const config = {
  env: process.env.NODE_ENV || 'development',
  serverless: onVercel,
  port: parsePositiveInt(process.env.PORT, 5000),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  timezone: process.env.APP_TIMEZONE || 'Asia/Manila',
  monitorIntervalMs: monitorInterval,
  minMonitorIntervalMs: MIN_MONITOR_INTERVAL_MS,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  defaultAdminUsername: process.env.DEFAULT_ADMIN_USERNAME || 'admin',
  defaultAdminPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'ChangeMeNow!',
  maxResponseBytes: parsePositiveInt(process.env.MAX_RESPONSE_BYTES, 2 * 1024 * 1024),
  requestTimeoutMs: parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, 15000),
  formTestEmail: (process.env.TEST_EMAIL || process.env.FORM_TEST_EMAIL || 'john@medisure.com').trim().toLowerCase(),
  formTestReportEmail: (process.env.FORM_TEST_REPORT_EMAIL || 'john@medishure.com').trim().toLowerCase(),
  smtp: {
    host: (process.env.SMTP_HOST || '').trim(),
    port: parsePositiveInt(process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || '').trim()
  },
  credentialsEncryptionKey: (process.env.CREDENTIALS_ENCRYPTION_KEY || '').trim(),
  paths: {
    serverRoot,
    projectRoot,
    seedDir,
    dataDir,
    backupDir: path.join(dataDir, 'backups'),
    logsDir: onVercel ? path.join('/tmp', 'wp-monitor-logs') : path.join(serverRoot, 'logs'),
    testResultsDir: path.join(dataDir, 'test-results'),
    clientDist: path.join(projectRoot, 'client', 'dist')
  },
  files: {
    websites: 'websites.json',
    forms: 'forms.json',
    notifications: 'notifications.json',
    incidents: 'incidents.json',
    monitoring: 'monitoring.json',
    updates: 'updates.json',
    settings: 'settings.json',
    users: 'users.json',
    credentials: 'credentials.json',
    formTests: 'formTests.json'
  },
  allowedIntervals: [
    { label: '5 minutes', ms: 5 * 60 * 1000 },
    { label: '15 minutes', ms: 15 * 60 * 1000 },
    { label: '30 minutes', ms: 30 * 60 * 1000 },
    { label: '1 hour', ms: 60 * 60 * 1000 },
    { label: '6 hours', ms: 6 * 60 * 60 * 1000 },
    { label: '24 hours', ms: 24 * 60 * 60 * 1000 }
  ]
};

export const defaultSettings = {
  monitorIntervalMs: config.monitorIntervalMs,
  timezone: config.timezone,
  sslWarningDays: 30,
  sslCriticalDays: 7,
  maxHistoryRecords: 2000,
  browserNotifications: true,
  emailEnabled: false,
  allowRealTestSubmissions: false,
  screenshotRetentionHours: 24,
  requestTimeoutMs: config.requestTimeoutMs
};
