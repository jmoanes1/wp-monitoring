import { formatDateTime, formatDuration } from './time.js';

export function notificationEmoji(item) {
  const map = {
    form_broken: '🔴',
    form_recovered: '🟢',
    website_offline: '🔴',
    website_online: '🟢',
    update_detected: '🟠',
    ssl_warning: '🟠',
    form_test_failed: '🔴'
  };
  return map[item.type] || '🔔';
}

export function notificationStatus(item) {
  return item.status || (item.type === 'form_recovered' || item.type === 'website_online' ? 'resolved' : 'active');
}

export function notificationLines(item) {
  const meta = item.metadata || {};
  const detected = formatDateTime(meta.detectedAt || item.createdAt);

  if (item.type === 'form_broken') {
    return [
      `Website: ${meta.websiteName || 'Unknown'}`,
      `Type: ${meta.websiteTypeLabel || meta.websiteType || '—'}`,
      `Form: ${meta.formName || 'Unknown'}`,
      `Previous Status: ${meta.previousStatusLabel || meta.previousStatus || '—'}`,
      `Current Status: Broken`,
      meta.errorMessage ? `Error: ${meta.errorMessage}` : null,
      `Detected: ${detected.label}`
    ].filter(Boolean);
  }

  if (item.type === 'form_recovered') {
    return [
      `Website: ${meta.websiteName || 'Unknown'}`,
      `Form: ${meta.formName || 'Unknown'}`,
      `Broken Since: ${formatDateTime(meta.startedAt).time}`,
      `Recovered: ${formatDateTime(meta.resolvedAt).time}`,
      `Downtime: ${meta.downtimeLabel || formatDuration(meta.downtimeSeconds)}`
    ];
  }

  if (item.type === 'update_detected') {
    return [
      meta.websiteName || 'Unknown website',
      meta.name || 'Update',
      `${meta.currentVersion || 'unknown'} → ${meta.availableVersion || '—'}`,
      `Detected: ${detected.label}`
    ];
  }

  if (item.type === 'website_offline') {
    return [
      `Website: ${meta.websiteName || 'Unknown'}`,
      `Type: ${meta.websiteTypeLabel || '—'}`,
      `Current Status: Offline`,
      meta.errorMessage ? `Error: ${meta.errorMessage}` : null,
      `Detected: ${detected.label}`
    ].filter(Boolean);
  }

  if (item.type === 'website_online') {
    return [
      `Website: ${meta.websiteName || 'Unknown'}`,
      `Downtime: ${meta.downtimeLabel || formatDuration(meta.downtimeSeconds)}`,
      `Recovered: ${formatDateTime(meta.resolvedAt || item.createdAt).label}`
    ];
  }

  if (item.type === 'form_test_failed') {
    return [
      `Website: ${meta.websiteName || 'Unknown'}`,
      `Form: ${meta.formName || 'Unknown'}`,
      `Recipient: ${meta.recipient || 'john@medisure.com'}`,
      meta.errorMessage ? `Error: ${meta.errorMessage}` : null,
      `Tested: ${formatDateTime(meta.testedAt || item.createdAt).label}`
    ].filter(Boolean);
  }

  if (item.type === 'ssl_warning') {
    return [
      `Website: ${meta.websiteName || 'Unknown'}`,
      meta.expiresAt ? `Expires: ${formatDateTime(meta.expiresAt).date}` : null,
      meta.daysRemaining != null ? `${meta.daysRemaining} days remaining` : null,
      `Detected: ${detected.label}`
    ].filter(Boolean);
  }

  return [item.message, `Detected: ${detected.label}`];
}
