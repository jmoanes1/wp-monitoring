import { listWebsites } from './websiteService.js';
import { listForms } from './formService.js';
import { getUpdates } from './updateService.js';
import { getNotifications } from './notificationService.js';
import { getIncidents } from './incidentService.js';

export async function getDashboardStats() {
  const [websites, forms, updates, notifications, incidents] = await Promise.all([
    listWebsites(),
    listForms(),
    getUpdates({ status: 'pending' }),
    getNotifications({ unreadOnly: true }),
    getIncidents({ status: 'active' })
  ]);

  const leads = websites.filter((item) => item.type === 'lead');
  const nonLeads = websites.filter((item) => item.type === 'non-lead');
  const workingForms = forms.filter((item) => item.status === 'working');
  const brokenForms = forms.filter((item) => item.status === 'broken');
  const offline = websites.filter((item) => item.status === 'offline');
  const coreUpdates = updates.filter((item) => item.type === 'core');
  const pluginUpdates = updates.filter((item) => item.type === 'plugin');
  const themeUpdates = updates.filter((item) => item.type === 'theme');
  const leadIds = new Set(leads.map((item) => item.id));
  const leadBrokenForms = brokenForms.filter((item) => leadIds.has(item.websiteId) || item.criticalAlert);
  const criticalAlerts = new Set([
    ...leadBrokenForms.map((item) => `form:${item.id}`),
    ...offline.map((item) => `site:${item.id}`)
  ]).size;

  return {
    totalWebsites: websites.length,
    leadWebsites: leads.length,
    nonLeadWebsites: nonLeads.length,
    totalForms: forms.length,
    workingForms: workingForms.length,
    brokenForms: brokenForms.length,
    websitesOffline: offline.length,
    wordpressUpdates: coreUpdates.length,
    pluginUpdates: pluginUpdates.length,
    themeUpdates: themeUpdates.length,
    pendingUpdates: updates.length,
    criticalAlerts,
    unreadNotifications: notifications.length,
    websites,
    recentNotifications: notifications.slice(0, 8),
    activeIncidents: incidents.slice(0, 8)
  };
}
