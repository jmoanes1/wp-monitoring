import * as cheerio from 'cheerio';
import { safeFetch } from '../utils/httpClient.js';
import { originOf } from '../utils/ssrf.js';
import { upsertPendingUpdate, resolveStaleUpdates } from '../services/updateService.js';
import { fetchAuthenticatedWordPress } from './wordpressConnectionMonitor.js';

const WP_API_ORIGIN = ['https://api.wordpress.org'];
let coreLatestCache = { value: null, expiresAt: 0 };
const pluginCache = new Map();

export async function checkWordPress(website, homepageHtml, options = {}) {
  const pluginVersionOverrides = options.pluginVersionOverrides || {};
  const allowedOrigins = [originOf(website.url)];
  let detected = await detectWordPress(website, homepageHtml, allowedOrigins);
  const pendingKeys = new Set();

  if (!detected.detected) {
    try {
      const authed = await fetchAuthenticatedWordPress(website, detected);
      if (authed.authenticated) {
        detected = authed;
      }
    } catch {
      await resolveStaleUpdates(website.id, pendingKeys);
      return detected;
    }
    if (!detected.detected) {
      await resolveStaleUpdates(website.id, pendingKeys);
      return detected;
    }
  } else {
    try {
      detected = await fetchAuthenticatedWordPress(website, detected);
    } catch {
      // Public plugin/theme signals remain available.
    }
  }

  const latestCore = await getLatestCoreVersion();
  detected.latestVersion = latestCore;
  detected.updateAvailable = Boolean(
    detected.version && latestCore && compareVersions(detected.version, latestCore) < 0
  );

  if (detected.updateAvailable) {
    pendingKeys.add('core:wordpress');
    await upsertPendingUpdate({
      websiteId: website.id,
      websiteName: website.name,
      type: 'core',
      name: 'WordPress',
      slug: 'wordpress',
      currentVersion: detected.version,
      availableVersion: latestCore
    });
  }

  const pluginResults = [];
  const previousPlugins = new Map((website.wordpress?.plugins || []).map((item) => [item.slug, item]));
  for (const plugin of detected.plugins) {
    const latest = await getLatestPluginVersion(plugin.slug);
    // Prefer the version WordPress just reported after a successful update so
    // stale public HTML cache cannot keep showing an outdated plugin.
    const current = pluginVersionOverrides[plugin.slug] || plugin.version || null;
    const updateAvailable = Boolean(latest && current && compareVersions(current, latest) < 0);
    const previous = previousPlugins.get(plugin.slug);
    const record = {
      ...plugin,
      file: plugin.file || previous?.file || null,
      version: current,
      latestVersion: latest,
      updateAvailable
    };
    pluginResults.push(record);
    if (updateAvailable) {
      pendingKeys.add(`plugin:${plugin.slug}`);
      await upsertPendingUpdate({
        websiteId: website.id,
        websiteName: website.name,
        type: 'plugin',
        name: plugin.name,
        slug: plugin.slug,
        currentVersion: current,
        availableVersion: latest
      });
    }
  }

  const themeResults = [];
  for (const theme of detected.themes) {
    const latest = await getLatestThemeVersion(theme.slug);
    const current = theme.version || null;
    const updateAvailable = Boolean(latest && current && compareVersions(current, latest) < 0);
    const record = { ...theme, latestVersion: latest, updateAvailable };
    themeResults.push(record);
    if (updateAvailable) {
      pendingKeys.add(`theme:${theme.slug}`);
      await upsertPendingUpdate({
        websiteId: website.id,
        websiteName: website.name,
        type: 'theme',
        name: theme.name,
        slug: theme.slug,
        currentVersion: current,
        availableVersion: latest
      });
    }
  }

  await resolveStaleUpdates(website.id, pendingKeys);

  return {
    ...detected,
    plugins: pluginResults,
    themes: themeResults
  };
}

async function detectWordPress(website, homepageHtml, allowedOrigins) {
  const html = homepageHtml || '';
  const $ = cheerio.load(html);
  const generator = $('meta[name="generator"]').attr('content') || '';
  const fromMeta = generator.match(/WordPress\s+([0-9.]+)/i);
  const restLink = $('link[rel="https://api.w.org/"]').attr('href');

  let version = fromMeta?.[1] || null;
  let detected = Boolean(fromMeta || restLink || /wp-content\//i.test(html) || /wp-includes\//i.test(html));

  if (!version) {
    const feed = await safeFetch(new URL('/feed/', website.url).toString(), { allowedOrigins });
    const feedMatch = feed.body?.match(/<generator>https?:\/\/wordpress\.org\/\?v=([0-9.]+)/i);
    if (feedMatch) {
      version = feedMatch[1];
      detected = true;
    }
  }

  if (!detected) {
    const rest = await safeFetch(new URL('/wp-json/', website.url).toString(), {
      allowedOrigins,
      parseJson: true
    });
    if (rest.json?.namespaces || rest.json?.name) {
      detected = true;
    }
  }

  return {
    detected,
    version,
    latestVersion: null,
    updateAvailable: false,
    plugins: detectPlugins(html),
    themes: detectThemes(html),
    restApi: Boolean(restLink)
  };
}

function detectPlugins(html) {
  const matches = html.matchAll(/\/wp-content\/plugins\/([a-z0-9-]+)\//gi);
  const slugs = [...new Set([...matches].map((match) => match[1].toLowerCase()))];
  return slugs.slice(0, 40).map((slug) => ({
    slug,
    name: humanizeSlug(slug),
    version: extractAssetVersion(html, `/wp-content/plugins/${slug}/`)
  }));
}

function detectThemes(html) {
  const matches = html.matchAll(/\/wp-content\/themes\/([a-z0-9-]+)\//gi);
  const slugs = [...new Set([...matches].map((match) => match[1].toLowerCase()))]
    .filter((slug) => slug !== 'twentytwentyfour' || true);
  return slugs.slice(0, 8).map((slug) => ({
    slug,
    name: humanizeSlug(slug),
    version: extractAssetVersion(html, `/wp-content/themes/${slug}/`)
  }));
}

function extractAssetVersion(html, pathFragment) {
  const pattern = new RegExp(`${escapeRegExp(pathFragment)}[^"'\\s]*[?&]ver=([0-9.]+)`, 'i');
  return html.match(pattern)?.[1] || null;
}

function humanizeSlug(slug) {
  return slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getLatestCoreVersion() {
  if (coreLatestCache.value && coreLatestCache.expiresAt > Date.now()) {
    return coreLatestCache.value;
  }
  const result = await safeFetch('https://api.wordpress.org/core/version-check/1.7/', {
    allowedOrigins: WP_API_ORIGIN,
    parseJson: true
  });
  const version = result.json?.offers?.[0]?.current || result.json?.offers?.[0]?.version || null;
  coreLatestCache = { value: version, expiresAt: Date.now() + 6 * 60 * 60 * 1000 };
  return version;
}

async function getLatestPluginVersion(slug) {
  const cached = pluginCache.get(`plugin:${slug}`);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = await safeFetch(
    `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${encodeURIComponent(slug)}`,
    { allowedOrigins: WP_API_ORIGIN, parseJson: true }
  );
  const version = result.json?.version || null;
  pluginCache.set(`plugin:${slug}`, { value: version, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return version;
}

async function getLatestThemeVersion(slug) {
  const cached = pluginCache.get(`theme:${slug}`);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const result = await safeFetch(
    `https://api.wordpress.org/themes/info/1.2/?action=theme_information&request[slug]=${encodeURIComponent(slug)}`,
    { allowedOrigins: WP_API_ORIGIN, parseJson: true }
  );
  const version = result.json?.version || null;
  pluginCache.set(`theme:${slug}`, { value: version, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return version;
}

export function compareVersions(a, b) {
  const pa = String(a).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = String(b).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}
