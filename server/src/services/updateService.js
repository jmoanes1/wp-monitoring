import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';
import { emit } from '../sockets/emitter.js';
import { createNotification, hasRecentDedupe, resolveNotification } from './notificationService.js';
import { recordCheck } from './monitoringHistoryService.js';

const FILE = config.files.updates;

export async function getUpdates({ websiteId, status } = {}) {
  const items = await storage.findMany(FILE, (item) => {
    if (websiteId && item.websiteId !== websiteId) return false;
    if (status && item.status !== status) return false;
    return true;
  });
  return items.sort((a, b) => new Date(b.detectedAt) - new Date(a.detectedAt));
}

export async function upsertPendingUpdate({
  websiteId,
  websiteName,
  type,
  name,
  slug,
  currentVersion,
  availableVersion
}) {
  const existing = await storage.findOne(
    FILE,
    (item) =>
      item.websiteId === websiteId &&
      item.type === type &&
      item.slug === slug &&
      item.status === 'pending'
  );

  const sameVersions =
    existing &&
    existing.currentVersion === currentVersion &&
    existing.availableVersion === availableVersion;

  if (sameVersions) {
    return storage.update(FILE, existing.id, { lastSeenAt: nowIso() });
  }

  if (existing && !sameVersions) {
    await storage.update(FILE, existing.id, {
      status: 'resolved',
      resolvedAt: nowIso()
    });
  }

  const record = await storage.insert(FILE, {
    id: createId('upd'),
    websiteId,
    type,
    name,
    slug,
    currentVersion,
    availableVersion,
    status: 'pending',
    detectedAt: nowIso(),
    lastSeenAt: nowIso(),
    resolvedAt: null
  });

  const dedupeKey = `update:${websiteId}:${type}:${slug}:${currentVersion}:${availableVersion}`;
  const label = type === 'core' ? 'WORDPRESS UPDATE' : type === 'plugin' ? 'PLUGIN UPDATE' : 'THEME UPDATE';
  const historyType = type === 'core' ? 'wordpress' : type;

  if (!(await hasRecentDedupe(dedupeKey))) {
    await createNotification({
      type: 'update_detected',
      severity: 'warning',
      title: label,
      status: 'active',
      message: `${websiteName}: ${name} ${currentVersion || 'unknown'} → ${availableVersion}`,
      websiteId,
      relatedId: record.id,
      dedupeKey,
      metadata: {
        websiteName,
        name,
        currentVersion,
        availableVersion,
        type,
        detectedAt: record.detectedAt
      }
    });
  }

  await recordCheck({
    websiteId,
    type: historyType,
    targetId: record.id,
    previousStatus: currentVersion,
    newStatus: availableVersion,
    message: `${name} ${currentVersion || 'unknown'} → ${availableVersion}`
  });

  emit('update:detected', record);
  return record;
}

export async function resolveStaleUpdates(websiteId, stillPendingKeys) {
  const pending = await storage.findMany(
    FILE,
    (item) => item.websiteId === websiteId && item.status === 'pending'
  );

  const resolved = [];
  for (const item of pending) {
    const key = `${item.type}:${item.slug}`;
    if (!stillPendingKeys.has(key)) {
      const updated = await storage.update(FILE, item.id, {
        status: 'resolved',
        resolvedAt: nowIso()
      });
      await resolveNotification(item.id, 'update_detected');
      await recordCheck({
        websiteId,
        type: item.type === 'core' ? 'wordpress' : item.type,
        targetId: item.id,
        previousStatus: 'pending',
        newStatus: 'resolved',
        message: `${item.name} update resolved`
      });
      emit('update:resolved', updated);
      resolved.push(updated);
    }
  }
  return resolved;
}
