import { randomBytes, createHash } from 'crypto';
import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';
import { emit } from '../sockets/emitter.js';
import { assertSafeUrl } from '../utils/ssrf.js';
import { presentWebsite, presentWebsites, removeCredentials, stripSecrets } from './credentialService.js';

const FILE = config.files.websites;

export async function listWebsites({ type } = {}) {
  const items = await storage.findMany(FILE, (item) => (type ? item.type === type : true));
  const sorted = items.sort((a, b) => a.name.localeCompare(b.name));
  return presentWebsites(sorted);
}

export async function getWebsite(id) {
  const website = await storage.findOne(FILE, (item) => item.id === id);
  return presentWebsite(website);
}

/** Raw record for monitors that must not travel to the browser. */
export async function getWebsiteRecord(id) {
  return storage.findOne(FILE, (item) => item.id === id);
}

export async function getMonitoredWebsites() {
  return storage.findMany(FILE, (item) => item.monitoringEnabled !== false);
}

export async function createWebsite(input) {
  await assertSafeUrl(input.url);

  const existing = await storage.findOne(
    FILE,
    (item) => normalizeUrl(item.url) === normalizeUrl(input.url)
  );
  if (existing) {
    throw Object.assign(new Error('A website with this URL already exists'), { status: 409 });
  }

  const now = nowIso();
  const apiKey = randomBytes(24).toString('hex');
  const website = {
    id: createId('site'),
    name: input.name,
    url: new URL(input.url).toString().replace(/\/$/, ''),
    type: input.type,
    monitoringEnabled: input.monitoringEnabled !== false,
    status: 'unknown',
    responseTime: null,
    lastCheckedAt: null,
    lastError: null,
    notes: input.notes || '',
    ssl: null,
    wordpress: null,
    connector: {
      enabled: false,
      apiKeyHash: hashKey(apiKey),
      lastSeenAt: null
    },
    createdAt: now,
    updatedAt: now
  };

  await storage.insert(FILE, website);
  const presented = await presentWebsite(website);
  emit('website:updated', presented);
  return { website: presented, connectorApiKey: apiKey };
}

export async function updateWebsite(id, changes) {
  const current = await getWebsiteRecord(id);
  if (!current) return null;

  if (changes.url && normalizeUrl(changes.url) !== normalizeUrl(current.url)) {
    await assertSafeUrl(changes.url);
    const duplicate = await storage.findOne(
      FILE,
      (item) => item.id !== id && normalizeUrl(item.url) === normalizeUrl(changes.url)
    );
    if (duplicate) {
      throw Object.assign(new Error('A website with this URL already exists'), { status: 409 });
    }
    changes.url = new URL(changes.url).toString().replace(/\/$/, '');
  }

  const updated = await storage.update(FILE, id, {
    ...changes,
    updatedAt: nowIso()
  });
  const presented = await presentWebsite(updated);
  emit('website:updated', presented);
  if (changes.status && changes.status !== current.status) {
    emit('website:statusChanged', {
      websiteId: updated.id,
      previousStatus: current.status,
      status: updated.status
    });
  }
  return presented;
}

export async function deleteWebsite(id) {
  const deleted = await storage.remove(FILE, id);
  if (!deleted) return null;

  // Drop every stored record tied to this site so lists and stats stay accurate.
  await Promise.all([
    removeRecordsForWebsite(config.files.forms, id),
    removeRecordsForWebsite(config.files.incidents, id),
    removeRecordsForWebsite(config.files.updates, id),
    removeRecordsForWebsite(config.files.notifications, id),
    removeRecordsForWebsite(config.files.monitoring, id),
    removeRecordsForWebsite(config.files.formTests, id)
  ]);

  await removeCredentials(id);
  emit('website:updated', stripSecrets({ ...deleted, deleted: true }));
  return stripSecrets(deleted);
}

async function removeRecordsForWebsite(fileName, websiteId) {
  await storage.mutateCollection(fileName, (items) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].websiteId === websiteId) items.splice(i, 1);
    }
  });
}

export async function saveWebsiteSnapshot(id, snapshot) {
  const current = await getWebsiteRecord(id);
  if (!current) return null;

  const updated = await storage.update(FILE, id, {
    ...snapshot,
    updatedAt: nowIso()
  });

  const presented = await presentWebsite(updated);
  emit('website:updated', presented);
  if (snapshot.status && snapshot.status !== current.status) {
    emit('website:statusChanged', {
      websiteId: updated.id,
      previousStatus: current.status,
      status: updated.status,
      responseTime: updated.responseTime
    });
  }
  return presented;
}

export function regenerateConnectorKey(website) {
  const apiKey = randomBytes(24).toString('hex');
  return { apiKey, apiKeyHash: hashKey(apiKey) };
}

function hashKey(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeUrl(url) {
  return new URL(url).toString().replace(/\/$/, '').toLowerCase();
}
