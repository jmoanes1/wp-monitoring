import { getDashboardStats } from '../services/dashboardService.js';

export async function getDashboard(req, res, next) {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
}
