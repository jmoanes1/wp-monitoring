import { safeFetch } from '../utils/httpClient.js';
import { originOf, siteOrigins } from '../utils/ssrf.js';
import * as credentialService from '../services/credentialService.js';
import { nowIso } from '../utils/time.js';
import { logger } from '../utils/logger.js';

const GENERIC_FAILURE = 'WordPress connection failed. Please verify the WordPress Admin URL and credentials.';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WordPressMonitoring/1.0';
const AUTH_SESSION_FAILURE = 'Unable to sign in to WordPress admin. Plugin updates require a working wp-admin session.';

function basicAuthHeader(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function hasLoggedInCookie(setCookies) {
  return (setCookies || []).some((entry) => /wordpress_logged_in_/i.test(String(entry)));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function siteBase(websiteUrl) {
  return websiteUrl.endsWith('/') ? websiteUrl : `${websiteUrl}/`;
}

function wpFileUrl(websiteUrl, file) {
  return new URL(file, siteBase(websiteUrl)).toString();
}

function loginUrlFromAdmin(adminUrl, websiteUrl) {
  try {
    const parsed = new URL(adminUrl);
    if (!/wp-admin/i.test(parsed.pathname)) {
      return wpFileUrl(websiteUrl, 'wp-login.php');
    }
    parsed.pathname = `${parsed.pathname.replace(/\/wp-admin\/?.*$/i, '/')}wp-login.php`.replace(/\/{2,}/g, '/');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return wpFileUrl(websiteUrl, 'wp-login.php');
  }
}

function mergeCookies(...groups) {
  const map = new Map();
  for (const group of groups) {
    const pairs = Array.isArray(group)
      ? group.map((entry) => String(entry).split(';')[0])
      : String(group || '')
          .split(';')
          .map((part) => part.trim());
    for (const pair of pairs.filter(Boolean)) {
      map.set(pair.split('=')[0], pair);
    }
  }
  return [...map.values()].join('; ');
}

/**
 * Tests WordPress credentials on the backend only.
 * Never logs or returns the password, cookies, or Authorization header.
 */
export async function testWordPressConnection(website, credentials) {
  const allowedOrigins = siteOrigins(website.url);
  const adminUrl = credentials.adminUrl || wpFileUrl(website.url, 'wp-admin');
  const loginUrl = loginUrlFromAdmin(adminUrl, website.url);
  const steps = [];

  const loginHeaders = {
    'User-Agent': BROWSER_UA
  };
  const loginPage = await safeFetch(loginUrl, { allowedOrigins, maxRedirects: 4, headers: loginHeaders });
  const adminResult = await safeFetch(adminUrl, { allowedOrigins, maxRedirects: 4, headers: loginHeaders });
  const reachable =
    (loginPage.status > 0 && loginPage.status < 500) ||
    (adminResult.status > 0 && adminResult.status < 500);

  steps.push({
    key: 'admin_url',
    label: 'WordPress Admin URL reachable',
    ok: reachable
  });

  if (!reachable) {
    await credentialService.updateConnectionStatus(website.id, {
      status: 'failed',
      lastTestedAt: nowIso()
    });
    return failResult(steps, website.id);
  }

  // Cookie/session login first: a normal WordPress password usually cannot use REST Basic Auth.
  const cookieAuth = await tryCookieAuth(website, credentials, allowedOrigins, loginPage, loginUrl);
  const xmlAuth = cookieAuth.ok ? { ok: true } : await tryXmlRpcAuth(website, credentials, allowedOrigins);
  const restAuth = cookieAuth.ok || xmlAuth.ok ? { ok: true } : await tryRestAuth(website, credentials, allowedOrigins);

  const accepted = Boolean(cookieAuth.ok || xmlAuth.ok || restAuth.ok);
  steps.push({
    key: 'credentials',
    label: 'Credentials accepted',
    ok: accepted
  });
  steps.push({
    key: 'connection',
    label: 'WordPress connection successful',
    ok: accepted
  });

  const lastConnectedAt = accepted ? nowIso() : null;
  await credentialService.updateConnectionStatus(website.id, {
    status: accepted ? 'connected' : 'failed',
    lastTestedAt: nowIso(),
    ...(accepted ? { lastConnectedAt } : {})
  });

  if (!accepted) {
    logger.warn('WordPress credential test failed', { websiteId: website.id });
    return failResult(steps, website.id);
  }

  logger.info('WordPress credential test succeeded', { websiteId: website.id });
  return {
    success: true,
    status: 'connected',
    lastConnectedAt,
    steps,
    method: cookieAuth.ok ? 'session' : xmlAuth.ok ? 'xmlrpc' : 'rest'
  };
}

function failResult(steps, websiteId) {
  return {
    success: false,
    status: 'failed',
    lastConnectedAt: null,
    steps,
    error: GENERIC_FAILURE,
    websiteId
  };
}

async function tryRestAuth(website, credentials, allowedOrigins) {
  const meUrl = wpFileUrl(website.url, 'wp-json/wp/v2/users/me?context=edit');
  const result = await safeFetch(meUrl, {
    allowedOrigins,
    parseJson: true,
    headers: {
      Authorization: basicAuthHeader(credentials.username, credentials.password),
      Accept: 'application/json'
    }
  });
  const ok = result.status === 200 && result.json && (result.json.id || result.json.slug || result.json.name);
  return { ok, json: result.json };
}

async function tryXmlRpcAuth(website, credentials, allowedOrigins) {
  const xml = `<?xml version="1.0"?><methodCall><methodName>wp.getProfile</methodName><params><param><value><int>1</int></value></param><param><value><string>${escapeXml(credentials.username)}</string></value></param><param><value><string>${escapeXml(credentials.password)}</string></value></param></params></methodCall>`;
  const result = await safeFetch(wpFileUrl(website.url, 'xmlrpc.php'), {
    method: 'POST',
    allowedOrigins,
    headers: { 'Content-Type': 'text/xml' },
    body: xml
  });
  const ok =
    result.status === 200 &&
    /<methodResponse>/i.test(result.body || '') &&
    !/<fault>/i.test(result.body || '');
  return { ok };
}

async function tryCookieAuth(website, credentials, allowedOrigins, loginPage, loginUrl) {
  const resolvedLogin = loginUrl || loginUrlFromAdmin(credentials.adminUrl, website.url);
  const page = loginPage?.status
    ? loginPage
    : await safeFetch(resolvedLogin, { allowedOrigins, maxRedirects: 4, headers: { 'User-Agent': BROWSER_UA } });
  // POST to the login URL after www/apex redirects so the test cookie matches the host.
  const postUrl = /wp-login\.php/i.test(page?.url || '') ? page.url : resolvedLogin;
  const cookies = mergeCookies('wordpress_test_cookie=WP Cookie check', page?.cookies);
  const redirectTo = credentials.adminUrl || wpFileUrl(website.url, 'wp-admin/');
  const body = new URLSearchParams({
    log: credentials.username,
    pwd: credentials.password,
    'wp-submit': 'Log In',
    redirect_to: redirectTo,
    testcookie: '1',
    rememberme: 'forever'
  }).toString();

  const posted = await safeFetch(postUrl, {
    method: 'POST',
    allowedOrigins,
    maxRedirects: 0,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: originOf(postUrl),
      Referer: postUrl,
      Cookie: cookies,
      'User-Agent': BROWSER_UA
    },
    body
  });

  const location = posted.location || '';
  const redirectedToAdmin = /wp-admin/i.test(location) && !/wp-login\.php/i.test(location);
  const loggedIn = hasLoggedInCookie(posted.cookies);
  const bouncedToLogin = /reauth=|wp-login\.php/i.test(location);
  const dashboardHtml =
    /id=["']wpadminbar["']|body class=["'][^"']*wp-admin/i.test(posted.body || '') &&
    !/name=["']log["']/i.test(posted.body || '');
  return {
    ok: ((redirectedToAdmin || loggedIn || dashboardHtml) && !bouncedToLogin) || (loggedIn && !bouncedToLogin),
    cookies: mergeCookies(page?.cookies, cookies, posted.cookies)
  };
}

/**
 * Opens a wp-admin session for plugin updates. Cookies and passwords never leave this module.
 */
export async function openWordPressAdminSession(website, credentials) {
  const allowedOrigins = siteOrigins(website.url);
  const adminUrl = credentials.adminUrl || wpFileUrl(website.url, 'wp-admin');
  const loginUrl = loginUrlFromAdmin(adminUrl, website.url);
  const loginHeaders = { 'User-Agent': BROWSER_UA };
  const loginPage = await safeFetch(loginUrl, { allowedOrigins, maxRedirects: 4, headers: loginHeaders });
  const cookieAuth = await tryCookieAuth(website, credentials, allowedOrigins, loginPage, loginUrl);

  if (!cookieAuth.ok) {
    return { ok: false, error: AUTH_SESSION_FAILURE, code: 'auth', allowedOrigins };
  }

  const cookieHeader = mergeCookies(loginPage.cookies, cookieAuth.cookies);
  const pluginsPage = await fetchAdminHtml(website, 'wp-admin/plugins.php', cookieHeader, allowedOrigins);
  if (!pluginsPage.ok) {
    return { ok: false, error: AUTH_SESSION_FAILURE, code: 'auth', allowedOrigins };
  }

  let nonce = extractUpdatesNonce(pluginsPage.body);
  let pluginFiles = parsePluginFilesFromAdmin(pluginsPage.body);
  let cookies = mergeCookies(cookieHeader, pluginsPage.cookies);

  if (!nonce) {
    const corePage = await fetchAdminHtml(website, 'wp-admin/update-core.php', cookies, allowedOrigins);
    if (corePage.ok) {
      nonce = extractUpdatesNonce(corePage.body) || nonce;
      pluginFiles = new Map([...pluginFiles, ...parsePluginFilesFromAdmin(corePage.body)]);
      cookies = mergeCookies(cookies, corePage.cookies);
    }
  }

  const restPlugins = await fetchJsonList(wpFileUrl(website.url, 'wp-json/wp/v2/plugins'), credentials, allowedOrigins);
  for (const plugin of restPlugins) {
    const slug = pluginSlug(plugin);
    const file = plugin.plugin || null;
    if (slug && file && !pluginFiles.has(slug)) pluginFiles.set(slug, file);
  }

  if (!nonce) {
    return {
      ok: false,
      error: 'WordPress did not provide an update nonce. The saved account may lack plugin update permission.',
      code: 'auth',
      allowedOrigins
    };
  }

  await credentialService.updateConnectionStatus(website.id, {
    status: 'connected',
    lastConnectedAt: nowIso(),
    lastTestedAt: nowIso()
  });

  return {
    ok: true,
    allowedOrigins,
    nonce,
    pluginFiles,
    cookieHeader: cookies,
    pluginsUrl: wpFileUrl(website.url, 'wp-admin/plugins.php'),
    ajaxUrl: wpFileUrl(website.url, 'wp-admin/admin-ajax.php')
  };
}

export function wordpressBrowserHeaders(extra = {}) {
  return { 'User-Agent': BROWSER_UA, ...extra };
}

async function fetchAdminHtml(website, file, cookieHeader, allowedOrigins) {
  const result = await safeFetch(wpFileUrl(website.url, file), {
    allowedOrigins,
    maxRedirects: 4,
    headers: {
      Cookie: cookieHeader,
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  const bouncedToLogin =
    /wp-login\.php/i.test(result.url || '') ||
    /name=["']log["']/i.test(result.body || '') ||
    /reauth=/i.test(result.url || '');
  return { ...result, ok: Boolean(result.status >= 200 && result.status < 400 && result.body && !bouncedToLogin) };
}

function extractUpdatesNonce(html) {
  if (!html) return null;
  const match = String(html).match(/"ajax_nonce"\s*:\s*"([a-f0-9]+)"/i);
  return match?.[1] || null;
}

function parsePluginFilesFromAdmin(html) {
  const map = new Map();
  if (!html) return map;
  const source = String(html);
  const pairs = [
    [...source.matchAll(/data-plugin=["']([^"']+)["'][^>]*data-slug=["']([^"']+)["']/gi)],
    [...source.matchAll(/data-slug=["']([^"']+)["'][^>]*data-plugin=["']([^"']+)["']/gi)]
  ];
  for (const match of pairs[0]) {
    map.set(String(match[2]).toLowerCase(), match[1]);
  }
  for (const match of pairs[1]) {
    map.set(String(match[1]).toLowerCase(), match[2]);
  }
  return map;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .trim();
}

export async function fetchAuthenticatedWordPress(website, homepageDetected) {
  let credentials;
  try {
    credentials = await credentialService.getDecryptedCredentials(website.id);
  } catch {
    return homepageDetected;
  }
  if (!credentials) return homepageDetected;

  const allowedOrigins = siteOrigins(website.url);
  const rest = await tryRestAuth(website, credentials, allowedOrigins);

  if (!rest.ok) {
    const xmlAuth = await tryXmlRpcAuth(website, credentials, allowedOrigins);
    const loginPage = await safeFetch(wpFileUrl(website.url, 'wp-login.php'), {
      allowedOrigins,
      maxRedirects: 4
    });
    const cookieAuth = xmlAuth.ok
      ? { ok: true }
      : await tryCookieAuth(website, credentials, allowedOrigins, loginPage, wpFileUrl(website.url, 'wp-login.php'));
    if (xmlAuth.ok || cookieAuth.ok) {
      await credentialService.updateConnectionStatus(website.id, {
        status: 'connected',
        lastConnectedAt: nowIso(),
        lastTestedAt: nowIso()
      });
      return {
        ...homepageDetected,
        detected: true,
        authenticated: true,
        health: { restAuthenticated: false, sessionAuthenticated: true }
      };
    }
    return homepageDetected;
  }

  const plugins = await fetchJsonList(wpFileUrl(website.url, 'wp-json/wp/v2/plugins'), credentials, allowedOrigins);
  const themes = await fetchJsonList(wpFileUrl(website.url, 'wp-json/wp/v2/themes'), credentials, allowedOrigins);

  const mappedPlugins = Array.isArray(plugins)
    ? plugins.map((plugin) => ({
        slug: pluginSlug(plugin),
        file: plugin.plugin || null,
        name: stripHtml(plugin.name) || pluginSlug(plugin),
        version: plugin.version || null,
        source: 'authenticated'
      }))
    : homepageDetected.plugins;

  const mappedThemes = Array.isArray(themes)
    ? themes.map((theme) => ({
        slug: theme.stylesheet || theme.template || 'theme',
        name: theme.name?.rendered || theme.name || theme.stylesheet,
        version: theme.version || null,
        source: 'authenticated'
      }))
    : homepageDetected.themes;

  await credentialService.updateConnectionStatus(website.id, {
    status: 'connected',
    lastConnectedAt: nowIso(),
    lastTestedAt: nowIso()
  });

  return {
    ...homepageDetected,
    detected: true,
    plugins: mappedPlugins.length ? mappedPlugins : homepageDetected.plugins,
    themes: mappedThemes.length ? mappedThemes : homepageDetected.themes,
    authenticated: true,
    health: {
      restAuthenticated: true,
      pluginCount: mappedPlugins.length,
      themeCount: mappedThemes.length
    }
  };
}

async function fetchJsonList(url, credentials, allowedOrigins) {
  const result = await safeFetch(url, {
    allowedOrigins,
    parseJson: true,
    headers: {
      Authorization: basicAuthHeader(credentials.username, credentials.password),
      Accept: 'application/json'
    }
  });
  return Array.isArray(result.json) ? result.json : [];
}

function pluginSlug(plugin) {
  const raw = plugin.plugin || plugin.textdomain || plugin.name || 'plugin';
  return String(raw).split('/')[0].toLowerCase().replace(/\.php$/, '');
}
