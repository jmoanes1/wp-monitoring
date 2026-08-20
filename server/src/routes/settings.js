import { Router } from 'express';
import * as settingsController from '../controllers/settingsController.js';

const router = Router();
router.get('/', settingsController.get);
router.put('/', settingsController.update);
export default router;
