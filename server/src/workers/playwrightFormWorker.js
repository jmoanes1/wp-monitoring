import { siteOrigins } from '../utils/ssrf.js';
import { TEST_VALUES } from '../utils/formTestPayload.js';
import { classifyField, matchOption, needlesFor } from '../utils/formFieldMapper.js';
import { saveScreenshot } from '../services/screenshotStore.js';
import { logger } from '../utils/logger.js';

async function getChromium() {
  const { chromium } = await import('playwright');
  return chromium;
}

const TIMEOUT_MS = 90000;
const SUCCESS_HINT =
  /thank you|thanks for|we have received|your (form|message|request) has been|successfully submitted|submission successful|form submitted/i;
const ERROR_HINT =
  /required field|invalid|something went wrong|please try again|submission failed|there was an error/i;

const CAPTCHA = '.g-recaptcha, iframe[src*="recaptcha"], .h-captcha, iframe[src*="hcaptcha"], .cf-turnstile, iframe[src*="turnstile"]';

/**
 * Browser-based form test. Dry run fills and validates; real mode clicks Submit.
 * Does not bypass CAPTCHA.
 */
export async function runPlaywrightFormTest(options) {
  const started = Date.now();
  const mode = options.mode === 'real' ? 'real' : 'dry';
  const handle = { browser: null };
  let timer;
  try {
    return await Promise.race([
      runPlaywrightFormTestInner({ ...options, handle }),
      new Promise((_, reject) => {
        timer = setTimeout(async () => {
          await handle.browser?.close().catch(() => {});
          reject(Object.assign(new Error('The form test timed out.'), { timeout: true }));
        }, TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    if (error.timeout) {
      return fail(started, 'TIMEOUT', 'timeout', 'The form test timed out.', [], [], mode, []);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function runPlaywrightFormTestInner({ website, form, mode, testId, onStage, handle }) {
  const started = Date.now();
  const screenshots = [];
  const fieldsTested = [];
  const notes = [];
  let browser;
  const formUrl = (form.playwrightTest?.formUrl || form.url || website.url || '').trim();

    if (!formUrl) {
      return fail(started, 'INVALID_CONFIGURATION', 'opening', 'Form URL is not configured.', screenshots, fieldsTested, mode);
    }
    try {
    assertSameSite(website.url, formUrl);
  } catch (error) {
    return fail(started, 'INVALID_CONFIGURATION', 'opening', error.message, screenshots, fieldsTested, mode);
  }

  const stage = async (key, message) => {
    await onStage?.({ stage: key, message, steps: notes.slice() });
  };

  try {
    await stage('opening', 'Opening website');
    const chromium = await getChromium();
    browser = await chromium.launch({ headless: true });
    if (handle) handle.browser = browser;
    const context = await browser.newContext({
      userAgent: 'WP-Monitor-FormTest/1.0',
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    const response = await page.goto(formUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    screenshots.push(await saveScreenshot(page, testId, '01-page-loaded.png'));

    if (!response || response.status() >= 500) {
      return fail(started, 'NETWORK_ERROR', 'opening', `HTTP ${response?.status() || 0}`, screenshots, fieldsTested, mode);
    }

    if (await page.locator(CAPTCHA).count()) {
      notes.push('CAPTCHA detected');
      screenshots.push(await saveScreenshot(page, testId, '02-form-detected.png'));
      return blocked(started, screenshots, fieldsTested, mode, notes);
    }

    const selector = formSelector(form);
    if (!selector) {
      return fail(
        started,
        'INVALID_CONFIGURATION',
        'form_detected',
        'Configure a form selector or identifier so the test targets one form.',
        screenshots,
        fieldsTested,
        mode
      );
    }
    await stage('form_detected', 'Form detected');
    const matches = page.locator(selector);
    const found = await matches.count();
    if (!found) {
      return fail(started, 'FORM_NOT_FOUND', 'form_detected', 'The configured form was not found on the page.', screenshots, fieldsTested, mode);
    }
    if (found > 1 && selector === 'form') {
      return fail(
        started,
        'FORM_NOT_FOUND',
        'form_detected',
        'Multiple forms were found. Set a specific form selector.',
        screenshots,
        fieldsTested,
        mode
      );
    }
    const formLocator = matches.first();
    await formLocator.scrollIntoViewIfNeeded().catch(() => {});
    screenshots.push(await saveScreenshot(page, testId, '02-form-detected.png'));

    await stage('filling', 'Filling fields');
    const fillResult = await fillConfiguredForm(page, formLocator, fieldsTested, notes, stage);
    screenshots.push(await saveScreenshot(page, testId, '03-form-filled.png'));
    if (!fillResult.ok) {
      return fail(started, fillResult.code, 'filling', fillResult.reason, screenshots, fieldsTested, mode, notes);
    }

    await stage('validation', 'Validation completed');
    const validation = await triggerValidation(formLocator);
    screenshots.push(await saveScreenshot(page, testId, '04-validation.png'));
    if (!validation.ok) {
      return fail(started, 'VALIDATION_FAILED', 'validation', validation.reason, screenshots, fieldsTested, mode, notes);
    }

    if (mode !== 'real') {
      notes.push('Submit was not clicked (dry run)');
      return {
        success: true,
        mode: 'dry',
        status: 'passed',
        overall: 'passed',
        submitted: false,
        durationMs: Date.now() - started,
        message: 'Dry run passed. Fields filled and validation succeeded. Submission was not sent.',
        screenshots,
        fieldsTested,
        notes,
        errorCode: null,
        failedStep: null
      };
    }

    await stage('submitting', 'Submitting form');
    const submit = formLocator.locator('button[type="submit"], input[type="submit"], button:not([type])').first();
    if (!(await submit.count())) {
      return fail(started, 'SUBMISSION_FAILED', 'submitting', 'No submit control was found.', screenshots, fieldsTested, mode, notes);
    }
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    await Promise.all([
      page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {}),
      submit.click({ timeout: 10000 })
    ]);
    screenshots.push(await saveScreenshot(page, testId, '04-submitted.png'));

    await stage('waiting', 'Waiting for response');
    await page.waitForTimeout(1500);
    if (await page.locator(CAPTCHA).count()) {
      return blocked(started, screenshots, fieldsTested, mode, notes);
    }

    await stage('result', 'Checking result');
    const body = (await page.locator('body').innerText().catch(() => '')) || '';
    const confirmation = await extractConfirmation(page, body);
    screenshots.push(await saveScreenshot(page, testId, '05-submission-result.png'));

    if (ERROR_HINT.test(body) && !SUCCESS_HINT.test(body) && !confirmation) {
      return fail(started, 'SUBMISSION_FAILED', 'result', 'The page showed an error after submit.', screenshots, fieldsTested, mode, notes);
    }
    if (!confirmation && !SUCCESS_HINT.test(body) && !(await formGone(formLocator))) {
      return fail(started, 'CONFIRMATION_NOT_FOUND', 'result', 'The confirmation message was not detected.', screenshots, fieldsTested, mode, notes);
    }

    return {
      success: true,
      mode: 'real',
      status: 'passed',
      overall: 'passed',
      submitted: true,
      durationMs: Date.now() - started,
      message: confirmation || 'Form submitted successfully',
      confirmationMessage: confirmation,
      screenshots,
      fieldsTested,
      notes,
      errorCode: null,
      failedStep: null
    };
  } catch (error) {
    logger.error('Playwright form test failed', { message: error.message, formId: form.id });
    if (/Executable doesn't exist|browserType\.launch/i.test(error.message)) {
      return fail(
        started,
        'PLAYWRIGHT_ERROR',
        'playwright',
        'Playwright Chromium is not installed on the server.',
        screenshots,
        fieldsTested,
        mode,
        notes
      );
    }
    const code = /timeout/i.test(error.message) ? 'TIMEOUT' : 'PLAYWRIGHT_ERROR';
    return fail(started, code, 'playwright', humanError(error), screenshots, fieldsTested, mode, notes);
  } finally {
    await browser?.close().catch(() => {});
  }
}

function formSelector(form) {
  const custom = String(form.playwrightTest?.selector || '').trim();
  if (custom) return custom;
  const id = form.identifier || '';
  if (id.startsWith('id:')) return `form#${cssEscape(id.slice(3))}`;
  if (id.startsWith('name:')) return `form[name="${id.slice(5).replace(/"/g, '\\"')}"]`;
  if (id.startsWith('cf7:')) return `form:has(input[name="_wpcf7"][value="${id.slice(4)}"])`;
  if (id.startsWith('wpforms:')) return `form:has(input[name="wpforms[id]"][value="${id.slice(8)}"])`;
  if (id.startsWith('gform:')) return `form:has(input[name="gform_submit"][value="${id.slice(6)}"])`;
  return null;
}

function cssEscape(value) {
  return value.replace(/([^\w-])/g, '\\$1');
}

function assertSameSite(siteUrl, formUrl) {
  const allowed = new Set(
    siteOrigins(siteUrl).map((item) => new URL(item).hostname.replace(/^www\./i, '').toLowerCase())
  );
  const formHost = new URL(formUrl).hostname.replace(/^www\./i, '').toLowerCase();
  if (!allowed.has(formHost)) {
    throw new Error('Form URL must be on the same website origin as the monitored site.');
  }
}

async function fillConfiguredForm(page, formLocator, fieldsTested, notes, stage) {
  const controls = formLocator.locator('input, textarea, select');
  const count = await controls.count();
  const seenRadios = new Set();

  for (let index = 0; index < count; index += 1) {
    const el = controls.nth(index);
    if (!(await el.isVisible().catch(() => false))) continue;
    const meta = await el.evaluate((node) => ({
      name: node.getAttribute('name') || '',
      id: node.id || '',
      type: (node.getAttribute('type') || node.tagName).toLowerCase(),
      tag: node.tagName.toLowerCase(),
      placeholder: node.getAttribute('placeholder') || '',
      required: node.required || node.getAttribute('aria-required') === 'true',
      label: node.labels?.[0]?.innerText || ''
    }));
    const type = meta.tag === 'select' ? 'select' : meta.tag === 'textarea' ? 'textarea' : meta.type;
    if (['hidden', 'submit', 'button', 'reset', 'file', 'image'].includes(type)) continue;
    const role = classifyField(meta.name, type, meta.label, `${meta.placeholder} ${meta.id}`);
    if (role === 'hidden' || role === 'honeypot' || role === 'skip') continue;
    if (type === 'radio' && seenRadios.has(meta.name)) continue;
    if (type === 'radio') seenRadios.add(meta.name);

    await el.scrollIntoViewIfNeeded().catch(() => {});
    const filled = await fillControl(page, el, { ...meta, type, role });
    if (filled.status === 'option_missing') {
      const code = role === 'country' ? 'COUNTRY_NOT_FOUND' : role === 'nationality' ? 'NATIONALITY_NOT_FOUND' : 'FIELD_NOT_FOUND';
      return { ok: false, code, reason: filled.reason };
    }
    if (filled.value != null) {
      fieldsTested.push({ name: meta.name, label: meta.label || meta.name, role, value: String(filled.value).slice(0, 140) });
      if (role === 'country') {
        notes.push('Country selected');
        await stage('country', 'Country selected');
      }
      if (role === 'nationality') {
        notes.push('Nationality selected');
        await stage('nationality', 'Nationality selected');
      }
    } else if (meta.required && role !== 'checkbox') {
      return { ok: false, code: 'FIELD_NOT_FOUND', reason: `Required field could not be filled: ${meta.label || meta.name}` };
    }
  }
  return { ok: true };
}

async function fillControl(page, el, meta) {
  const value = valueForRole(meta.role);
  try {
    if (meta.type === 'checkbox') {
      if (meta.required) await el.check({ force: true }).catch(() => el.click());
      return { value: meta.required ? 'checked' : null, status: 'ok' };
    }
    if (meta.type === 'radio') {
      const needles = needlesFor(meta.role);
      if (needles.length) {
        const radios = page.locator(`input[type="radio"][name="${cssAttr(meta.name)}"]`);
        const total = await radios.count();
        for (let i = 0; i < total; i += 1) {
          const radio = radios.nth(i);
          const value = (await radio.getAttribute('value')) || '';
          const labelText = await radio.evaluate((n) => n.closest('label')?.innerText || '');
          const hay = `${value} ${labelText}`.toLowerCase();
          if (needles.some((n) => hay.includes(n) && !(n === 'male' && hay.includes('female')))) {
            await radio.check({ force: true }).catch(() => radio.click());
            return { value: await radio.getAttribute('value'), status: 'ok' };
          }
        }
        if (meta.role === 'country' || meta.role === 'nationality' || meta.role === 'gender') {
          return { status: 'option_missing', reason: `No matching ${meta.role} option` };
        }
      }
      return { value: null, status: 'ok' };
    }
    if (meta.type === 'select') {
      const options = await el.locator('option').evaluateAll((nodes) =>
        nodes.map((node) => ({ value: node.value, label: node.textContent.trim() }))
      );
      const needles = needlesFor(meta.role);
      const match = needles.length ? matchOption(options, needles) : null;
      if (match) {
        await el.selectOption({ value: match.value }).catch(() => el.selectOption({ label: match.label }));
        return { value: match.label || match.value, status: 'ok' };
      }
      if (meta.role === 'country' || meta.role === 'nationality' || meta.role === 'gender') {
        return { status: 'option_missing', reason: `Dropdown has no option for ${meta.role}` };
      }
      const generic = options.find((item) => item.value && !/^(select|choose|--)/i.test(item.label));
      if (generic && meta.required) {
        await el.selectOption({ value: generic.value });
        return { value: generic.label, status: 'ok' };
      }
      return { value: null, status: 'ok' };
    }
    if (value) {
      await el.fill('');
      await el.fill(String(value));
      await el.blur().catch(() => {});
      return { value, status: 'ok' };
    }
    return { value: null, status: 'ok' };
  } catch (error) {
    if (meta.required) return { status: 'option_missing', reason: error.message };
    return { value: null, status: 'ok' };
  }
}

function valueForRole(role) {
  if (role === 'email') return TEST_VALUES.email;
  if (role === 'firstName') return TEST_VALUES.firstName;
  if (role === 'lastName') return TEST_VALUES.lastName;
  if (role === 'name') return TEST_VALUES.name;
  if (role === 'age' || role === 'number') return TEST_VALUES.age;
  if (role === 'gender') return TEST_VALUES.gender;
  if (role === 'phone') return TEST_VALUES.phone;
  if (role === 'country') return TEST_VALUES.country;
  if (role === 'nationality') return TEST_VALUES.nationality;
  if (role === 'message' || role === 'subject') return TEST_VALUES.message;
  if (role === 'date') return new Date().toISOString().slice(0, 10);
  return null;
}

async function triggerValidation(formLocator) {
  const invalid = await formLocator.evaluate((form) => {
    if (typeof form.checkValidity === 'function' && !form.checkValidity()) {
      return form.validationMessage || 'Browser validation failed';
    }
    return '';
  });
  if (invalid) return { ok: false, reason: invalid };
  return { ok: true };
}

async function extractConfirmation(page, body) {
  const node = page.locator('.wpcf7-mail-sent-ok, .wpcf7-response-output, .wpforms-confirmation-container, .gform_confirmation_message, .form-success').first();
  if (await node.count()) {
    const text = (await node.innerText().catch(() => '')).trim();
    if (text) return text.slice(0, 280);
  }
  const match = body.match(SUCCESS_HINT);
  return match ? match[0] : null;
}

async function formGone(formLocator) {
  return (await formLocator.count()) === 0;
}

function cssAttr(value) {
  return String(value).replace(/"/g, '\\"');
}

function humanError(error) {
  if (/timeout/i.test(error.message)) return 'The page took too long to respond.';
  return 'The browser test stopped unexpectedly.';
}

function fail(started, errorCode, failedStep, reason, screenshots, fieldsTested, mode, notes = []) {
  return {
    success: false,
    mode,
    status: errorCode === 'CAPTCHA_BLOCKED' ? 'blocked' : 'failed',
    overall: errorCode === 'CAPTCHA_BLOCKED' ? 'blocked' : 'failed',
    submitted: false,
    durationMs: Date.now() - started,
    message: reason,
    errorCode,
    failedStep,
    screenshots,
    fieldsTested,
    notes,
    confirmationMessage: null
  };
}

function blocked(started, screenshots, fieldsTested, mode, notes) {
  return fail(
    started,
    'CAPTCHA_BLOCKED',
    'captcha',
    'CAPTCHA / anti-bot verification prevented automated testing.',
    screenshots,
    fieldsTested,
    mode,
    notes
  );
}
