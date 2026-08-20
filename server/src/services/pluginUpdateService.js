import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { originOf } from '../utils/ssrf.js';
import { safeFetch } from '../utils/httpClient.js';
import { emit } from '../sockets/emitter.js';
import * as websiteService from './websiteService.js';
import * as credentialService from './credentialService.js';
import { checkAvailability } from '../monitors/availabilityMonitor.js';
import { checkWordPress, compareVersions } from '../monitors/wordpressMonitor.js';
import {
  openWordPressAdminSession,
  wordpressBrowserHeaders
} from '../monitors/wordpressConnectionMonitor.js';
import { resolveStaleUpdates } from './updateService.js';

const PLUGIN_UPDATE_TIMEOUT_MS = 180000;
const GENERIC_JOB_ERROR = 'Plugin update failed. Please try again.';
const runningJobs = new Map();

/**
 * Starts a single-plugin or update-all job. The HTTP handler returns immediately;
 * progress is streamed over Socket.IO so the dashboard does not need a refresh.
 */
export async function startPluginUpdate(websiteId, { slug = null, all = false } = {}) {
  const website = await websiteService.getWebsiteRecord(websiteId);
  if (!website) return { error: 'not_found' };

  if (runningJobs.has(websiteId)) {
    return {
      error: 'busy',
      message: 'A plugin update is already in progress for this website.'
    };
  }

  let credentials;
  try {
    credentials = await credentialService.getDecryptedCredentials(websiteId);
  } catch {
    credentials = null;
  }
  if (!credentials?.username || !credentials?.password) {
    return {
      error: 'credentials',
      message: 'WordPress credentials are not configured for this website.'
    };
  }

  const targets = selectTargets(website, { slug, all });
  if (!targets.length) {
    return {
      error: 'none',
      message: slug
        ? 'That plugin does not have an available update.'
        : 'No plugin updates are available.'
    };
  }

  const jobId = createId('pupd');
  runningJobs.set(websiteId, { jobId, startedAt: Date.now() });

  emit(
    'plugin:updateStarted',
    safePayload({
      websiteId,
      jobId,
      status: 'running',
      message: targets.length === 1 ? `Updating ${targets[0].name}...` : `Updating 1 of ${targets.length} plugins`,
      index: 1,
      total: targets.length,
      current: { slug: targets[0].slug, name: targets[0].name, status: 'updating' },
      succeeded: 0,
      failed: 0,
      items: targets.map((plugin) => ({
        slug: plugin.slug,
        name: plugin.name,
        status: plugin.slug === targets[0].slug ? 'updating' : 'pending'
      }))
    })
  );

  setImmediate(() => {
    runPluginUpdateJob(website, credentials, targets, jobId)
      .catch((error) => {
        logger.error('Plugin update job failed', { websiteId, message: error.message });
        emit('plugin:updateCompleted', safePayload({
          websiteId,
          jobId,
          status: 'failed',
          message: GENERIC_JOB_ERROR,
          total: targets.length,
          succeeded: 0,
          failed: targets.length,
          items: targets.map((plugin) => ({
            slug: plugin.slug,
            name: plugin.name,
            status: 'failed',
            error: GENERIC_JOB_ERROR
          }))
        }));
      })
      .finally(() => {
        runningJobs.delete(websiteId);
      });
  });

  return {
    started: true,
    jobId,
    total: targets.length,
    plugins: targets.map((plugin) => ({ slug: plugin.slug, name: plugin.name }))
  };
}

export function isPluginUpdateRunning(websiteId) {
  return runningJobs.has(websiteId);
}

function selectTargets(website, { slug, all }) {
  const plugins = website.wordpress?.plugins || [];
  if (slug) {
    const plugin = plugins.find((item) => item.slug === slug && item.updateAvailable);
    return plugin ? [plugin] : [];
  }
  if (all) return plugins.filter((item) => item.updateAvailable);
  return [];
}

async function runPluginUpdateJob(website, credentials, targets, jobId) {
  const items = targets.map((plugin) => ({
    slug: plugin.slug,
    name: displayName(plugin),
    file: plugin.file || null,
    status: 'pending',
    version: plugin.version || null,
    newVersion: null,
    error: null
  }));

  emitProgress(website.id, jobId, {
    status: 'running',
    message: items.length === 1 ? `Updating ${items[0].name}...` : `Updating 1 of ${items.length} plugins`,
    index: 1,
    total: items.length,
    current: { ...items[0], status: 'updating' },
    succeeded: 0,
    failed: 0,
    items
  });

  const session = await openWordPressAdminSession(website, credentials);
  if (!session.ok) {
    const authError = publicError(session.code || 'auth', session.error);
    for (const item of items) {
      item.status = 'failed';
      item.error = authError;
    }
    emitProgress(website.id, jobId, {
      status: 'running',
      message: authError,
      index: 0,
      total: items.length,
      current: { ...items[0], status: 'failed', error: authError },
      succeeded: 0,
      failed: items.length,
      items
    });
    emitCompleted(website.id, jobId, items, authError);
    return;
  }

  let abortRemaining = null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    item.status = 'updating';
    emitProgress(website.id, jobId, {
      status: 'running',
      message: `Updating ${item.name}...`,
      index: index + 1,
      total: items.length,
      current: { ...item },
      succeeded: countBy(items, 'success'),
      failed: countBy(items, 'failed'),
      items
    });

    if (abortRemaining) {
      item.status = 'failed';
      item.error = abortRemaining;
    } else {
      const file = item.file || session.pluginFiles.get(item.slug) || null;
      const result = await updateOnePlugin(session, {
        ...item,
        file,
        latestVersion: targets[index]?.latestVersion
      });
      if (result.ok) {
        item.status = 'success';
        item.newVersion = result.newVersion;
        item.version = result.newVersion || item.version;
        item.error = null;
      } else {
        item.status = 'failed';
        item.error = result.message;
        if (result.code === 'auth' || result.code === 'connection') {
          abortRemaining = result.message;
        }
      }
    }

    emitProgress(website.id, jobId, {
      status: 'running',
      message: item.status === 'success' ? `${item.name} updated successfully` : `${item.name} update failed`,
      index: index + 1,
      total: items.length,
      current: { ...item },
      succeeded: countBy(items, 'success'),
      failed: countBy(items, 'failed'),
      items
    });
  }

  const overrides = {};
  for (const item of items) {
    if (item.status === 'success' && item.newVersion) {
      overrides[item.slug] = item.newVersion;
    }
  }

  try {
    await refreshPluginInventory(website, overrides);
  } catch (error) {
    logger.warn('Plugin inventory refresh after update failed', {
      websiteId: website.id,
      message: error.message
    });
    await applySuccessfulPluginVersions(website.id, items).catch(() => {});
  }

  emitCompleted(website.id, jobId, items);
}

async function updateOnePlugin(session, plugin) {
  if (!plugin.file) {
    return {
      ok: false,
      code: 'plugin',
      message: `${plugin.name} could not be updated because WordPress did not expose its plugin file.`
    };
  }

  const body = new URLSearchParams({
    action: 'update-plugin',
    plugin: plugin.file,
    slug: plugin.slug,
    _ajax_nonce: session.nonce
  }).toString();

  const result = await safeFetch(session.ajaxUrl, {
    method: 'POST',
    allowedOrigins: session.allowedOrigins,
    timeoutMs: PLUGIN_UPDATE_TIMEOUT_MS,
    maxRedirects: 0,
    parseJson: true,
    headers: wordpressBrowserHeaders({
      Cookie: session.cookieHeader,
      Origin: originOf(session.ajaxUrl),
      Referer: session.pluginsUrl,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json, text/javascript, */*; q=0.01'
    }),
    body
  });

  const classified = classifyHttpFailure(result);
  if (classified) return classified;

  const payload = result.json || parseTrailingJson(result.body);
  if (!payload || typeof payload !== 'object') {
    if (/wp-login\.php|name=["']log["']/i.test(result.body || '')) {
      return { ok: false, code: 'auth', message: publicError('auth') };
    }
    if (/connection_type|ftp_credentials|hostname/i.test(result.body || '')) {
      return {
        ok: false,
        code: 'plugin',
        message: 'WordPress needs filesystem credentials to install plugin files.'
      };
    }
    return { ok: false, code: 'plugin', message: `${plugin.name} update failed.` };
  }

  // WordPress sets success:false for upgrader errors. Never treat that as updated.
  if (payload.success !== true) {
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    return {
      ok: false,
      code: data.errorCode === 'unable_to_connect_to_filesystem' ? 'plugin' : 'plugin',
      message: sanitizeWpMessage(data.errorMessage, `${plugin.name} update failed.`)
    };
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  if (data.errorMessage && !data.newVersion) {
    return { ok: false, code: 'plugin', message: sanitizeWpMessage(data.errorMessage, `${plugin.name} update failed.`) };
  }

  return {
    ok: true,
    newVersion: parseVersionLabel(data.newVersion) || plugin.latestVersion || null
  };
}

function classifyHttpFailure(result) {
  if (!result || result.status === 0) {
    const kind = result?.error?.kind;
    if (kind === 'timeout') return { ok: false, code: 'timeout', message: publicError('timeout') };
    if (kind === 'dns' || kind === 'connection') return { ok: false, code: 'connection', message: publicError('connection') };
    return { ok: false, code: 'connection', message: publicError('connection') };
  }
  if (result.status === 401 || result.status === 403) {
    return { ok: false, code: 'auth', message: publicError('auth') };
  }
  if (result.status >= 500) {
    return { ok: false, code: 'connection', message: publicError('connection') };
  }
  const body = String(result.body || '').trim();
  if (body === '-1' || body === '0' || body === '-1.0') {
    return { ok: false, code: 'auth', message: publicError('nonce') };
  }
  return null;
}

async function refreshPluginInventory(website, pluginVersionOverrides) {
  const availability = await checkAvailability(website);
  const wordpress = await checkWordPress(website, availability.body, { pluginVersionOverrides });
  await websiteService.saveWebsiteSnapshot(website.id, {
    wordpress,
    lastCheckedAt: nowIso()
  });
}

function emitProgress(websiteId, jobId, payload) {
  emit('plugin:updateProgress', safePayload({ websiteId, jobId, ...payload }));
}

function emitCompleted(websiteId, jobId, items, forcedMessage) {
  const succeeded = countBy(items, 'success');
  const failed = countBy(items, 'failed');
  const total = items.length;
  let status = 'completed';
  const parts = [];
  if (succeeded) parts.push(`${succeeded} plugin${succeeded === 1 ? '' : 's'} updated successfully`);
  if (failed) parts.push(`${failed} plugin${failed === 1 ? '' : 's'} failed to update`);
  const message = parts.join('. ') || 'Plugin update finished.';
  if (failed && succeeded) status = 'partial';
  else if (failed && !succeeded) status = 'failed';
  emit(
    'plugin:updateCompleted',
    safePayload({
      websiteId,
      jobId,
      status,
      message: forcedMessage || message,
      total,
      succeeded,
      failed,
      items
    })
  );
}

function safePayload(payload) {
  return {
    websiteId: payload.websiteId,
    jobId: payload.jobId,
    status: payload.status,
    message: payload.message,
    index: payload.index || 0,
    total: payload.total || 0,
    succeeded: payload.succeeded || 0,
    failed: payload.failed || 0,
    current: payload.current
      ? {
          slug: payload.current.slug,
          name: payload.current.name,
          status: payload.current.status,
          error: payload.current.error || null,
          version: payload.current.version || null,
          newVersion: payload.current.newVersion || null
        }
      : null,
    items: (payload.items || []).map((item) => ({
      slug: item.slug,
      name: item.name,
      status: item.status,
      error: item.error || null,
      version: item.version || null,
      newVersion: item.newVersion || null
    }))
  };
}

function publicError(code, fallback) {
  if (code === 'timeout') return 'The plugin update timed out.';
  if (code === 'connection') return 'Could not reach the WordPress site.';
  if (code === 'nonce') return 'WordPress rejected the update request. The saved connection may have expired.';
  if (code === 'auth') {
    return fallback && !looksSensitive(fallback)
      ? fallback
      : 'Unable to sign in to WordPress admin. Check the saved connection.';
  }
  return fallback || GENERIC_JOB_ERROR;
}

function sanitizeWpMessage(message, fallback) {
  const text = String(message || '').replace(/<[^>]+>/g, '').trim();
  if (!text || looksSensitive(text)) return fallback;
  return text.slice(0, 280);
}

function looksSensitive(value) {
  return /password\s*[:=]|authorization\s*[:=]|cookie\s*[:=]|wordpress_logged_in_|bearer\s+[a-z0-9]|basic\s+[a-z0-9+/=]/i.test(
    String(value || '')
  );
}

function parseTrailingJson(body) {
  if (!body) return null;
  const match = String(body).match(/\{[\s\S]*\}\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function parseVersionLabel(value) {
  if (!value) return null;
  const match = String(value).match(/([0-9]+(?:\.[0-9]+){0,4})/);
  return match?.[1] || null;
}

async function applySuccessfulPluginVersions(websiteId, items) {
  const successes = items.filter((item) => item.status === 'success' && item.newVersion);
  if (!successes.length) return;

  const current = await websiteService.getWebsiteRecord(websiteId);
  if (!current) return;

  const successMap = new Map(successes.map((item) => [item.slug, item.newVersion]));
  const plugins = (current.wordpress?.plugins || []).map((plugin) => {
    const newVersion = successMap.get(plugin.slug);
    if (!newVersion) return plugin;
    const stillBehind = Boolean(plugin.latestVersion && compareVersions(newVersion, plugin.latestVersion) < 0);
    return { ...plugin, version: newVersion, updateAvailable: stillBehind };
  });

  await websiteService.saveWebsiteSnapshot(websiteId, {
    wordpress: { ...(current.wordpress || {}), plugins },
    lastCheckedAt: nowIso()
  });

  const pendingKeys = new Set();
  if (current.wordpress?.updateAvailable) pendingKeys.add('core:wordpress');
  for (const plugin of plugins) {
    if (plugin.updateAvailable) pendingKeys.add(`plugin:${plugin.slug}`);
  }
  for (const theme of current.wordpress?.themes || []) {
    if (theme.updateAvailable) pendingKeys.add(`theme:${theme.slug}`);
  }
  await resolveStaleUpdates(websiteId, pendingKeys);
}

function displayName(plugin) {
  return plugin.name || plugin.slug || 'Plugin';
}

function countBy(items, status) {
  return items.filter((item) => item.status === status).length;
}
