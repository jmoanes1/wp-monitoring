import { Router } from 'express';
import * as notificationController from '../controllers/notificationController.js';

const router = Router();

router.get('/', notificationController.list);
router.put('/read-all', notificationController.markAllRead);
router.put('/:id/read', notificationController.markRead);
router.delete('/:id', notificationController.remove);

export default router;
