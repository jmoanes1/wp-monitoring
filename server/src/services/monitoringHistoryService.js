import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';

const FILE = config.files.monitoring;

export async function recordCheck(entry) {
  const settings = await storage.readDocument(config.files.settings, { maxHistoryRecords: 2000 });
  const max = settings.maxHistoryRecords || 2000;

  const record = {
    id: createId('check'),
    websiteId: entry.websiteId,
    type: entry.type,
    targetId: entry.targetId || null,
    previousStatus: entry.previousStatus || null,
    newStatus: entry.newStatus || null,
    message: entry.message || '',
    responseTime: entry.responseTime || null,
    checkedAt: nowIso()
  };

  await storage.mutateCollection(FILE, (items) => {
    items.unshift(record);
    if (items.length > max) {
      items.length = max;
    }
  });

  return record;
}

export async function getHistory({ websiteId, type, limit = 200 } = {}) {
  const items = await storage.findMany(FILE, (item) => {
    if (websiteId && item.websiteId !== websiteId) return false;
    if (type && item.type !== type) return false;
    return true;
  });
  return items
    .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))
    .slice(0, Math.min(limit, 500));
}
