/**
 * Structured notification copy used by the worker and the dashboard.
 * Email is not sent; these strings are for in-app and Socket.IO display.
 */

export function websiteTypeLabel(type) {
  return type === 'lead' ? 'Lead' : 'Non-Lead';
}
