import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { formatDisplay } from '../utils/time.js';
import { TEST_DATA_SUMMARY, TEST_REPORT_TO } from '../utils/formTestPayload.js';
import { screenshotPath } from './screenshotStore.js';

export function smtpConfigured() {
  return Boolean(config.smtp?.host && config.smtp?.from);
}

export async function sendPlaywrightTestReport({ website, form, test }) {
  const to = TEST_REPORT_TO;
  if (!smtpConfigured()) {
    return { sent: false, to, reason: 'smtp_not_configured' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
    });
    const status = String(test.status || test.overall || 'failed').toUpperCase();
    const when = formatDisplay(test.completedAt);
    const whenLabel = typeof when === 'string' ? when : when.label;
    const modeLabel = test.mode === 'real' ? 'Real Test Submission' : 'Dry Run';
    const lines = [
      'WP Monitor Form Test Report',
      '',
      `Website: ${website.name}`,
      `Form: ${form.name}`,
      `Test Mode: ${modeLabel}`,
      `Status: ${status}`,
      '',
      'Test Data:',
      ...TEST_DATA_SUMMARY.map((item) => `${item.label}: ${item.value}`),
      '',
      `Duration: ${((test.durationMs || 0) / 1000).toFixed(2)} seconds`,
      `Test Time: ${whenLabel}`
    ];
    if (!test.success) {
      lines.push(
        '',
        'Status: FAILED',
        `Failure Reason: ${test.message || ''}`,
        `Failed Step: ${test.failedStep || ''}`,
        `Error: ${test.errorCode || ''}`
      );
    } else {
      lines.push(
        '',
        'Result:',
        test.message || 'The form was successfully submitted and the expected confirmation was detected.'
      );
    }
    const shot = (test.screenshots || []).at(-1);
    const attachments = shot?.filename
      ? [{ filename: shot.filename, path: screenshotPath(test.id, shot.filename) }]
      : [];
    await transporter.sendMail({
      from: config.smtp.from,
      to,
      subject: `WP Monitor Form Test — ${website.name} — ${status}`,
      text: lines.join('\n'),
      attachments
    });
    return { sent: true, to };
  } catch (error) {
    logger.error('Playwright test report email failed', { message: error.message });
    return { sent: false, to, reason: error.message };
  }
}
