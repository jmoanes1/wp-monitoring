import { getHistory } from '../services/monitoringHistoryService.js';

export async function history(req, res, next) {
  try {
    const records = await getHistory({
      websiteId: req.query.websiteId,
      type: req.query.type,
      limit: Number(req.query.limit) || 200
    });
    res.json({ history: records });
  } catch (error) {
    next(error);
  }
}
