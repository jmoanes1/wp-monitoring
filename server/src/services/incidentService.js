import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso, secondsBetween } from '../utils/time.js';

const FILE = config.files.incidents;

export async function openIncident({ websiteId, formId = null, type = 'availability', severity = 'critical', errorMessage }) {
  const active = await storage.findOne(
    FILE,
    (item) =>
      item.status === 'active' &&
      item.websiteId === websiteId &&
      item.type === type &&
      (formId ? item.formId === formId : !item.formId)
  );

  if (active) {
    return storage.update(FILE, active.id, {
      lastCheckedAt: nowIso(),
      errorMessage: errorMessage || active.errorMessage
    });
  }

  return storage.insert(FILE, {
    id: createId('incident'),
    websiteId,
    formId,
    type,
    status: 'active',
    severity,
    startedAt: nowIso(),
    lastCheckedAt: nowIso(),
    resolvedAt: null,
    downtimeSeconds: null,
    errorMessage: errorMessage || null
  });
}

export async function resolveIncident({ websiteId, formId = null, type = 'availability' }) {
  const active = await storage.findOne(
    FILE,
    (item) =>
      item.status === 'active' &&
      item.websiteId === websiteId &&
      item.type === type &&
      (formId ? item.formId === formId : !item.formId)
  );

  if (!active) return null;

  const resolvedAt = nowIso();
  return storage.update(FILE, active.id, {
    status: 'resolved',
    resolvedAt,
    lastCheckedAt: resolvedAt,
    downtimeSeconds: secondsBetween(active.startedAt, resolvedAt)
  });
}

export async function getIncidents({ websiteId, status } = {}) {
  const items = await storage.findMany(FILE, (item) => {
    if (websiteId && item.websiteId !== websiteId) return false;
    if (status && item.status !== status) return false;
    return true;
  });
  return items.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}
