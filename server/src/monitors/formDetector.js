import * as cheerio from 'cheerio';
import { originOf, resolveUrl } from '../utils/ssrf.js';

function readableName($form, index) {
  const id = $form.attr('id');
  const aria = $form.attr('aria-label');
  const heading = $form.find('h1,h2,h3,legend,label').first().text().trim();
  const submit = $form.find('input[type="submit"], button[type="submit"], button').first().text().trim()
    || $form.find('input[type="submit"]').attr('value');

  if (aria) return aria.slice(0, 80);
  if (id && !/^form[-_]?\d+$/i.test(id)) return humanize(id);
  if (heading) return heading.slice(0, 80);
  if (submit && !/^submit$/i.test(submit)) return `${submit} form`.slice(0, 80);
  return `Form ${index + 1}`;
}

function humanize(value) {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function formIdentifier($form, pageUrl, index) {
  const id = $form.attr('id');
  const name = $form.attr('name');
  const action = $form.attr('action') || '';
  const wpcf7 = $form.find('input[name="_wpcf7"]').attr('value');
  const wpforms = $form.find('input[name="wpforms[id]"]').attr('value');
  const gform = $form.find('input[name="gform_submit"]').attr('value');

  if (wpcf7) return `cf7:${wpcf7}`;
  if (wpforms) return `wpforms:${wpforms}`;
  if (gform) return `gform:${gform}`;
  if (id) return `id:${id}`;
  if (name) return `name:${name}`;
  return `action:${pageUrl}:${action}:${index}`;
}

function pluginHint($form) {
  if ($form.hasClass('wpcf7-form') || $form.find('input[name="_wpcf7"]').length) return 'contact-form-7';
  if ($form.hasClass('wpforms-form') || $form.find('input[name="wpforms[id]"]').length) return 'wpforms';
  if ($form.closest('.gform_wrapper').length || $form.find('input[name="gform_submit"]').length) return 'gravity-forms';
  if ($form.hasClass('frm-show-form')) return 'formidable';
  if ($form.closest('.nf-form-cont').length) return 'ninja-forms';
  return 'html';
}

/**
 * Detect forms from HTML without submitting them.
 * Known WordPress form plugins are recognized in addition to generic <form> tags.
 */
export function detectFormsFromHtml(pageUrl, html) {
  if (!html) return [];

  const $ = cheerio.load(html);
  const origin = originOf(pageUrl);
  const found = [];

  $('form').each((index, element) => {
    const $form = $(element);
    const actionRaw = $form.attr('action') || pageUrl;
    let action;
    try {
      action = resolveUrl(pageUrl, actionRaw);
      if (new URL(action).origin !== origin) {
        action = pageUrl;
      }
    } catch {
      action = pageUrl;
    }

    found.push({
      name: readableName($form, index),
      url: pageUrl,
      identifier: formIdentifier($form, pageUrl, index),
      method: ($form.attr('method') || 'POST').toUpperCase(),
      action,
      detectionMethod: pluginHint($form),
      safeTestConfigured: false
    });
  });

  return dedupeForms(found);
}

function dedupeForms(forms) {
  const seen = new Set();
  return forms.filter((form) => {
    if (seen.has(form.identifier)) return false;
    seen.add(form.identifier);
    return true;
  });
}

export function pageHasForm(html, identifier) {
  if (!html || !identifier) return false;
  const $ = cheerio.load(html);
  return Boolean(findFormElement($, identifier)?.length);
}

export function findFormElement($, identifier) {
  if (!identifier) return $('form').first();
  if (identifier.startsWith('cf7:')) {
    const input = $(`input[name="_wpcf7"][value="${identifier.slice(4)}"]`);
    return input.closest('form');
  }
  if (identifier.startsWith('wpforms:')) {
    const input = $(`input[name="wpforms[id]"][value="${identifier.slice(8)}"]`);
    return input.closest('form');
  }
  if (identifier.startsWith('gform:')) {
    const input = $(`input[name="gform_submit"][value="${identifier.slice(6)}"]`);
    return input.closest('form');
  }
  if (identifier.startsWith('id:')) {
    return $(`form#${cssEscape(identifier.slice(3))}`);
  }
  if (identifier.startsWith('name:')) {
    return $(`form[name="${identifier.slice(5)}"]`);
  }
  return $('form').first();
}

function cssEscape(value) {
  return value.replace(/([^\w-])/g, '\\$1');
}
