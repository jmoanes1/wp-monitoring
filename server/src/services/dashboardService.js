import { listWebsites } from './websiteService.js';
import { getUpdates } from './updateService.js';
import { getNotifications } from './notificationService.js';
import { getIncidents } from './incidentService.js';

export async function getDashboardStats() {
  const [websites, updates, notifications, incidents] = await Promise.all([
    listWebsites(),
    getUpdates({ status: 'pending' }),
    getNotifications({ unreadOnly: true }),
    getIncidents({ status: 'active' })
  ]);

  const leads = websites.filter((item) => item.type === 'lead');
  const nonLeads = websites.filter((item) => item.type === 'non-lead');
  const offline = websites.filter((item) => item.status === 'offline');
  const coreUpdates = updates.filter((item) => item.type === 'core');
  const pluginUpdates = updates.filter((item) => item.type === 'plugin');
  const themeUpdates = updates.filter((item) => item.type === 'theme');

  return {
    totalWebsites: websites.length,
    leadWebsites: leads.length,
    nonLeadWebsites: nonLeads.length,
    websitesOffline: offline.length,
    wordpressUpdates: coreUpdates.length,
    pluginUpdates: pluginUpdates.length,
    themeUpdates: themeUpdates.length,
    pendingUpdates: updates.length,
    criticalAlerts: offline.length,
    unreadNotifications: notifications.length,
    websites,
    recentNotifications: notifications.slice(0, 8),
    activeIncidents: incidents.slice(0, 8)
  };
}
