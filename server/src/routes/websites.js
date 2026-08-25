import { Router } from 'express';
import * as websiteController from '../controllers/websiteController.js';
import { monitorActionLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/', websiteController.list);
router.post('/', websiteController.create);

// Specific paths must be registered before /:id so they are not missed.
router.post('/:id/test', monitorActionLimiter, websiteController.testWebsite);
router.post('/:id/check-updates', monitorActionLimiter, websiteController.checkUpdates);
router.post('/:id/plugins/update-all', monitorActionLimiter, websiteController.updateAllPlugins);
router.post('/:id/plugins/:slug/update', monitorActionLimiter, websiteController.updatePlugin);
router.get('/:id/incidents', websiteController.listIncidents);
router.get('/:id/credentials', websiteController.getCredentials);
router.put('/:id/credentials', websiteController.updateCredentials);
router.post('/:id/test-connection', monitorActionLimiter, websiteController.testConnection);
router.post('/:id/connector-key', websiteController.regenerateConnector);

router.get('/:id', websiteController.getOne);
router.put('/:id', websiteController.update);
router.delete('/:id', websiteController.remove);

export default router;
