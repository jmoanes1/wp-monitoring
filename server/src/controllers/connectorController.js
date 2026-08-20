import { createHash } from 'crypto';
import * as websiteService from '../services/websiteService.js';
import { nowIso } from '../utils/time.js';
import { logger } from '../utils/logger.js';

/**
 * Optional WordPress connector ingest.
 * The dashboard works without a connector; these routes exist so a future
 * plugin can report plugin/theme versions using Site ID + API key.
 */
export async function heartbeat(req, res, next) {
  try {
    const website = await authorizeConnector(req, res);
    if (!website) return;
    await websiteService.updateWebsite(website.id, {
      connector: {
        ...website.connector,
        enabled: true,
        lastSeenAt: nowIso()
      }
    });
    res.json({ ok: true, siteId: website.id });
  } catch (error) {
    next(error);
  }
}

export async function report(req, res, next) {
  try {
    const website = await authorizeConnector(req, res);
    if (!website) return;
    logger.info(`Connector report received for ${website.name}`);
    await websiteService.updateWebsite(website.id, {
      connector: {
        ...website.connector,
        enabled: true,
        lastSeenAt: nowIso()
      }
    });
    res.json({ ok: true, accepted: true });
  } catch (error) {
    next(error);
  }
}

async function authorizeConnector(req, res) {
  const siteId = req.headers['x-site-id'] || req.body?.siteId;
  const apiKey = req.headers['x-api-key'] || req.body?.apiKey;
  if (!siteId || !apiKey) {
    res.status(401).json({ error: 'Site ID and API key are required' });
    return null;
  }
  const website = await websiteService.getWebsite(siteId);
  const hash = createHash('sha256').update(String(apiKey)).digest('hex');
  if (!website || website.connector?.apiKeyHash !== hash) {
    res.status(401).json({ error: 'Invalid connector credentials' });
    return null;
  }
  return website;
}
