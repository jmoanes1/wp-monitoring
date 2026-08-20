import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const DIR = path.join(config.paths.dataDir, 'test-results');

export async function ensureTestDir(testId) {
  const dir = path.join(DIR, testId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function screenshotPath(testId, filename) {
  return path.join(DIR, testId, filename);
}

export async function saveScreenshot(page, testId, filename) {
  const dir = await ensureTestDir(testId);
  const file = path.join(dir, filename);
  await page.screenshot({ path: file, fullPage: false });
  return filename;
}

export function publicScreenshotUrl(testId, filename) {
  return `/form-tests/${testId}/screenshots/${encodeURIComponent(filename)}`;
}

export async function readScreenshot(testId, filename) {
  const safe = path.basename(filename);
  const file = path.join(DIR, testId, safe);
  const data = await fs.readFile(file);
  return { data, filename: safe };
}

export async function pruneScreenshots(maxAgeHours = 24) {
  try {
    const entries = await fs.readdir(DIR, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(DIR, entry.name);
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(full, { recursive: true, force: true });
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn('Screenshot prune failed', { message: error.message });
  }
}
