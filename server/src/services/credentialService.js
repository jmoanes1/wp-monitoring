import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { nowIso } from '../utils/time.js';
import { encryptSecret, decryptSecret, encryptionConfigured } from '../utils/crypto.js';
import { assertSafeUrl, siteOrigins } from '../utils/ssrf.js';
import { emit } from '../sockets/emitter.js';
import { emptyFormTesting } from '../utils/formTestPayload.js';

const FILE = config.files.credentials;
const MASK = '••••••••••';

export function emptyPublicConnection() {
  return {
    configured: false,
    adminUrl: '',
    username: '',
    passwordMasked: MASK,
    status: 'not_configured',
    lastConnectedAt: null,
    lastTestedAt: null
  };
}

export function toPublicConnection(record) {
  if (!record || (!record.username && !record.adminUrl && !record.websiteId && !record.password)) {
    return emptyPublicConnection();
  }
  return {
    configured: true,
    adminUrl: record.adminUrl,
    username: record.username,
    passwordMasked: MASK,
    status: record.status && record.status !== 'not_configured'
      ? record.status
      : record.username
        ? 'configured'
        : 'not_configured',
    lastConnectedAt: record.lastConnectedAt || null,
    lastTestedAt: record.lastTestedAt || null
  };
}

export function stripSecrets(website) {
  if (!website || typeof website !== 'object') return website;
  const clone = { ...website };
  delete clone.password;
  delete clone.wordpressPassword;
  delete clone.wordpressUsername;
  delete clone.credentials;
  delete clone.passwordEncrypted;
  if (clone.wordpressConnection) {
    clone.wordpressConnection = toPublicConnection({
      adminUrl: clone.wordpressConnection.adminUrl,
      username: clone.wordpressConnection.username,
      status: clone.wordpressConnection.status,
      lastConnectedAt: clone.wordpressConnection.lastConnectedAt,
      lastTestedAt: clone.wordpressConnection.lastTestedAt
    });
    if (!clone.wordpressConnection.adminUrl && !clone.wordpressConnection.username) {
      clone.wordpressConnection = emptyPublicConnection();
    }
  }
  return clone;
}

export async function presentWebsite(website) {
  if (!website) return website;
  if (website.deleted) return stripSecrets(website);
  const record = await getRecord(website.id);
  return stripSecrets({
    ...website,
    formTesting: website.formTesting || emptyFormTesting(),
    wordpressConnection: toPublicConnection(record)
  });
}

export async function presentWebsites(websites) {
  return Promise.all((websites || []).map(presentWebsite));
}

export async function getRecord(websiteId) {
  return storage.findOne(FILE, (item) => item.websiteId === websiteId);
}

export async function getPublicConnection(websiteId) {
  return toPublicConnection(await getRecord(websiteId));
}

export async function getDecryptedCredentials(websiteId) {
  const record = await getRecord(websiteId);
  if (!record?.password) return null;
  try {
    return {
      adminUrl: record.adminUrl,
      username: record.username,
      password: decryptSecret(record.password)
    };
  } catch {
    return null;
  }
}

export async function upsertCredentials(website, input) {
  if (!encryptionConfigured()) {
    const error = new Error('Credential encryption key is not configured on the server');
    error.status = 503;
    throw error;
  }

  const existing = await getRecord(website.id);
  const adminUrl = normalizeAdminUrl(input.adminUrl || existing?.adminUrl, website.url);
  const username = String(input.username || existing?.username || '').trim();

  if (!adminUrl || !username) {
    const error = new Error('WordPress admin URL and username are required');
    error.status = 400;
    throw error;
  }

  await assertSafeUrl(adminUrl, { allowedOrigins: siteOrigins(website.url) });

  let passwordPayload = existing?.password;
  if (input.password) {
    passwordPayload = encryptSecret(input.password);
  }
  if (!passwordPayload) {
    const error = new Error('WordPress password is required');
    error.status = 400;
    throw error;
  }

  const now = nowIso();
  const record = {
    id: website.id,
    websiteId: website.id,
    adminUrl,
    username,
    password: passwordPayload,
    // Saved credentials are configured; persistAndConnect then tests and sets connected/failed.
    status: 'configured',
    lastConnectedAt: existing?.lastConnectedAt || null,
    lastTestedAt: existing?.lastTestedAt || null,
    updatedAt: now
  };

  await storage.mutateCollection(FILE, (items) => {
    const index = items.findIndex((item) => item.websiteId === website.id);
    if (index === -1) items.push(record);
    else items[index] = { ...items[index], ...record };
  });

  emit('website:updated', await presentWebsite(website));
  return toPublicConnection(record);
}

export async function updateConnectionStatus(websiteId, patch) {
  const existing = await getRecord(websiteId);
  if (!existing) return null;
  await storage.mutateCollection(FILE, (items) => {
    const index = items.findIndex((item) => item.websiteId === websiteId);
    if (index === -1) return;
    items[index] = {
      ...items[index],
      ...patch,
      updatedAt: nowIso()
    };
  });
  const website = await storage.findOne(config.files.websites, (item) => item.id === websiteId);
  if (website) emit('website:updated', await presentWebsite(website));
  return getPublicConnection(websiteId);
}

export async function removeCredentials(websiteId) {
  await storage.mutateCollection(FILE, (items) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].websiteId === websiteId) items.splice(i, 1);
    }
  });
}

function normalizeAdminUrl(raw, websiteUrl) {
  if (!raw || !String(raw).trim()) {
    return new URL('/wp-admin', websiteUrl).toString().replace(/\/$/, '');
  }
  const parsed = new URL(String(raw).trim(), websiteUrl);
  return parsed.toString().replace(/\/$/, '');
}

export function validateCredentialFields(payload, { requirePassword = false } = {}) {
  const errors = [];
  const adminUrl = payload.wordpressAdminUrl ?? payload.adminUrl;
  const username = payload.wordpressUsername ?? payload.wordpressUser;
  const password = payload.wordpressPassword ?? payload.wordpressPass;
  const hasAny = Boolean(adminUrl || username || password);

  if (!hasAny && !requirePassword) {
    return { errors, data: null };
  }

  if (!username || !String(username).trim()) errors.push('WordPress username is required');
  if (requirePassword && !password) errors.push('WordPress password is required');
  if (password && String(password).length > 500) errors.push('WordPress password is too long');
  if (username && String(username).length > 190) errors.push('WordPress username is too long');

  let parsedAdmin = adminUrl;
  if (adminUrl) {
    try {
      const parsed = new URL(String(adminUrl).trim(), payload.url || undefined);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push('WordPress admin URL must start with http:// or https://');
      } else {
        parsedAdmin = parsed.toString();
      }
    } catch {
      errors.push('WordPress admin URL is invalid');
    }
  }

  return {
    errors,
    data: {
      adminUrl: parsedAdmin || '',
      username: username ? String(username).trim() : '',
      password: password ? String(password) : ''
    }
  };
}
