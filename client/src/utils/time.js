const TIMEZONE = 'Asia/Manila';

export function formatDateTime(iso, timezone = TIMEZONE) {
  if (!iso) return { date: '—', time: '—', label: '—' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '—', label: '—' };

  const datePart = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);

  const timePart = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);

  return { date: datePart, time: timePart, label: `${datePart} ${timePart}` };
}

export function formatDuration(seconds) {
  if (!seconds || seconds < 1) return '0 seconds';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
  if (!hours && remaining) parts.push(`${remaining} second${remaining === 1 ? '' : 's'}`);
  return parts.join(' ') || '0 seconds';
}
