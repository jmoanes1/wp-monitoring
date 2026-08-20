import { createId } from '../utils/ids.js';
import { nowIso, addMonthsIso } from '../utils/time.js';
import { logger } from '../utils/logger.js';
import { emit } from '../sockets/emitter.js';
import { TEST_RECIPIENT, defaultPlaywrightTest } from '../utils/formTestPayload.js';
import { runPlaywrightFormTest } from '../workers/playwrightFormWorker.js';
import { pruneScreenshots, publicScreenshotUrl } from './screenshotStore.js';
import { sendPlaywrightTestReport } from './emailReportService.js';
import { getSettings } from './settingsService.js';
import * as websiteService from './websiteService.js';
import * as formService from './formService.js';
import * as formTestService from './formTestService.js';

const running = new Map();

export function isPlaywrightTestRunning(formId) {
  return running.has(formId);
}

export async function startPlaywrightFormTest({ websiteId, formId, mode, trigger = 'manual' }) {
  const website = await websiteService.getWebsiteRecord(websiteId);
  const form = await formService.getForm(formId);
  if (!website || !form || form.websiteId !== websiteId) {
    return { error: 'not_found', message: 'Website or form not found' };
  }

  const settings = await getSettings();
  const requestedMode = mode === 'real' ? 'real' : 'dry';
  if (requestedMode === 'real' && !settings.allowRealTestSubmissions) {
    return { error: 'forbidden', message: 'Real Test Submission is turned off in Settings.' };
  }
  if (running.has(formId) || running.has(`site:${websiteId}`)) {
    return { error: 'busy', message: 'A form test is already running for this form.' };
  }

  const testId = createId('ftest');
  running.set(formId, { testId, startedAt: Date.now(), mode: requestedMode });

  emit('formTest:started', {
    websiteId,
    formId,
    jobId: testId,
    engine: 'playwright',
    mode: requestedMode,
    status: 'running',
    message: 'Testing form...',
    steps: []
  });

  setImmediate(() => {
    execute({ website, form, mode: requestedMode, testId, trigger })
      .catch((error) => {
        logger.error('Playwright test job failed', { message: error.message, formId });
        emit('formTest:completed', {
          websiteId,
          formId,
          jobId: testId,
          engine: 'playwright',
          status: 'failed',
          message: 'Browser test failed. Please try again.',
          results: []
        });
      })
      .finally(() => running.delete(formId));
  });

  return { started: true, jobId: testId, mode: requestedMode, engine: 'playwright' };
}

async function execute({ website, form, mode, testId, trigger }) {
  const startedAt = nowIso();
  logger.info('Playwright form test started', {
    testId,
    websiteId: website.id,
    formId: form.id,
    mode,
    trigger
  });
  const raw = await runPlaywrightFormTest({
    website,
    form,
    mode,
    testId,
    onStage: ({ stage, message, steps }) => {
      emit('formTest:progress', {
        websiteId: website.id,
        formId: form.id,
        jobId: testId,
        engine: 'playwright',
        mode,
        status: 'running',
        stage,
        message,
        steps,
        current: { formId: form.id, name: form.name, status: 'testing' }
      });
    }
  });

  const screenshots = (raw.screenshots || []).map((filename) => ({
    filename,
    url: publicScreenshotUrl(testId, filename)
  }));

  const draft = {
    id: testId,
    websiteId: website.id,
    websiteName: website.name,
    formId: form.id,
    formName: form.name,
    formUrl: form.playwrightTest?.formUrl || form.url,
    trigger,
    engine: 'playwright',
    mode,
    recipient: TEST_RECIPIENT,
    startedAt,
    completedAt: nowIso(),
    durationMs: raw.durationMs,
    overall: raw.overall,
    status: raw.status,
    success: raw.success,
    submitted: Boolean(raw.submitted),
    errorCode: raw.errorCode,
    failedStep: raw.failedStep,
    checks: [],
    fieldsTested: raw.fieldsTested || [],
    confirmationMessage: raw.confirmationMessage || null,
    errorMessage: raw.success ? null : raw.message,
    message: raw.message,
    screenshots,
    notes: raw.notes || []
  };

  let emailReport = null;
  if (mode === 'real') {
    emailReport = await sendPlaywrightTestReport({ website, form, test: draft });
  }
  const saved = await formTestService.saveFormTest({ ...draft, emailReport });

  const formHealth = raw.status === 'blocked' ? 'blocked' : raw.success ? 'working' : 'broken';
  const pw = { ...defaultPlaywrightTest(form), ...(form.playwrightTest || {}) };
  await formService.saveFormStatus(form.id, {
    status: formHealth === 'working' ? 'working' : formHealth === 'blocked' ? form.status : 'broken',
    formHealth,
    errorMessage: raw.success ? null : raw.message,
    lastPlaywrightTest: {
      testId: saved.id,
      at: saved.completedAt,
      result: saved.overall,
      mode,
      durationMs: saved.durationMs
    },
    playwrightTest: {
      ...pw,
      lastRunAt: saved.completedAt,
      lastResult: saved.overall,
      lastMode: mode,
      nextRunAt: nextRunAt(pw.schedule, saved.completedAt)
    }
  });

  const settings = await getSettings();
  await pruneScreenshots(settings.screenshotRetentionHours || 24);

  emit('formTest:completed', {
    websiteId: website.id,
    formId: form.id,
    jobId: testId,
    engine: 'playwright',
    mode,
    status: raw.success ? 'completed' : raw.status,
    message: raw.message,
    results: [saved]
  });
}

function nextRunAt(schedule, fromIso) {
  if (schedule === 'daily') return addDays(fromIso, 1);
  if (schedule === 'weekly') return addDays(fromIso, 7);
  if (schedule === 'friday') {
    const date = new Date(fromIso);
    date.setDate(date.getDate() + 1);
    while (date.getDay() !== 5) date.setDate(date.getDate() + 1);
    return date.toISOString();
  }
  return null;
}

function addDays(iso, days) {
  const date = new Date(iso);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export async function runDuePlaywrightFormTests() {
  const settings = await getSettings();
  const websites = await websiteService.getMonitoredWebsites();
  const now = Date.now();
  for (const website of websites) {
    const forms = await formService.listForms({ websiteId: website.id });
    for (const form of forms) {
      const pw = form.playwrightTest || {};
      if (!pw.enabled || pw.schedule === 'manual' || !pw.nextRunAt) continue;
      if (new Date(pw.nextRunAt).getTime() > now) continue;
      if (running.has(form.id)) continue;
      const mode = pw.mode === 'real' && settings.allowRealTestSubmissions ? 'real' : 'dry';
      logger.info('Starting scheduled Playwright form test', { formId: form.id, mode });
      await startPlaywrightFormTest({ websiteId: website.id, formId: form.id, mode, trigger: 'schedule' });
    }
  }
}

export { addMonthsIso };
