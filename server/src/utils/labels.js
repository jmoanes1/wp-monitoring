/**
 * Structured notification copy used by the worker and the dashboard.
 * Email is not sent; these strings are for in-app and Socket.IO display.
 */

export function websiteTypeLabel(type) {
  return type === 'lead' ? 'Lead' : 'Non-Lead';
}

export function statusLabel(status) {
  if (!status) return 'Unknown';
  return String(status).replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isLeadWebsite(website) {
  return website?.type === 'lead';
}
