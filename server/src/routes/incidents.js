import { Router } from 'express';
import { getIncidents } from '../services/incidentService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const incidents = await getIncidents({
      websiteId: req.query.websiteId,
      status: req.query.status
    });
    res.json({ incidents });
  } catch (error) {
    next(error);
  }
});

export default router;
