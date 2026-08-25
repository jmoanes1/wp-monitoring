import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';
import { emit } from '../sockets/emitter.js';

const FILE = config.files.notifications;

/**
 * In-app notification service.
 * Email delivery is intentionally not implemented; sendEmailNotification()
 * is a reserved extension point for later SMTP/provider integration.
 */
const RECOVERY_TYPES = new Set(['website_online', 'update_resolved']);

export async function createNotification(input) {
  const notification = {
    id: createId('notif'),
    type: input.type,
    severity: input.severity || 'info',
    title: input.title,
    message: input.message,
    websiteId: input.websiteId || null,
    formId: input.formId || null,
    relatedId: input.relatedId || null,
    dedupeKey: input.dedupeKey || null,
    read: false,
    status: input.status || (RECOVERY_TYPES.has(input.type) ? 'resolved' : 'active'),
    criticalAlert: Boolean(input.criticalAlert),
    createdAt: nowIso(),
    resolvedAt: input.status === 'resolved' || RECOVERY_TYPES.has(input.type) ? nowIso() : null,
    metadata: input.metadata || {}
  };

  if (notification.dedupeKey) {
    const existing = await storage.findOne(
      FILE,
      (item) => item.dedupeKey === notification.dedupeKey && (item.status || 'active') === 'active'
    );
    if (existing) return existing;
  }

  await storage.insert(FILE, notification);
  emit('notification:new', notification);
  return notification;
}

export async function getNotifications({ unreadOnly = false } = {}) {
  const items = await storage.readCollection(FILE);
  const filtered = unreadOnly ? items.filter((item) => !item.read) : items;
  return filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function markAsRead(id) {
  const updated = await storage.update(FILE, id, { read: true, readAt: nowIso() });
  if (updated) emit('notification:updated', updated);
  return updated;
}

export async function markAllAsRead() {
  const updated = [];
  await storage.mutateCollection(FILE, (items) => {
    for (const item of items) {
      if (!item.read) {
        item.read = true;
        item.readAt = nowIso();
        updated.push(item);
      }
    }
  });
  updated.forEach((item) => emit('notification:updated', item));
  return updated;
}

export async function removeNotification(id) {
  const deleted = await storage.remove(FILE, id);
  if (deleted) emit('notification:updated', { ...deleted, deleted: true });
  return deleted;
}

export async function resolveNotification(relatedId, type) {
  const resolved = [];
  await storage.mutateCollection(FILE, (items) => {
    for (const item of items) {
      if (item.status === 'resolved') continue;
      const relatedMatch = relatedId && item.relatedId === relatedId;
      const typeMatch = !type || item.type === type;
      if (relatedMatch && typeMatch) {
        item.status = 'resolved';
        item.resolvedAt = nowIso();
        resolved.push({ ...item });
      }
    }
  });
  resolved.forEach((item) => emit('notification:updated', item));
  return resolved;
}

export async function resolveActiveByWebsite(websiteId, type) {
  const resolved = [];
  await storage.mutateCollection(FILE, (items) => {
    for (const item of items) {
      if (item.websiteId === websiteId && item.type === type && item.status !== 'resolved') {
        item.status = 'resolved';
        item.resolvedAt = nowIso();
        resolved.push({ ...item });
      }
    }
  });
  resolved.forEach((item) => emit('notification:updated', item));
  return resolved;
}

export async function findActive(predicate) {
  return storage.findOne(FILE, (item) => (item.status || 'active') === 'active' && predicate(item));
}

export async function hasRecentDedupe(dedupeKey) {
  if (!dedupeKey) return false;
  const existing = await storage.findOne(FILE, (item) => item.dedupeKey === dedupeKey);
  return Boolean(existing);
}

/**
 * Reserved for a later email channel. Must remain a no-op until SMTP
 * is explicitly configured in a future release.
 */
export async function sendEmailNotification() {
  return { sent: false, reason: 'email_disabled' };
}
