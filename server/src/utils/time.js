import { config } from '../config/index.js';

const MANILA_OFFSET = '+08:00';

function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Store timestamps as ISO-8601 with a consistent Asia/Manila offset.
 * Manila does not observe DST, so +08:00 is stable.
 */
export function nowIso(timezone = config.timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type)?.value;
  const offset = timezone === 'Asia/Manila' ? MANILA_OFFSET : MANILA_OFFSET;

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${offset}`;
}

export function formatDisplay(iso, timezone = config.timezone) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

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

export function secondsBetween(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
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
  if (!parts.length) parts.push(`${minutes} minutes`);
  return parts.join(' ');
}

export function addMonthsIso(iso, months = 1) {
  const date = new Date(iso || Date.now());
  if (Number.isNaN(date.getTime())) return nowIso();
  const day = date.getUTCDate();
  date.setUTCMonth(date.getUTCMonth() + months);
  if (date.getUTCDate() < day) date.setUTCDate(0);
  return date.toISOString();
}
