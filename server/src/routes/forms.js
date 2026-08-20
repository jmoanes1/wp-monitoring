import { Router } from 'express';
import * as formController from '../controllers/formController.js';
import { monitorActionLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.get('/', formController.list);
router.get('/tests', formController.listTests);
router.post('/tests/run', monitorActionLimiter, formController.runPlaywright);
router.get('/tests/:testId/screenshots/:file', formController.screenshot);
export default router;
