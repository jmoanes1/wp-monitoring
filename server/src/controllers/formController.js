import * as formService from '../services/formService.js';
import * as formTestService from '../services/formTestService.js';
import * as playwrightFormTestService from '../services/playwrightFormTestService.js';
import { readScreenshot } from '../services/screenshotStore.js';

export async function list(req, res, next) {
  try {
    const forms = await formService.listForms({
      websiteId: req.query.websiteId,
      status: req.query.status
    });
    res.json({ forms });
  } catch (error) {
    next(error);
  }
}

export async function listTests(req, res, next) {
  try {
    const tests = await formTestService.listFormTests({
      websiteId: req.query.websiteId,
      formId: req.query.formId
    });
    res.json({ tests });
  } catch (error) {
    next(error);
  }
}

export async function runPlaywright(req, res, next) {
  try {
    const websiteId = req.body?.websiteId || req.params.id;
    const formId = req.body?.formId || req.params.formId;
    const mode = req.body?.mode === 'real' ? 'real' : 'dry';
    if (!websiteId || !formId) return res.status(400).json({ error: 'websiteId and formId are required' });
    const result = await playwrightFormTestService.startPlaywrightFormTest({
      websiteId,
      formId,
      mode,
      trigger: 'manual'
    });
    if (result.error === 'not_found') return res.status(404).json({ error: result.message });
    if (result.error === 'busy') return res.status(409).json({ error: result.message });
    if (result.error === 'forbidden') return res.status(403).json({ error: result.message });
    return res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function updateConfig(req, res, next) {
  try {
    const form = await formService.getForm(req.params.formId);
    if (!form || form.websiteId !== req.params.id) return res.status(404).json({ error: 'Form not found' });
    const updated = await formService.updatePlaywrightConfig(form.id, req.body || {});
    return res.json({ form: updated });
  } catch (error) {
    next(error);
  }
}

export async function remove(req, res, next) {
  try {
    const form = await formService.getForm(req.params.formId);
    if (!form || form.websiteId !== req.params.id) return res.status(404).json({ error: 'Form not found' });
    const result = await formService.deleteForm(form.id);
    return res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function screenshot(req, res, next) {
  try {
    const test = await formTestService.getFormTest(req.params.testId);
    if (!test) return res.status(404).json({ error: 'Test not found' });
    const file = await readScreenshot(req.params.testId, req.params.file);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(file.data);
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Screenshot not found' });
    next(error);
  }
}
