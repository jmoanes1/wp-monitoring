import { safeFetch } from '../utils/httpClient.js';
import { originOf } from '../utils/ssrf.js';
import { detectFormsFromHtml, pageHasForm } from './formDetector.js';
import * as formService from '../services/formService.js';
import * as incidentService from '../services/incidentService.js';
import * as notificationService from '../services/notificationService.js';
import * as historyService from '../services/monitoringHistoryService.js';
import { emit, emitToSocket } from '../sockets/emitter.js';
import { formatDuration } from '../utils/time.js';
import { isLeadWebsite, websiteTypeLabel, statusLabel } from '../utils/labels.js';

/**
 * Form health checks never POST customer data.
 * Working means: page reachable, form still present, and the form action
 * endpoint responds as an available resource (including 405 Method Not Allowed).
 */
export async function detectAndMonitorForms(website, homepageHtml, { socketId = null, emitProgress = false } = {}) {
  const progress = (payload) => {
    if (emitProgress) emit('form:testProgress', { websiteId: website.id, ...payload });
    if (socketId) emitToSocket(socketId, 'form:testProgress', { websiteId: website.id, ...payload });
  };

  progress({ stage: 'detecting', message: 'Finding forms...' });
  const detected = await discoverForms(website, homepageHtml);
  const forms = await formService.syncDetectedForms(website.id, detected);
  progress({ stage: 'detected', message: `${forms.length} forms found`, formCount: forms.length, forms });

  const results = [];
  for (const form of forms) {
    progress({
      stage: 'testing',
      formId: form.id,
      name: form.name,
      status: 'testing',
      message: `Testing ${form.name}...`
    });

    const tested = await testForm(website, form, homepageHtml);
    const handled = await applyFormResult(website, form, tested);
    results.push(handled);

    progress({
      stage: 'tested',
      formId: handled.id,
      name: handled.name,
      status: handled.status,
      message: handled.errorMessage || `${handled.name} ${handled.status}`
    });
  }

  return results;
}

async function discoverForms(website, homepageHtml) {
  const found = detectFormsFromHtml(website.url, homepageHtml);
  if (found.length > 0) return found;

  const allowedOrigins = [originOf(website.url)];
  const extraPaths = ['/contact', '/contact-us', '/appointment', '/book-appointment', '/get-in-touch'];
  for (const extraPath of extraPaths) {
    const url = new URL(extraPath, website.url).toString();
    const page = await safeFetch(url, { allowedOrigins });
    if (!page.ok) continue;
    const detected = detectFormsFromHtml(url, page.body);
    if (detected.length) return detected;
  }
  return found;
}

export async function testForm(website, form, knownHtml = null) {
  const allowedOrigins = [originOf(website.url)];
  const page = knownHtml && form.url === website.url
    ? { ok: true, status: 200, body: knownHtml, responseTime: 0, url: website.url }
    : await safeFetch(form.url || website.url, { allowedOrigins });

  if (!page.ok && page.status === 0) {
    return {
      status: 'broken',
      responseTime: page.responseTime,
      errorMessage: page.error?.message || 'Form page is unreachable'
    };
  }

  if (page.status >= 500) {
    return {
      status: 'broken',
      responseTime: page.responseTime,
      errorMessage: `HTTP ${page.status}`
    };
  }

  const stillPresent =
    pageHasForm(page.body, form.identifier) ||
    detectFormsFromHtml(form.url || website.url, page.body).some((item) => item.identifier === form.identifier);
  if (!stillPresent) {
    return {
      status: 'broken',
      responseTime: page.responseTime,
      errorMessage: 'Form is missing from the page'
    };
  }

  if (form.action && form.action !== form.url) {
    const endpoint = await probeEndpoint(form.action, allowedOrigins);
    if (endpoint.status === 'broken') {
      return {
        status: 'broken',
        responseTime: endpoint.responseTime,
        errorMessage: endpoint.errorMessage
      };
    }
    if (endpoint.status === 'warning') {
      return {
        status: 'warning',
        responseTime: endpoint.responseTime,
        errorMessage: endpoint.errorMessage
      };
    }
  }

  return {
    status: 'working',
    responseTime: page.responseTime,
    errorMessage: null
  };
}

async function probeEndpoint(actionUrl, allowedOrigins) {
  const result = await safeFetch(actionUrl, {
    method: 'GET',
    allowedOrigins
  });

  if (result.error?.kind === 'timeout') {
    return { status: 'broken', responseTime: result.responseTime, errorMessage: 'Form endpoint timed out' };
  }
  if (result.status >= 500) {
    return { status: 'broken', responseTime: result.responseTime, errorMessage: `HTTP ${result.status}` };
  }
  if (result.status === 404) {
    return { status: 'broken', responseTime: result.responseTime, errorMessage: 'Form endpoint not found (HTTP 404)' };
  }
  if ([401, 403, 405, 400, 200, 301, 302].includes(result.status) || result.ok) {
    return { status: 'working', responseTime: result.responseTime, errorMessage: null };
  }
  if (result.status === 0) {
    return { status: 'warning', responseTime: result.responseTime, errorMessage: result.error?.message || 'Endpoint probe failed' };
  }
  return { status: 'warning', responseTime: result.responseTime, errorMessage: `HTTP ${result.status}` };
}

export async function applyFormResult(website, form, result) {
  const previousStatus = form.status;
  const lead = isLeadWebsite(website);
  const updated = await formService.saveFormStatus(form.id, {
    status: result.status,
    responseTime: result.responseTime,
    errorMessage: result.errorMessage,
    criticalAlert: result.status === 'broken' && lead
  });

  await historyService.recordCheck({
    websiteId: website.id,
    type: 'form',
    targetId: form.id,
    previousStatus,
    newStatus: result.status,
    message: result.errorMessage || `Form ${result.status}`,
    responseTime: result.responseTime
  });

  if (previousStatus !== 'broken' && result.status === 'broken') {
    const incident = await incidentService.openIncident({
      websiteId: website.id,
      formId: form.id,
      type: 'form',
      severity: lead ? 'critical' : 'warning',
      errorMessage: result.errorMessage
    });

    const alreadyAlerted = await notificationService.findActive(
      (item) => item.formId === form.id && item.type === 'form_broken'
    );

    let notification = alreadyAlerted;
    if (!alreadyAlerted) {
      notification = await notificationService.createNotification({
        type: 'form_broken',
        severity: lead ? 'critical' : 'warning',
        title: 'FORM BROKEN',
        status: 'active',
        criticalAlert: lead,
        message: `${website.name} — ${form.name}: ${result.errorMessage || 'Broken'}`,
        websiteId: website.id,
        formId: form.id,
        relatedId: incident.id,
        dedupeKey: `form_broken:${form.id}`,
        metadata: {
          websiteName: website.name,
          websiteType: website.type,
          websiteTypeLabel: websiteTypeLabel(website.type),
          formName: form.name,
          formUrl: form.url,
          previousStatus,
          previousStatusLabel: statusLabel(previousStatus),
          currentStatus: 'broken',
          errorMessage: result.errorMessage,
          detectedAt: updated.firstBrokenAt || updated.lastFailedTestAt
        }
      });
    }

    await historyService.recordCheck({
      websiteId: website.id,
      type: 'incident',
      targetId: form.id,
      previousStatus,
      newStatus: 'broken',
      message: lead
        ? `Critical alert: ${form.name} on lead site ${website.name}`
        : `${form.name} broken on ${website.name}`
    });

    emit('form:broken', { form: updated, incident, notification, website, criticalAlert: lead });
  } else if (previousStatus === 'broken' && result.status === 'broken') {
    await incidentService.openIncident({
      websiteId: website.id,
      formId: form.id,
      type: 'form',
      severity: lead ? 'critical' : 'warning',
      errorMessage: result.errorMessage
    });
  } else if (previousStatus === 'broken' && result.status === 'working') {
    const incident = await incidentService.resolveIncident({
      websiteId: website.id,
      formId: form.id,
      type: 'form'
    });
    await notificationService.resolveActiveByForm(form.id, 'form_broken');
    const downtime = incident?.downtimeSeconds || 0;
    const notification = await notificationService.createNotification({
      type: 'form_recovered',
      severity: 'success',
      title: 'FORM RECOVERED',
      status: 'resolved',
      message: `${website.name} — ${form.name} recovered after ${formatDuration(downtime)}`,
      websiteId: website.id,
      formId: form.id,
      relatedId: incident?.id,
      metadata: {
        websiteName: website.name,
        websiteType: website.type,
        websiteTypeLabel: websiteTypeLabel(website.type),
        formName: form.name,
        formUrl: form.url,
        startedAt: incident?.startedAt,
        resolvedAt: incident?.resolvedAt,
        downtimeSeconds: downtime,
        downtimeLabel: formatDuration(downtime)
      }
    });
    await historyService.recordCheck({
      websiteId: website.id,
      type: 'recovery',
      targetId: form.id,
      previousStatus: 'broken',
      newStatus: 'working',
      message: `${form.name} recovered after ${formatDuration(downtime)}`
    });
    emit('form:recovered', { form: updated, incident, notification, website });
  }

  return updated;
}

export async function runManualFormTest(website, homepageHtml, socketId) {
  const results = await detectAndMonitorForms(website, homepageHtml, { socketId, emitProgress: true });

  const summary = {
    websiteId: website.id,
    formCount: results.length,
    results,
    completedAt: new Date().toISOString()
  };
  emit('form:testCompleted', summary);
  if (socketId) emitToSocket(socketId, 'form:testCompleted', summary);
  return summary;
}
