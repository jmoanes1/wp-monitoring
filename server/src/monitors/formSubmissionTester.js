import * as cheerio from 'cheerio';
import { safeFetch } from '../utils/httpClient.js';
import { originOf, resolveUrl, siteOrigins } from '../utils/ssrf.js';
import { findFormElement } from './formDetector.js';
import { TEST_RECIPIENT, TEST_VALUES } from '../utils/formTestPayload.js';

const SUBMIT_TIMEOUT_MS = 45000;
const HONEYPOT = /^(website|url|fax|honeypot|hp|bot|company.?url|address2|confirm.?email)$/i;
const TOKEN_NAME = /^(_wpcf7|_wpnonce|_wp_http|nonce|gform_|wpforms\[id\]|wpforms\[nonce\]|wpforms\[token\]|form_id|form_build_id|form_token)/i;

const SUCCESS_HINT =
  /thank you|thanks for|we have received|your message has been sent|successfully submitted|form-submitted|mail_sent|wpcf7-mail-sent-ok|wpforms-confirmation|gform_confirmation/i;
const ERROR_HINT =
  /wpcf7-validation-errors|validation.?failed|there was an error|something went wrong|required field|please fill|spam|forbidden|fatal error|uncaught/i;

/**
 * Submits a detected website form with clearly marked monitoring values.
 * Never uses production customer data. Credentials are not involved.
 */
export async function submitMonitoringFormTest(website, form) {
  const started = Date.now();
  const checks = [];
  const allowedOrigins = siteOrigins(website.url);
  const pageUrl = form.url || website.url;

  const page = await safeFetch(pageUrl, { allowedOrigins, maxRedirects: 4 });
  const loaded = Boolean(page.ok && page.body);
  checks.push(check('load', 'Form loads correctly', loaded, loaded ? `HTTP ${page.status}` : page.error?.message || `HTTP ${page.status || 0}`));
  if (!loaded) {
    return finish(started, checks, {
      overall: 'failed',
      confirmationMessage: null,
      responseStatus: page.status,
      errorMessage: page.error?.message || 'Form page is unreachable',
      fieldsTested: []
    });
  }

  const $ = cheerio.load(page.body);
  const $form = findFormElement($, form.identifier);
  if (!$form?.length) {
    checks.push(check('fields', 'Required fields can be completed', false, 'The form was not found on the page'));
    return finish(started, checks, {
      overall: 'failed',
      confirmationMessage: null,
      responseStatus: page.status,
      errorMessage: 'Form is missing from the page',
      fieldsTested: []
    });
  }

  if (isSkippedForm($form)) {
    // Search/login forms are health-checked elsewhere. Do not POST credentials or queries.
    return finish(started, checks, {
      skipped: true,
      overall: 'partially_passed',
      confirmationMessage: null,
      responseStatus: page.status,
      errorMessage: 'This form is a search or login form and is not submitted by monitoring',
      fieldsTested: []
    });
  }

  const captcha = hasCaptcha($form, page.body);
  const parsed = parseFields($, $form);
  const filled = fillFields(parsed);
  const requiredMissing = filled.requiredMissing;
  checks.push(
    check(
      'fields',
      'Required fields can be completed',
      requiredMissing.length === 0,
      requiredMissing.length ? `Could not fill: ${requiredMissing.join(', ')}` : `Filled ${filled.fieldsTested.length} fields`
    )
  );

  if (captcha) {
    checks.push(check('submit', 'Submit button works', false, 'Form uses CAPTCHA, so an unattended submission cannot be completed'));
    checks.push(check('submission', 'Form submission succeeds', false, 'Blocked by CAPTCHA'));
    checks.push(check('confirmation', 'Success/confirmation message appears', false, 'Not submitted'));
    checks.push(check('email', 'Email notification triggered', false, 'Not available because submission was blocked', true));
    checks.push(check('errors', 'No server-side or frontend errors', true, 'Page loaded without a server error'));
    return finish(started, checks, {
      overall: 'partially_passed',
      confirmationMessage: null,
      responseStatus: page.status,
      errorMessage: 'Form uses CAPTCHA, so a full unattended submission could not be completed',
      fieldsTested: filled.fieldsTested
    });
  }

  const hasSubmitControl = $form.find('button[type="submit"], input[type="submit"], button:not([type]), input[type="image"]').length > 0;
  checks.push(check('submit', 'Submit button works', hasSubmitControl || Boolean(parsed.action), hasSubmitControl ? 'Submit control found' : 'No submit control found'));

  const posted = await postForm(website, pageUrl, $form, parsed, filled.values, allowedOrigins, page.cookies);
  const interpretation = interpretResponse(posted, parsed.plugin);

  checks.push(check('validation', 'Form validation works', interpretation.validationOk, interpretation.validationDetail));
  checks.push(check('submission', 'Form submission succeeds', interpretation.submitted, interpretation.submitDetail));
  checks.push(check('confirmation', 'Success/confirmation message appears', interpretation.confirmed, interpretation.confirmationMessage || interpretation.confirmDetail));
  checks.push(
    check(
      'email',
      'Email notification triggered',
      interpretation.emailOk === true,
      interpretation.emailDetail,
      interpretation.emailOk == null
    )
  );
  checks.push(check('errors', 'No server-side or frontend errors', interpretation.noErrors, interpretation.errorDetail));

  return finish(started, checks, {
    overall: overallFrom(checks, interpretation),
    confirmationMessage: interpretation.confirmationMessage,
    responseStatus: posted.status,
    errorMessage: interpretation.submitted ? null : interpretation.submitDetail,
    fieldsTested: filled.fieldsTested
  });
}

function finish(started, checks, extra) {
  return {
    ...extra,
    durationMs: Date.now() - started,
    checks,
    recipient: TEST_RECIPIENT
  };
}

function check(key, label, ok, detail, skipped = false) {
  return { key, label, ok: skipped ? null : Boolean(ok), detail: detail || '', skipped: Boolean(skipped) };
}

function isSkippedForm($form) {
  const hasPassword = $form.find('input[type="password"]').length > 0;
  const hasUser = $form.find('input[name="log"], input[name="user_login"], input[type="email"][name*="user"]').length > 0;
  if (hasPassword && hasUser) return true;
  const method = ($form.attr('method') || 'POST').toUpperCase();
  const search = $form.attr('role') === 'search' || $form.find('input[name="s"]').length > 0;
  return method === 'GET' && search;
}

function hasCaptcha($form, html) {
  return Boolean(
    $form.find('.g-recaptcha, .h-captcha, .cf-turnstile, textarea[name="g-recaptcha-response"]').length ||
      /google.com\/recaptcha|hcaptcha.com|challenges.cloudflare.com\/turnstile/i.test(html || '')
  );
}

function parseFields($, $form) {
  const plugin = pluginOf($form);
  const actionRaw = $form.attr('action') || '';
  const method = ($form.attr('method') || 'POST').toUpperCase();
  const fields = [];

  $form.find('input, textarea, select').each((_, element) => {
    const $el = $(element);
    const type = String($el.attr('type') || element.tagName || 'text').toLowerCase();
    const name = $el.attr('name');
    if (!name || type === 'file' || type === 'image' || $el.attr('disabled')) return;
    if (type === 'submit' || type === 'button' || type === 'reset') return;

    const label = fieldLabel($, $el);
    const required = isRequired($el);
    fields.push({
      name,
      type: element.tagName === 'textarea' ? 'textarea' : element.tagName === 'select' ? 'select' : type,
      label,
      required,
      value: $el.attr('value') || $el.find('option[selected]').attr('value') || $el.val() || '',
      checked: $el.is('[checked]'),
      options: element.tagName === 'select' ? $el.find('option').map((__, opt) => $(opt).attr('value') || $(opt).text()).get() : [],
      role: classifyField(name, type, label)
    });
  });

  return { plugin, action: actionRaw, method: method === 'GET' ? 'POST' : method, fields };
}

function pluginOf($form) {
  if ($form.find('input[name="_wpcf7"]').length) return 'contact-form-7';
  if ($form.find('input[name="wpforms[id]"]').length) return 'wpforms';
  if ($form.find('input[name="gform_submit"]').length) return 'gravity-forms';
  return 'html';
}

function fieldLabel($, $el) {
  const id = $el.attr('id');
  if (id) {
    const byFor = $(`label[for="${id}"]`).first().text().trim();
    if (byFor) return byFor.slice(0, 80);
  }
  const wrapping = $el.closest('label').text().trim();
  if (wrapping) return wrapping.slice(0, 80);
  return ($el.attr('placeholder') || $el.attr('aria-label') || $el.attr('name') || '').slice(0, 80);
}

function isRequired($el) {
  return (
    $el.is('[required]') ||
    $el.attr('aria-required') === 'true' ||
    $el.hasClass('wpcf7-validates-as-required') ||
    $el.closest('.wpforms-field-required, .gfield_contains_required, .wpcf7-validates-as-required').length > 0
  );
}

function classifyField(name, type, label) {
  const hay = `${name} ${label} ${type}`.toLowerCase();
  if (type === 'hidden' || TOKEN_NAME.test(name)) return 'hidden';
  if (HONEYPOT.test(name) || /honeypot/.test(hay)) return 'honeypot';
  if (type === 'email' || /e-?mail/.test(hay)) return 'email';
  if (/first.?name|fname|given.?name/.test(hay)) return 'firstName';
  if (/last.?name|lname|surname|family.?name/.test(hay)) return 'lastName';
  if (/phone|tel|mobile/.test(hay) || type === 'tel') return 'phone';
  if (/subject/.test(hay)) return 'subject';
  if (/company|organization|business/.test(hay)) return 'company';
  if (/message|comment|enquiry|inquiry|details|description|textarea/.test(hay) || type === 'textarea') return 'message';
  if (/^(your-)?name$|full.?name|your name/.test(hay) || /(^|[-_[])name($|[-_\]])/.test(name.toLowerCase())) return 'name';
  if (type === 'url' || /website/.test(hay)) return 'url';
  if (type === 'number') return 'number';
  if (type === 'checkbox' || type === 'acceptance') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'select') return 'select';
  if (type === 'date') return 'date';
  return 'text';
}

function fillFields(parsed) {
  const values = {};
  const fieldsTested = [];
  const requiredMissing = [];

  for (const field of parsed.fields) {
    if (field.role === 'honeypot') {
      values[field.name] = '';
      continue;
    }
    if (field.role === 'hidden') {
      if (field.value !== undefined && field.value !== null) values[field.name] = String(field.value);
      continue;
    }

    const value = valueFor(field);
    if (value == null) {
      if (field.required) requiredMissing.push(field.label || field.name);
      continue;
    }
    values[field.name] = value;
    fieldsTested.push({
      name: field.name,
      label: field.label || field.name,
      role: field.role,
      value: field.role === 'email' ? value : String(value).slice(0, 140)
    });
  }

  return { values, fieldsTested, requiredMissing };
}

function valueFor(field) {
  if (field.type === 'checkbox') return field.required || field.checked ? field.value || '1' : null;
  if (field.type === 'radio') return field.value || '1';
  if (field.type === 'select') {
    const option = (field.options || []).find((item) => String(item).trim() && !/^select/i.test(item));
    return option || field.value || '';
  }
  if (field.role === 'email') return TEST_VALUES.email;
  if (field.role === 'firstName') return TEST_VALUES.firstName;
  if (field.role === 'lastName') return TEST_VALUES.lastName;
  if (field.role === 'name') return TEST_VALUES.name;
  if (field.role === 'subject') return TEST_VALUES.subject;
  if (field.role === 'message') return TEST_VALUES.message;
  if (field.role === 'company') return TEST_VALUES.company;
  if (field.role === 'phone') return TEST_VALUES.phone;
  if (field.role === 'url') return TEST_VALUES.url;
  if (field.role === 'number') return '1';
  if (field.role === 'date') return new Date().toISOString().slice(0, 10);
  if (field.type === 'textarea') return TEST_VALUES.message;
  return TEST_VALUES.name;
}

async function postForm(website, pageUrl, $form, parsed, values, allowedOrigins, cookies) {
  const cookieHeader = Array.isArray(cookies) ? cookies.join('; ') : String(cookies || '');
  includeSubmitValues($form, values);

  const body = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) body.append(name, value);

  if (parsed.plugin === 'contact-form-7' && !body.has('_wpcf7')) {
    const id = $form.find('input[name="_wpcf7"]').attr('value');
    if (id) body.set('_wpcf7', id);
  }

  const headers = {
    Origin: originOf(pageUrl),
    Referer: pageUrl,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Accept: 'application/json, text/html;q=0.9,*/*;q=0.8'
  };
  if (cookieHeader) headers.Cookie = cookieHeader;

  const primaryUrl = resolveAction(pageUrl, parsed.action, parsed.plugin, values);
  const posted = await postOnce(primaryUrl, headers, body, allowedOrigins);

  // Contact Form 7 REST can be disabled; fall back to the page action used by the browser.
  if (parsed.plugin === 'contact-form-7' && (posted.status === 404 || posted.status === 0) && /\/wp-json\//.test(primaryUrl)) {
    const fallbackUrl = parsed.action && parsed.action !== '#' ? resolveUrl(pageUrl, parsed.action) : pageUrl;
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      return followRedirect(await postOnce(fallbackUrl, headers, body, allowedOrigins), fallbackUrl, allowedOrigins, cookieHeader, pageUrl);
    }
  }

  return followRedirect(posted, primaryUrl, allowedOrigins, cookieHeader, pageUrl);
}

async function postOnce(url, headers, body, allowedOrigins) {
  return safeFetch(url, {
    method: 'POST',
    allowedOrigins,
    maxRedirects: 0,
    timeoutMs: SUBMIT_TIMEOUT_MS,
    parseJson: true,
    headers,
    body: body.toString()
  });
}

async function followRedirect(posted, actionUrl, allowedOrigins, cookieHeader, pageUrl) {
  if ([301, 302, 303, 307, 308].includes(posted.status) && posted.location) {
    try {
      const nextUrl = new URL(posted.location, actionUrl).toString();
      const next = await safeFetch(nextUrl, {
        method: 'GET',
        allowedOrigins,
        maxRedirects: 3,
        timeoutMs: SUBMIT_TIMEOUT_MS,
        headers: cookieHeader ? { Cookie: cookieHeader, Referer: pageUrl } : { Referer: pageUrl }
      });
      return { ...next, redirectedFrom: posted.status };
    } catch {
      return posted;
    }
  }
  return posted;
}

function includeSubmitValues($form, values) {
  $form.find('button[type="submit"], input[type="submit"]').each((_, element) => {
    const name = element.attribs?.name;
    if (!name || values[name] !== undefined) return;
    values[name] = element.attribs?.value || 'Submit';
  });
}

function resolveAction(pageUrl, actionRaw, plugin, values) {
  if (plugin === 'contact-form-7') {
    const id = values._wpcf7;
    if (id) return new URL(`wp-json/contact-form-7/v1/contact-forms/${id}/feedback`, originOf(pageUrl) + '/').toString();
  }
  if (!actionRaw || actionRaw === '#' || actionRaw.startsWith('javascript:')) return pageUrl;
  try {
    return resolveUrl(pageUrl, actionRaw);
  } catch {
    return pageUrl;
  }
}

function interpretResponse(result, plugin) {
  const json = result.json;
  const body = String(result.body || '');
  const status = result.status || 0;

  if (plugin === 'contact-form-7' && json && typeof json === 'object') {
    const cf7 = json.status || '';
    const message = String(json.message || '').replace(/<[^>]+>/g, '').trim();
    const submitted = cf7 === 'mail_sent';
    const mailFailed = cf7 === 'mail_failed';
    const validationFailed = cf7 === 'validation_failed' || cf7 === 'acceptance_missing';
    return {
      submitted: submitted || mailFailed,
      confirmed: submitted,
      confirmationMessage: message || null,
      validationOk: !validationFailed,
      validationDetail: validationFailed ? message || 'WordPress reported validation errors' : 'Submitted values were accepted',
      submitDetail: submitted || mailFailed ? `Contact Form 7 status: ${cf7}` : message || `Contact Form 7 status: ${cf7 || 'unknown'}`,
      confirmDetail: submitted ? message : 'No success confirmation',
      emailOk: submitted ? true : mailFailed ? false : null,
      emailDetail: submitted ? 'Contact Form 7 reported mail_sent' : mailFailed ? 'Contact Form 7 reported mail_failed' : 'Email result was not provided',
      noErrors: status < 500 && cf7 !== 'spam',
      errorDetail: status >= 500 ? `HTTP ${status}` : cf7 === 'spam' ? 'Submission marked as spam' : 'No server error detected'
    };
  }

  const confirmed = SUCCESS_HINT.test(body);
  const errored = ERROR_HINT.test(body) && !confirmed;
  const submitted = (status >= 200 && status < 400 && !errored) || confirmed;
  const confirmationMessage = extractVisibleMessage(body);

  return {
    submitted,
    confirmed,
    confirmationMessage: confirmed ? confirmationMessage : null,
    validationOk: submitted || !errored,
    validationDetail: errored ? 'The form response included validation or error text' : submitted ? 'Submitted values were accepted' : 'Could not confirm validation',
    submitDetail: submitted ? `HTTP ${status}` : errored ? confirmationMessage || `HTTP ${status}` : `HTTP ${status}`,
    confirmDetail: confirmed ? confirmationMessage || 'Success text found' : 'No confirmation message found',
    emailOk: null,
    emailDetail: 'Email delivery cannot be verified for this form type',
    noErrors: status < 500 && !/fatal error|uncaught/i.test(body),
    errorDetail: status >= 500 ? `HTTP ${status}` : 'No server error detected'
  };
}

function extractVisibleMessage(html) {
  if (!html) return null;
  const $ = cheerio.load(html);
  const node = $('.wpcf7-response-output, .wpforms-confirmation-container, .gform_confirmation_message, .form-success, .thankyou').first();
  const text = (node.text() || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 280) : null;
}

function overallFrom(checks, interpretation) {
  const failed = checks.filter((item) => item.skipped !== true && item.ok === false);
  const skipped = checks.filter((item) => item.skipped);
  if (interpretation.submitted && interpretation.confirmed && failed.length === 0) return 'passed';
  if (interpretation.submitted && (skipped.length || failed.some((item) => item.key === 'email' || item.key === 'confirmation'))) {
    return failed.some((item) => !['email', 'confirmation'].includes(item.key)) ? 'partially_passed' : 'partially_passed';
  }
  if (interpretation.submitted) return 'partially_passed';
  return 'failed';
}
