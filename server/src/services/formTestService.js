import { config } from '../config/index.js';
import { storage } from '../storage/jsonStorage.js';
import { createId } from '../utils/ids.js';
import { nowIso } from '../utils/time.js';
import { emit } from '../sockets/emitter.js';
import { TEST_RECIPIENT } from '../utils/formTestPayload.js';

const FILE = config.files.formTests;

export async function listFormTests({ websiteId, formId, limit = 80 } = {}) {
  const items = await storage.findMany(FILE, (item) => {
    if (websiteId && item.websiteId !== websiteId) return false;
    if (formId && item.formId !== formId) return false;
    return true;
  });
  return items.sort((a, b) => new Date(b.completedAt || b.startedAt) - new Date(a.completedAt || a.startedAt)).slice(0, limit);
}

export async function getFormTest(id) {
  return storage.findOne(FILE, (item) => item.id === id);
}

export async function latestFormTest(websiteId, formId) {
  const items = await listFormTests({ websiteId, formId, limit: 1 });
  return items[0] || null;
}

export async function saveFormTest(record) {
  const stored = await storage.insert(FILE, {
    id: record.id || createId('ftest'),
    websiteId: record.websiteId,
    websiteName: record.websiteName,
    formId: record.formId,
    formName: record.formName,
    formUrl: record.formUrl,
    trigger: record.trigger || 'manual',
    recipient: record.recipient || TEST_RECIPIENT,
    startedAt: record.startedAt,
    completedAt: record.completedAt || nowIso(),
    durationMs: record.durationMs || 0,
    overall: record.overall,
    status: record.status || record.overall,
    success: record.success,
    engine: record.engine || 'http',
    mode: record.mode || null,
    submitted: Boolean(record.submitted),
    errorCode: record.errorCode || null,
    failedStep: record.failedStep || null,
    message: record.message || null,
    screenshots: record.screenshots || [],
    notes: record.notes || [],
    emailReport: record.emailReport || null,
    checks: record.checks || [],
    fieldsTested: record.fieldsTested || [],
    confirmationMessage: record.confirmationMessage || null,
    responseStatus: record.responseStatus || null,
    errorMessage: record.errorMessage || null
  });
  emit('formTest:saved', stored);
  return stored;
}

export function publicFormTest(record) {
  if (!record) return record;
  return {
    ...record,
    recipient: TEST_RECIPIENT
  };
}
