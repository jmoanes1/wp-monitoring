import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import authRoutes from './auth.js';
import websiteRoutes from './websites.js';
import formRoutes from './forms.js';
import notificationRoutes from './notifications.js';
import updateRoutes from './updates.js';
import monitoringRoutes from './monitoring.js';
import dashboardRoutes from './dashboard.js';
import settingsRoutes from './settings.js';
import connectorRoutes from './connector.js';
import incidentRoutes from './incidents.js';
import * as formController from '../controllers/formController.js';
import { monitorActionLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/connector', connectorRoutes);

router.use(apiLimiter);
router.use(authenticate);
router.use(requireAdmin);

router.use('/websites', websiteRoutes);
router.use('/forms', formRoutes);
router.post('/form-tests/run', monitorActionLimiter, formController.runPlaywright);
router.get('/form-tests/:testId/screenshots/:file', formController.screenshot);
router.use('/notifications', notificationRoutes);
router.use('/updates', updateRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/settings', settingsRoutes);
router.use('/incidents', incidentRoutes);

export default router;
