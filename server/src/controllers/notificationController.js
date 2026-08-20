import * as notificationService from '../services/notificationService.js';

export async function list(req, res, next) {
  try {
    const notifications = await notificationService.getNotifications({
      unreadOnly: req.query.unread === 'true'
    });
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
}

export async function markRead(req, res, next) {
  try {
    const notification = await notificationService.markAsRead(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ notification });
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(req, res, next) {
  try {
    const notifications = await notificationService.markAllAsRead();
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
}

export async function remove(req, res, next) {
  try {
    const notification = await notificationService.removeNotification(req.params.id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}
