import { getUpdates } from '../services/updateService.js';

export async function list(req, res, next) {
  try {
    const updates = await getUpdates({
      websiteId: req.query.websiteId,
      status: req.query.status
    });
    res.json({ updates });
  } catch (error) {
    next(error);
  }
}
