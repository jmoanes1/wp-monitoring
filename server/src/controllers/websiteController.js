import * as websiteService from '../services/websiteService.js';
import * as incidentService from '../services/incidentService.js';
import * as credentialService from '../services/credentialService.js';
import { validateWebsiteInput } from '../utils/validators.js';
import { queueSiteCheck } from '../workers/monitorWorker.js';
import { checkWordPress } from '../monitors/wordpressMonitor.js';
import { checkAvailability } from '../monitors/availabilityMonitor.js';
import { testWordPressConnection } from '../monitors/wordpressConnectionMonitor.js';
import * as pluginUpdateService from '../services/pluginUpdateService.js';
import { nowIso } from '../utils/time.js';

async function persistAndConnect(website, credData) {
  // Save first (status becomes "configured"), then immediately test login so the UI
  // shows Connected or Connection Failed instead of staying Not Configured.
  const raw = website?.url ? website : await websiteService.getWebsiteRecord(website.id);
  await credentialService.upsertCredentials(raw || website, credData);
  const record = await websiteService.getWebsiteRecord(website.id);
  const decrypted = await credentialService.getDecryptedCredentials(website.id);
  if (!record || !decrypted) return null;
  try {
    return await testWordPressConnection(record, decrypted);
  } catch {
    await credentialService.updateConnectionStatus(website.id, {
      status: 'failed',
      lastTestedAt: nowIso()
    });
    return null;
  }
}

export async function list(req, res, next) {
  try {
    const websites = await websiteService.listWebsites({ type: req.query.type });
    res.json({ websites });
  } catch (error) {
    next(error);
  }
}

export async function getOne(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });
    const incidents = await incidentService.getIncidents({ websiteId: website.id });
    return res.json({ website, incidents });
  } catch (error) {
    next(error);
  }
}

export async function create(req, res, next) {
  try {
    const { errors, data } = validateWebsiteInput(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const cred = credentialService.validateCredentialFields(req.body || {});
    if (cred.errors.length) return res.status(400).json({ error: cred.errors[0] });
    if (cred.data && !cred.data.password) {
      return res.status(400).json({ error: 'WordPress password is required' });
    }

    const { website, connectorApiKey } = await websiteService.createWebsite(data);
    if (cred.data) {
      try {
        await persistAndConnect(website, cred.data);
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        await credentialService.updateConnectionStatus(website.id, {
          status: 'failed',
          lastTestedAt: nowIso()
        }).catch(() => {});
      }
    }
    const presented = await websiteService.getWebsite(website.id);
    queueSiteCheck(website.id).catch(() => {});
    return res.status(201).json({ website: presented, connectorApiKey });
  } catch (error) {
    next(error);
  }
}

export async function update(req, res, next) {
  try {
    const { errors, data } = validateWebsiteInput(req.body || {}, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors[0] });

    const website = await websiteService.updateWebsite(req.params.id, data);
    if (!website) return res.status(404).json({ error: 'Website not found' });

    const cred = credentialService.validateCredentialFields(req.body || {});
    if (cred.errors.length) return res.status(400).json({ error: cred.errors[0] });
    if (cred.data) {
      try {
        await persistAndConnect(website, {
          adminUrl: cred.data.adminUrl,
          username: cred.data.username,
          password: cred.data.password || undefined
        });
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        await credentialService.updateConnectionStatus(website.id, {
          status: 'failed',
          lastTestedAt: nowIso()
        }).catch(() => {});
      }
    }
    const presented = await websiteService.getWebsite(website.id);
    return res.json({ website: presented });
  } catch (error) {
    next(error);
  }
}

export async function remove(req, res, next) {
  try {
    const website = await websiteService.deleteWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function testWebsite(req, res, next) {
  try {
    const result = await queueSiteCheck(req.params.id);
    if (!result) return res.status(404).json({ error: 'Website not found' });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function checkUpdates(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });
    const availability = await checkAvailability(website);
    const wordpress = await checkWordPress(website, availability.body);
    const updated = await websiteService.saveWebsiteSnapshot(website.id, {
      wordpress,
      lastCheckedAt: nowIso()
    });
    return res.json({ website: updated, wordpress });
  } catch (error) {
    next(error);
  }
}

function pluginUpdateHttpResult(result, res) {
  if (result.error === 'not_found') return res.status(404).json({ error: 'Website not found' });
  if (result.error === 'busy') return res.status(409).json({ error: result.message });
  if (result.error === 'credentials' || result.error === 'none') {
    return res.status(400).json({ error: result.message });
  }
  return res.json(result);
}

export async function updatePlugin(req, res, next) {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,120}$/.test(slug)) {
      return res.status(400).json({ error: 'Invalid plugin slug' });
    }
    const result = await pluginUpdateService.startPluginUpdate(req.params.id, { slug });
    return pluginUpdateHttpResult(result, res);
  } catch (error) {
    next(error);
  }
}

export async function updateAllPlugins(req, res, next) {
  try {
    const result = await pluginUpdateService.startPluginUpdate(req.params.id, { all: true });
    return pluginUpdateHttpResult(result, res);
  } catch (error) {
    next(error);
  }
}

export async function listIncidents(req, res, next) {
  try {
    const incidents = await incidentService.getIncidents({ websiteId: req.params.id });
    return res.json({ incidents });
  } catch (error) {
    next(error);
  }
}

export async function getCredentials(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });
    const connection = await credentialService.getPublicConnection(website.id);
    return res.json({ connection });
  } catch (error) {
    next(error);
  }
}

export async function updateCredentials(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });
    const cred = credentialService.validateCredentialFields(req.body || {}, {
      requirePassword: Boolean(req.body?.password || req.body?.wordpressPassword) || false
    });
    if (cred.errors.length) return res.status(400).json({ error: cred.errors[0] });
    if (!cred.data) return res.status(400).json({ error: 'WordPress connection fields are required' });
    await persistAndConnect(website, {
      adminUrl: cred.data.adminUrl,
      username: cred.data.username,
      password: cred.data.password || undefined
    });
    const connection = await credentialService.getPublicConnection(website.id);
    const presented = await websiteService.getWebsite(website.id);
    return res.json({ connection, website: presented });
  } catch (error) {
    next(error);
  }
}

export async function testConnection(req, res, next) {
  try {
    const website = await websiteService.getWebsiteRecord(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });

    let credentials = null;
    try {
      credentials = await credentialService.getDecryptedCredentials(website.id);
    } catch {
      credentials = null;
    }
    const incomingPassword = req.body?.password || req.body?.wordpressPassword;
    const incomingUsername = req.body?.username || req.body?.wordpressUsername || credentials?.username;
    const incomingAdminUrl = req.body?.adminUrl || req.body?.wordpressAdminUrl || credentials?.adminUrl;

    if (incomingPassword) {
      credentials = {
        adminUrl: incomingAdminUrl,
        username: incomingUsername,
        password: incomingPassword
      };
    }

    if (!credentials?.username || !credentials?.password) {
      return res.status(400).json({ error: 'WordPress credentials are not configured' });
    }

    const result = await testWordPressConnection(website, credentials);
    const connection = await credentialService.getPublicConnection(website.id);
    const presented = await websiteService.getWebsite(website.id);
    return res.json({
      success: result.success,
      status: result.status,
      steps: result.steps,
      error: result.error || null,
      lastConnectedAt: connection.lastConnectedAt,
      connection,
      website: presented
    });
  } catch (error) {
    next(error);
  }
}

export async function regenerateConnector(req, res, next) {
  try {
    const website = await websiteService.getWebsite(req.params.id);
    if (!website) return res.status(404).json({ error: 'Website not found' });
    const { apiKey, apiKeyHash } = websiteService.regenerateConnectorKey(website);
    const updated = await websiteService.updateWebsite(website.id, {
      connector: {
        ...website.connector,
        enabled: true,
        apiKeyHash
      }
    });
    return res.json({ website: updated, connectorApiKey: apiKey });
  } catch (error) {
    next(error);
  }
}
