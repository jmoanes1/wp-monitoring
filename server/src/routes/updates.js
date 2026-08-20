import { Router } from 'express';
import * as updateController from '../controllers/updateController.js';

const router = Router();
router.get('/', updateController.list);
export default router;
