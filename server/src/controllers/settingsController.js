import { getSettings, updateSettings } from '../services/settingsService.js';
import { config } from '../config/index.js';
import { rescheduleMonitorWorker } from '../workers/monitorWorker.js';

export async function get(req, res, next) {
  try {
    const settings = await getSettings();
    res.json({
      settings,
      allowedIntervals: config.allowedIntervals
    });
  } catch (error) {
    next(error);
  }
}

export async function update(req, res, next) {
  try {
    const settings = await updateSettings(req.body || {});
    await rescheduleMonitorWorker();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
}
