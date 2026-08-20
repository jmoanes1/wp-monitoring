import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso, secondsBetween } from '../utils/time.js';
import { emit } from '../sockets/emitter.js';
import { emptyFormTesting } from '../utils/formTestPayload.js';
import { presentWebsite } from './credentialService.js';

const FILE = config.files.forms;

export async function listForms({ websiteId, status } = {}) {
  const items = await storage.findMany(FILE, (item) => {
    if (websiteId && item.websiteId !== websiteId) return false;
    if (status && item.status !== status) return false;
    return true;
  });
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getForm(id) {
  return storage.findOne(FILE, (item) => item.id === id);
}

export function buildFormRecord(websiteId, detected) {
  const now = nowIso();
  return {
    id: createId('form'),
    websiteId,
    name: detected.name,
    url: detected.url,
    identifier: detected.identifier,
    method: detected.method || 'POST',
    action: detected.action || '',
    status: 'unknown',
    previousStatus: null,
    lastTestedAt: null,
    lastSuccessfulTestAt: null,
    lastFailedTestAt: null,
    firstBrokenAt: null,
    responseTime: null,
    errorMessage: null,
    criticalAlert: false,
    detectionMethod: detected.detectionMethod || 'html',
    safeTestConfigured: Boolean(detected.safeTestConfigured),
    formHealth: 'unknown',
    playwrightTest: {
      enabled: false,
      formUrl: detected.url || '',
      selector: '',
      mode: 'dry',
      schedule: 'manual',
      nextRunAt: null,
      lastRunAt: null,
      lastResult: null,
      lastMode: null
    },
    updatedAt: now
  };
}

export async function syncDetectedForms(websiteId, detectedForms) {
  const website = await storage.findOne(config.files.websites, (item) => item.id === websiteId);
  const ignored = new Set(website?.ignoredFormIdentifiers || []);
  const existing = await listForms({ websiteId });
  const byIdentifier = new Map(existing.map((form) => [form.identifier, form]));
  const seen = new Set();
  const synced = [];

  for (const detected of detectedForms) {
    if (ignored.has(detected.identifier)) continue;
    seen.add(detected.identifier);
    const current = byIdentifier.get(detected.identifier);
    if (current) {
      const updated = await storage.update(FILE, current.id, {
        name: detected.name || current.name,
        url: detected.url || current.url,
        method: detected.method || current.method,
        action: detected.action || current.action,
        updatedAt: nowIso()
      });
      synced.push(updated);
    } else {
      const created = await storage.insert(FILE, buildFormRecord(websiteId, detected));
      emit('form:updated', created);
      synced.push(created);
    }
  }

  // Previously detected forms stay in storage even if this scan used a
  // different page, unless the operator removed them from monitoring.
  for (const form of existing) {
    if (ignored.has(form.identifier)) continue;
    if (!seen.has(form.identifier)) synced.push(form);
  }

  return synced;
}

export async function saveFormStatus(id, patch) {
  const current = await getForm(id);
  if (!current) return null;

  const now = nowIso();
  const nextStatus = patch.status || current.status;
  const changes = {
    ...patch,
    previousStatus: current.status,
    lastTestedAt: now,
    updatedAt: now
  };

  if (nextStatus === 'working') {
    changes.lastSuccessfulTestAt = now;
    changes.errorMessage = null;
    changes.criticalAlert = false;
    if (current.status === 'broken') {
      changes.firstBrokenAt = null;
    }
  }

  if (nextStatus === 'broken') {
    changes.lastFailedTestAt = now;
    if (current.status !== 'broken') {
      changes.firstBrokenAt = current.firstBrokenAt || now;
    }
  }

  const updated = await storage.update(FILE, id, changes);
  emit('form:updated', updated);

  if (nextStatus !== current.status) {
    emit('form:statusChanged', {
      formId: updated.id,
      websiteId: updated.websiteId,
      previousStatus: current.status,
      status: nextStatus
    });
  }

  return updated;
}

export async function updatePlaywrightConfig(id, patch = {}) {
  const current = await getForm(id);
  if (!current) return null;
  const prev = current.playwrightTest || {};
  const schedule = ['manual', 'daily', 'weekly', 'friday'].includes(patch.schedule)
    ? patch.schedule
    : prev.schedule || 'manual';
  const mode = patch.mode === 'real' ? 'real' : patch.mode === 'dry' ? 'dry' : prev.mode || 'dry';
  const scheduleChanged = patch.schedule !== undefined && schedule !== (prev.schedule || 'manual');
  const playwrightTest = {
    ...prev,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : Boolean(prev.enabled),
    formUrl: patch.formUrl !== undefined ? String(patch.formUrl).trim() : prev.formUrl || current.url || '',
    selector: patch.selector !== undefined ? String(patch.selector).trim() : prev.selector || '',
    mode,
    schedule,
    nextRunAt: schedule === 'manual' ? null : scheduleChanged || !prev.nextRunAt ? computeNextRun(schedule) : prev.nextRunAt
  };
  const updated = await storage.update(FILE, id, { playwrightTest, updatedAt: nowIso() });
  emit('form:updated', updated);
  return updated;
}

function computeNextRun(schedule) {
  const from = new Date().toISOString();
  if (schedule === 'daily') {
    const date = new Date(from);
    date.setDate(date.getDate() + 1);
    return date.toISOString();
  }
  if (schedule === 'weekly') {
    const date = new Date(from);
    date.setDate(date.getDate() + 7);
    return date.toISOString();
  }
  if (schedule === 'friday') {
    const date = new Date(from);
    date.setDate(date.getDate() + 1);
    while (date.getDay() !== 5) date.setDate(date.getDate() + 1);
    return date.toISOString();
  }
  return null;
}

export async function countForms(websiteId) {
  const forms = await listForms({ websiteId });
  return forms.length;
}

/**
 * Remove a detected form from monitoring. The identifier is stored on the
 * website so the next HTML scan does not recreate it.
 */
export async function deleteForm(id) {
  const form = await getForm(id);
  if (!form) return null;

  const deleted = await storage.remove(FILE, id);
  if (!deleted) return null;

  await storage.mutateCollection(config.files.formTests, (items) => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].formId === id) items.splice(i, 1);
    }
  });

  const incident = await resolveFormIncident(form.websiteId, id);
  const website = await storage.findOne(config.files.websites, (item) => item.id === form.websiteId);
  let updatedWebsite = website;

  if (website) {
    const ignored = Array.from(new Set([...(website.ignoredFormIdentifiers || []), form.identifier].filter(Boolean)));
    const formCount = await countForms(form.websiteId);
    const previousTesting = website.formTesting || emptyFormTesting();
    const formTesting =
      previousTesting.lastTestId && !(await storage.findOne(config.files.formTests, (item) => item.id === previousTesting.lastTestId))
        ? { ...previousTesting, lastResult: null, lastTestId: null }
        : previousTesting;

    updatedWebsite = await presentWebsite(
      await storage.update(config.files.websites, website.id, {
        ignoredFormIdentifiers: ignored,
        formCount,
        formTesting,
        updatedAt: nowIso()
      })
    );
    emit('website:updated', updatedWebsite);
  }

  emit('form:updated', { ...deleted, deleted: true });
  if (incident) emit('incident:updated', incident);
  return { form: { ...deleted, deleted: true }, website: updatedWebsite, incident };
}

async function resolveFormIncident(websiteId, formId) {
  const active = await storage.findOne(
    config.files.incidents,
    (item) => item.status === 'active' && item.websiteId === websiteId && item.type === 'form' && item.formId === formId
  );
  if (!active) return null;
  const resolvedAt = nowIso();
  return storage.update(config.files.incidents, active.id, {
    status: 'resolved',
    resolvedAt,
    lastCheckedAt: resolvedAt,
    downtimeSeconds: secondsBetween(active.startedAt, resolvedAt),
    errorMessage: active.errorMessage
  });
}

/** Lead broken forms are critical alerts; non-lead broken forms are not. */
export async function syncFormPriority(websiteId, websiteType) {
  const forms = await listForms({ websiteId });
  const updated = [];
  for (const form of forms) {
    const criticalAlert = websiteType === 'lead' && form.status === 'broken';
    if (Boolean(form.criticalAlert) !== criticalAlert) {
      const next = await storage.update(FILE, form.id, { criticalAlert, updatedAt: nowIso() });
      emit('form:updated', next);
      updated.push(next);
    }
  }
  return updated;
}
