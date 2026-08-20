import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { defaultSettings } from '../config/index.js';

const FILE = config.files.settings;

export async function getSettings() {
  const stored = await storage.readDocument(FILE, defaultSettings);
  return { ...defaultSettings, ...stored };
}

export async function updateSettings(changes) {
  const current = await getSettings();
  const next = { ...current };

  if (changes.monitorIntervalMs !== undefined) {
    const allowed = config.allowedIntervals.map((item) => item.ms);
    if (!allowed.includes(Number(changes.monitorIntervalMs))) {
      throw Object.assign(new Error('Unsupported monitoring interval'), { status: 400 });
    }
    next.monitorIntervalMs = Number(changes.monitorIntervalMs);
  }

  if (changes.sslWarningDays !== undefined) {
    next.sslWarningDays = Math.min(90, Math.max(1, Number(changes.sslWarningDays)));
  }

  if (changes.sslCriticalDays !== undefined) {
    next.sslCriticalDays = Math.min(30, Math.max(1, Number(changes.sslCriticalDays)));
  }

  if (changes.browserNotifications !== undefined) {
    next.browserNotifications = Boolean(changes.browserNotifications);
  }

  if (changes.allowRealTestSubmissions !== undefined) {
    next.allowRealTestSubmissions = Boolean(changes.allowRealTestSubmissions);
  }

  if (changes.screenshotRetentionHours !== undefined) {
    next.screenshotRetentionHours = Math.min(168, Math.max(1, Number(changes.screenshotRetentionHours)));
  }

  if (changes.maxHistoryRecords !== undefined) {
    next.maxHistoryRecords = Math.min(10000, Math.max(100, Number(changes.maxHistoryRecords)));
  }

  next.emailEnabled = false;
  next.timezone = current.timezone || config.timezone;

  return storage.writeDocument(FILE, next);
}
