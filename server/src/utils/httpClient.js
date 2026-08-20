import { config } from '../config/index.js';
import { assertSafeUrl } from './ssrf.js';

const DEFAULT_HEADERS = {
  'User-Agent': 'WordPressMonitoring/1.0 (+internal-monitor)',
  Accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8'
};

function classifyNetworkError(error) {
  const code = error.cause?.code || error.code || '';
  const message = error.message || 'Request failed';

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { kind: 'dns', message: `DNS error: ${code}` };
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') {
    return { kind: 'connection', message: `Connection error: ${code}` };
  }
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || /certificate|ssl|tls/i.test(message)) {
    return { kind: 'ssl', message: `SSL error: ${message}` };
  }
  if (error.name === 'TimeoutError' || code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return { kind: 'timeout', message: 'Request timed out' };
  }
  return { kind: 'request', message };
}

/**
 * Fetch a remote URL with SSRF checks, redirect revalidation,
 * response size limits, and a hard timeout.
 */
export async function safeFetch(rawUrl, options = {}) {
  const {
    method = 'GET',
    timeoutMs = config.requestTimeoutMs,
    maxBytes = config.maxResponseBytes,
    allowedOrigins = null,
    headers = {},
    maxRedirects = 3,
    parseJson = false,
    body = undefined
  } = options;

  const started = Date.now();
  let currentUrl = rawUrl;
  let redirects = 0;
  let cookieHeader = headers.Cookie || headers.cookie || '';

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const parsed = await assertSafeUrl(currentUrl, { allowedOrigins });
      const requestHeaders = { ...DEFAULT_HEADERS, ...headers };
      if (cookieHeader) requestHeaders.Cookie = cookieHeader;

      const response = await fetch(parsed.toString(), {
        method,
        headers: requestHeaders,
        body: body === undefined ? undefined : body,
        redirect: 'manual',
        signal: controller.signal
      });

      const cookies = readSetCookies(response);
      cookieHeader = mergeCookieHeader(cookieHeader, cookiePairs(cookies));

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location || redirects >= maxRedirects) {
          return {
            ok: false,
            status: response.status,
            url: parsed.toString(),
            location: location || null,
            cookies: cookieHeader ? cookieHeader.split('; ').filter(Boolean) : cookies,
            responseTime: Date.now() - started,
            error: { kind: 'redirect', message: 'Unsafe or excessive redirects' }
          };
        }
        redirects += 1;
        currentUrl = new URL(location, parsed).toString();
        continue;
      }

      const buffer = await readLimited(response, maxBytes);
      const text = buffer.toString('utf8');

      const headerEntries = [...response.headers.entries()].filter(
        ([name]) => !['set-cookie', 'authorization'].includes(name.toLowerCase())
      );

      return {
        ok: response.ok,
        status: response.status,
        url: parsed.toString(),
        headers: Object.fromEntries(headerEntries),
        cookies: cookieHeader ? cookieHeader.split('; ').filter(Boolean) : cookies,
        location: response.headers.get('location'),
        body: text,
        json: parseJson ? tryJson(text) : null,
        responseTime: Date.now() - started
      };
    } catch (error) {
      const classified = classifyNetworkError(error);
      return {
        ok: false,
        status: 0,
        url: currentUrl,
        body: '',
        json: null,
        cookies: [],
        responseTime: Date.now() - started,
        error: classified
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === 'function') {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
}

function cookiePairs(setCookies) {
  return (setCookies || []).map((entry) => String(entry).split(';')[0]).filter(Boolean);
}

function mergeCookieHeader(existing, incomingPairs) {
  const map = new Map();
  for (const pair of String(existing || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    map.set(pair.split('=')[0], pair);
  }
  for (const pair of incomingPairs) {
    map.set(pair.split('=')[0], pair);
  }
  return [...map.values()].join('; ');
}

async function readLimited(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) {
      throw new Error('Response exceeded maximum size');
    }
    return Buffer.from(text);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error('Response exceeded maximum size');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function tryJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export function isSuccessStatus(status) {
  return status >= 200 && status < 400;
}
