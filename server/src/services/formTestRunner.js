import { createId } from '../utils/ids.js';
import { nowIso, addMonthsIso } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { emit } from '../sockets/emitter.js';
import { TEST_RECIPIENT, emptyFormTesting } from '../utils/formTestPayload.js';
import { submitMonitoringFormTest } from '../monitors/formSubmissionTester.js';
import * as websiteService from './websiteService.js';
import * as formService from './formService.js';
import * as formTestService from './formTestService.js';
import * as notificationService from './notificationService.js';
import { detectAndMonitorForms } from '../monitors/formMonitor.js';
import { checkAvailability } from '../monitors/availabilityMonitor.js';

const runningJobs = new Map();

export function isFormTestRunning(websiteId) {
  return runningJobs.has(websiteId);
}

export async function startWebsiteFormTests(websiteId, { formId = null, trigger = 'manual' } = {}) {
  const website = await websiteService.getWebsiteRecord(websiteId);
  if (!website) return { error: 'not_found' };
  if (runningJobs.has(websiteId)) {
    return { error: 'busy', message: 'A form test is already running for this website.' };
  }

  const jobId = createId('fjob');
  runningJobs.set(websiteId, { jobId, startedAt: Date.now(), trigger });

  emit('form:testStarted', { websiteId, name: website.name, jobId, trigger });
  emit('formTest:started', {
    websiteId,
    jobId,
    trigger,
    status: 'running',
    message: trigger === 'monthly' ? 'Running monthly form test...' : 'Testing forms...'
  });

  setImmediate(() => {
    runWebsiteFormTests(website, { formId, trigger, jobId })
      .catch((error) => {
        logger.error('Form test job failed', { websiteId, message: error.message });
        emit('formTest:completed', {
          websiteId,
          jobId,
          status: 'failed',
          message: 'Form test failed. Please try again.',
          results: []
        });
        emit('form:testCompleted', { websiteId, formCount: 0, results: [] });
      })
      .finally(() => runningJobs.delete(websiteId));
  });

  return { started: true, jobId, trigger };
}

export async function runDueMonthlyFormTests() {
  const websites = await websiteService.getMonitoredWebsites();
  const now = Date.now();
  for (const website of websites) {
    const schedule = website.formTesting || emptyFormTesting();
    if (!schedule.monthlyEnabled || !schedule.nextTestAt) continue;
    if (new Date(schedule.nextTestAt).getTime() > now) continue;
    if (runningJobs.has(website.id)) continue;
    logger.info('Starting monthly form test', { websiteId: website.id });
    await startWebsiteFormTests(website.id, { trigger: 'monthly' });
  }
}

async function runWebsiteFormTests(website, { formId, trigger, jobId }) {
  let forms = await formService.listForms({ websiteId: website.id });
  if (!forms.length) {
    const availability = await checkAvailability(website);
    await detectAndMonitorForms(website, availability.body);
    forms = await formService.listForms({ websiteId: website.id });
  }
  if (formId) forms = forms.filter((item) => item.id === formId);

  const results = [];
  for (let index = 0; index < forms.length; index += 1) {
    const form = forms[index];
    emitProgress(website.id, jobId, {
      status: 'running',
      message: `Testing ${form.name}...`,
      index: index + 1,
      total: forms.length,
      current: { formId: form.id, name: form.name, status: 'testing' },
      items: progressItems(forms, results, form.id)
    });
    emit('form:testProgress', {
      websiteId: website.id,
      formId: form.id,
      name: form.name,
      status: 'testing',
      message: `Testing ${form.name}...`
    });

    const startedAt = nowIso();
    const raw = await submitMonitoringFormTest(website, form);
    // Site-wide runs skip search/login forms so they do not pull the overall result down.
    if (raw.skipped && !formId) continue;

    const saved = await formTestService.saveFormTest({
      websiteId: website.id,
      websiteName: website.name,
      formId: form.id,
      formName: form.name,
      formUrl: form.url,
      trigger,
      recipient: TEST_RECIPIENT,
      startedAt,
      completedAt: nowIso(),
      durationMs: raw.durationMs,
      overall: raw.overall,
      checks: raw.checks,
      fieldsTested: raw.fieldsTested,
      confirmationMessage: raw.confirmationMessage,
      responseStatus: raw.responseStatus,
      errorMessage: raw.errorMessage
    });
    results.push(saved);

    await formService.saveFormStatus(form.id, {
      lastSubmissionTest: {
        testId: saved.id,
        at: saved.completedAt,
        result: saved.overall,
        durationMs: saved.durationMs,
        confirmationMessage: saved.confirmationMessage,
        recipient: TEST_RECIPIENT
      }
    });

    emit('form:testProgress', {
      websiteId: website.id,
      formId: form.id,
      name: form.name,
      status: saved.overall === 'passed' ? 'working' : saved.overall === 'partially_passed' ? 'warning' : 'broken',
      message: saved.confirmationMessage || saved.errorMessage || saved.overall
    });

    if (trigger === 'monthly' && saved.overall === 'failed') {
      await notifyMonthlyFailure(website, form, saved);
    }
  }

  const latestForms = await formService.listForms({ websiteId: website.id });
  if (results.length) await persistSchedule(website, results, trigger);

  const failed = results.filter((item) => item.overall === 'failed').length;
  const passed = results.filter((item) => item.overall === 'passed').length;
  const status = !results.length ? 'failed' : failed && passed ? 'partial' : failed ? 'failed' : 'completed';
  const message = summaryMessage(results);

  emit('formTest:completed', {
    websiteId: website.id,
    jobId,
    status,
    message,
    trigger,
    results,
    items: results.map((item) => ({
      formId: item.formId,
      name: item.formName,
      status: item.overall
    }))
  });
  emit('form:testCompleted', {
    websiteId: website.id,
    formCount: latestForms.length,
    results: latestForms
  });
}

function emitProgress(websiteId, jobId, payload) {
  emit('formTest:progress', { websiteId, jobId, ...payload });
}

function progressItems(forms, results, currentId) {
  const byForm = new Map(results.map((item) => [item.formId, item]));
  return forms.map((form) => {
    const saved = byForm.get(form.id);
    if (saved) return { formId: form.id, name: form.name, status: saved.overall };
    if (form.id === currentId) return { formId: form.id, name: form.name, status: 'testing' };
    return { formId: form.id, name: form.name, status: 'pending' };
  });
}

async function persistSchedule(website, results, trigger) {
  const current = (await websiteService.getWebsiteRecord(website.id)) || website;
  const previous = current.formTesting || emptyFormTesting();
  const last = results[results.length - 1] || null;
  const failed = results.some((item) => item.overall === 'failed');
  const partial = results.some((item) => item.overall === 'partially_passed');
  const lastResult = !results.length ? 'failed' : failed ? 'failed' : partial ? 'partially_passed' : 'passed';
  const completedAt = last?.completedAt || nowIso();
  const nextTestAt = previous.monthlyEnabled ? addMonthsIso(completedAt, 1) : previous.nextTestAt;
  await websiteService.saveWebsiteSnapshot(website.id, {
    formTesting: {
      ...previous,
      lastTestAt: completedAt,
      lastResult,
      lastTestId: last?.id || null,
      nextTestAt,
      lastTrigger: trigger
    }
  });
}

async function notifyMonthlyFailure(website, form, test) {
  await notificationService.createNotification({
    type: 'form_test_failed',
    severity: website.type === 'lead' ? 'critical' : 'warning',
    title: 'FORM TEST FAILED',
    status: 'active',
    criticalAlert: website.type === 'lead',
    message: `${website.name} — ${form.name}: monthly form test failed`,
    websiteId: website.id,
    formId: form.id,
    relatedId: test.id,
    dedupeKey: `form_test_failed:${website.id}:${form.id}:${String(test.completedAt).slice(0, 10)}`,
    metadata: {
      websiteName: website.name,
      formName: form.name,
      recipient: TEST_RECIPIENT,
      overall: test.overall,
      errorMessage: test.errorMessage,
      testedAt: test.completedAt
    }
  });
}

function summaryMessage(results) {
  const passed = results.filter((item) => item.overall === 'passed').length;
  const failed = results.filter((item) => item.overall === 'failed').length;
  const partial = results.filter((item) => item.overall === 'partially_passed').length;
  const parts = [];
  if (passed) parts.push(`${passed} passed`);
  if (partial) parts.push(`${partial} partially passed`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(', ') || 'No contact forms were available to test';
}
