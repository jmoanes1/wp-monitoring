import { logger } from '../utils/logger.js';
import { emit } from '../sockets/emitter.js';
import { nowIso, formatDuration } from '../utils/time.js';
import { websiteTypeLabel } from '../utils/labels.js';
import { getSettings } from '../services/settingsService.js';
import * as websiteService from '../services/websiteService.js';
import * as incidentService from '../services/incidentService.js';
import * as notificationService from '../services/notificationService.js';
import * as historyService from '../services/monitoringHistoryService.js';
import { checkAvailability } from '../monitors/availabilityMonitor.js';
import { checkSsl } from '../monitors/sslMonitor.js';
import { checkWordPress } from '../monitors/wordpressMonitor.js';

// Background scheduler. Monitoring never runs inside HTTP controllers;
// request handlers only queue a one-off check through queueSiteCheck().
let timer = null;
let running = false;
let currentInterval = null;

export function startMonitorWorker() {
  schedule().catch((error) => logger.error(`Failed to start monitor worker: ${error.message}`));
}

export function stopMonitorWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function rescheduleMonitorWorker() {
  await schedule();
}

async function schedule() {
  const settings = await getSettings();
  const interval = settings.monitorIntervalMs;
  if (timer && currentInterval === interval) return;

  if (timer) clearInterval(timer);
  currentInterval = interval;
  timer = setInterval(() => {
    runMonitoringCycle().catch((error) => logger.error(`Monitor cycle failed: ${error.message}`));
  }, interval);

  logger.info(`Monitoring worker scheduled every ${interval}ms`);
  setTimeout(() => {
    runMonitoringCycle().catch((error) => logger.error(`Initial monitor cycle failed: ${error.message}`));
  }, 3000);
}

export async function runMonitoringCycle() {
  if (running) {
    logger.warn('Skipping monitor cycle because a previous cycle is still running');
    return;
  }

  running = true;
  emit('monitoring:started', { startedAt: nowIso() });
  logger.info('Monitoring cycle started');

  try {
    const websites = await websiteService.getMonitoredWebsites();
    for (const website of websites) {
      try {
        await monitorWebsite(website);
      } catch (error) {
        logger.error(`Website ${website.name} monitor failed`, { error: error.message, websiteId: website.id });
        await websiteService.saveWebsiteSnapshot(website.id, {
          lastCheckedAt: nowIso(),
          lastError: error.message,
          status: website.status === 'online' ? 'warning' : website.status || 'unknown'
        });
      }
    }
  } finally {
    running = false;
    emit('monitoring:completed', { completedAt: nowIso() });
    logger.info('Monitoring cycle completed');
  }
}

export async function monitorWebsite(website) {
  const availability = await checkAvailability(website);

  let ssl = website.ssl || null;
  try {
    ssl = await checkSsl(website.url);
  } catch (error) {
    ssl = {
      valid: false,
      applicable: website.url.startsWith('https:'),
      expiresAt: null,
      daysRemaining: null,
      issuer: null,
      error: error.message
    };
  }

  const previousStatus = website.status;
  await historyService.recordCheck({
    websiteId: website.id,
    type: 'availability',
    targetId: website.id,
    previousStatus,
    newStatus: availability.status,
    message: availability.error || `HTTP ${availability.httpStatus}`,
    responseTime: availability.responseTime
  });

  await handleAvailabilityChange(website, previousStatus, availability);
  await handleSslWarnings(website, ssl);

  let wordpress = website.wordpress;
  if (availability.body || availability.status === 'online' || availability.status === 'warning') {
    try {
      wordpress = await checkWordPress(website, availability.body);
    } catch (error) {
      logger.error(`WordPress monitor failed for ${website.name}: ${error.message}`);
    }
  }

  const updated = await websiteService.saveWebsiteSnapshot(website.id, {
    status: availability.status,
    responseTime: availability.responseTime,
    lastCheckedAt: nowIso(),
    lastError: availability.error,
    httpStatus: availability.httpStatus,
    ssl,
    wordpress
  });

  return { website: updated, availability, ssl, wordpress };
}

async function handleAvailabilityChange(website, previousStatus, availability) {
  if (previousStatus !== 'offline' && availability.status === 'offline') {
    const incident = await incidentService.openIncident({
      websiteId: website.id,
      type: 'availability',
      severity: 'critical',
      errorMessage: availability.error
    });
    await notificationService.createNotification({
      type: 'website_offline',
      severity: 'critical',
      title: 'WEBSITE OFFLINE',
      status: 'active',
      criticalAlert: true,
      message: `${website.name} is offline — ${availability.error || 'Unreachable'}`,
      websiteId: website.id,
      relatedId: incident.id,
      dedupeKey: `offline:${website.id}`,
      metadata: {
        websiteName: website.name,
        websiteType: website.type,
        websiteTypeLabel: websiteTypeLabel(website.type),
        errorMessage: availability.error,
        previousStatus,
        currentStatus: 'offline'
      }
    });
    emit('website:offline', { websiteId: website.id, website, incident });
  } else if (previousStatus === 'offline' && availability.status === 'offline') {
    await incidentService.openIncident({
      websiteId: website.id,
      type: 'availability',
      severity: 'critical',
      errorMessage: availability.error
    });
  } else if (previousStatus === 'offline' && availability.status !== 'offline') {
    const incident = await incidentService.resolveIncident({
      websiteId: website.id,
      type: 'availability'
    });
    await notificationService.resolveActiveByWebsite(website.id, 'website_offline');
    await notificationService.createNotification({
      type: 'website_online',
      severity: 'success',
      title: 'WEBSITE ONLINE',
      status: 'resolved',
      message: `${website.name} recovered after ${formatDuration(incident?.downtimeSeconds || 0)}`,
      websiteId: website.id,
      relatedId: incident?.id,
      metadata: {
        websiteName: website.name,
        websiteType: website.type,
        websiteTypeLabel: websiteTypeLabel(website.type),
        downtimeSeconds: incident?.downtimeSeconds,
        downtimeLabel: formatDuration(incident?.downtimeSeconds || 0),
        startedAt: incident?.startedAt,
        resolvedAt: incident?.resolvedAt
      }
    });
    emit('website:recovered', { websiteId: website.id, website, incident });
  }
}

async function handleSslWarnings(website, ssl) {
  if (!ssl?.applicable || ssl.daysRemaining == null) return;
  const settings = await getSettings();
  const critical = ssl.daysRemaining <= settings.sslCriticalDays;
  const warning = ssl.daysRemaining <= settings.sslWarningDays;
  if (!critical && !warning) return;

  const level = critical ? 'critical' : 'warning';
  const dedupeKey = `ssl:${website.id}:${ssl.expiresAt}:${level}`;
  if (await notificationService.hasRecentDedupe(dedupeKey)) return;

  const notification = await notificationService.createNotification({
    type: 'ssl_warning',
    severity: level,
    title: critical ? 'SSL EXPIRING' : 'SSL WARNING',
    status: 'active',
    criticalAlert: critical,
    message: `${website.name} SSL expires in ${ssl.daysRemaining} days`,
    websiteId: website.id,
    dedupeKey,
    metadata: {
      websiteName: website.name,
      daysRemaining: ssl.daysRemaining,
      expiresAt: ssl.expiresAt,
      issuer: ssl.issuer
    }
  });

  await historyService.recordCheck({
    websiteId: website.id,
    type: 'ssl',
    targetId: website.id,
    previousStatus: 'valid',
    newStatus: level,
    message: `SSL expires in ${ssl.daysRemaining} days`
  });

  emit('ssl:warning', { website, ssl, notification });
}

export async function queueSiteCheck(websiteId) {
  const website = await websiteService.getWebsiteRecord(websiteId);
  if (!website) return null;
  return monitorWebsite(website);
}
