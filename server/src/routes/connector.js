import { Router } from 'express';
import * as connectorController from '../controllers/connectorController.js';
import { monitorActionLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.post('/heartbeat', monitorActionLimiter, connectorController.heartbeat);
router.post('/report', monitorActionLimiter, connectorController.report);
export default router;
