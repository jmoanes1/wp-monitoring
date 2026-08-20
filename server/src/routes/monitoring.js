import { Router } from 'express';
import * as monitoringController from '../controllers/monitoringController.js';

const router = Router();
router.get('/history', monitoringController.history);
export default router;
