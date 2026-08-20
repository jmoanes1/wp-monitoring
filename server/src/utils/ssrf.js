import { lookup } from 'dns/promises';
import net from 'net';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'instance-data'
]);

function ipv4ToInt(ip) {
  return ip.split('.').reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function inCidr(ip, cidr, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidr) & mask);
}

export function isPrivateIp(ip) {
  if (!ip) return true;

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:') || normalized.startsWith('fc') || normalized.startsWith('fd')) {
      return true;
    }
    if (normalized.startsWith('::ffff:')) {
      return isPrivateIp(normalized.replace('::ffff:', ''));
    }
    return false;
  }

  if (!net.isIPv4(ip)) return true;

  return (
    ip === '0.0.0.0' ||
    inCidr(ip, '127.0.0.0', 8) ||
    inCidr(ip, '10.0.0.0', 8) ||
    inCidr(ip, '172.16.0.0', 12) ||
    inCidr(ip, '192.168.0.0', 16) ||
    inCidr(ip, '169.254.0.0', 16) ||
    inCidr(ip, '100.64.0.0', 10) ||
    inCidr(ip, '192.0.2.0', 24) ||
    inCidr(ip, '198.51.100.0', 24) ||
    inCidr(ip, '203.0.113.0', 24) ||
    inCidr(ip, '224.0.0.0', 4) ||
    inCidr(ip, '240.0.0.0', 4)
  );
}

function assertHostnameSafe(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('URL host is not allowed');
  }

  if (host.includes('%') || host.includes('\\')) {
    throw new Error('URL host is not allowed');
  }

  if (net.isIP(host) && isPrivateIp(host)) {
    throw new Error('Private or local IP addresses are not allowed');
  }
}

/**
 * Validate that a URL is safe to fetch from this server.
 * Blocks non-http(s) schemes, localhost, link-local, and RFC1918 ranges.
 * When allowedOrigins is provided, the URL origin must match one of them.
 */
export async function assertSafeUrl(rawUrl, { allowedOrigins = null } = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are allowed');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with credentials are not allowed');
  }

  assertHostnameSafe(parsed.hostname);

  if (allowedOrigins && allowedOrigins.length > 0) {
    const allowed = allowedOrigins.map((origin) => origin.replace(/\/$/, '').toLowerCase());
    if (!allowed.includes(parsed.origin.toLowerCase())) {
      throw new Error('URL is not an authorized monitored origin');
    }
  }

  const lookupResult = await lookup(parsed.hostname, { all: true, verbatim: true });
  if (!lookupResult.length) {
    throw new Error('Unable to resolve host');
  }

  for (const record of lookupResult) {
    if (isPrivateIp(record.address)) {
      throw new Error('Host resolves to a private or local address');
    }
  }

  return parsed;
}

export function originOf(url) {
  return new URL(url).origin;
}

/** www and apex variants of a monitored site, used for admin/login URLs. */
export function siteOrigins(websiteUrl) {
  const origin = originOf(websiteUrl);
  const parsed = new URL(origin);
  const hosts = new Set([parsed.hostname.toLowerCase()]);
  if (parsed.hostname.toLowerCase().startsWith('www.')) {
    hosts.add(parsed.hostname.slice(4).toLowerCase());
  } else {
    hosts.add(`www.${parsed.hostname.toLowerCase()}`);
  }
  return [...hosts].map((host) => `${parsed.protocol}//${host}`);
}

export function resolveUrl(baseUrl, maybeRelative) {
  return new URL(maybeRelative || '', baseUrl).toString();
}
