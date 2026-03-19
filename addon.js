// TN (C) 03.2026
// Addon per la connessione a Davinotti servizi XML per la
// visualizzazione delle liste in Stremio
// pagina di configurazione per la scelta dei diversi canali
//
// 2026-03-14 - TN - Prima versione senza servizi facendo scraping
// 2026-03-18 - TN - Collegamento ai servizi XML dedicati
// 2026-03-18 - TN - Poster custom con rating IMDb + Davinotti via sharp
// 2026-03-19 - Ottimizzazioni cache, poster disk cache, fallback controllato, concorrenza limitata


const http = require('http');
const fs = require('fs');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const sharp = require('sharp');

const ADDON_VERSION = '3.0.4';

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const feedCache = new NodeCache({ stdTTL: 43200, checkperiod: 120 });
const metaCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });
const tmdbCache = new NodeCache({ stdTTL: 43200, checkperiod: 120 });
const posterCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });
const missingMetaCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

const DAVINOTTI_SUFFIX = ' (fonte DAVINOTTI.COM)';
const FALLBACK_POSTER = 'https://placehold.co/300x450?text=Davinotti';

const POSTER_CACHE_DIR = path.join(__dirname, 'poster-cache');
if (!fs.existsSync(POSTER_CACHE_DIR)) {
  fs.mkdirSync(POSTER_CACHE_DIR, { recursive: true });
}

const GENRE_FEEDS = {
  action: { type: 'genre', slug: 'action', code: '336', name: 'Action' },
  'animali-assassini': { type: 'genre', slug: 'animali-assassini', code: '114', name: 'Animali assassini' },
  antologia: { type: 'genre', slug: 'antologia', code: '181', name: 'Antologia' },
  'arti-marziali': { type: 'genre', slug: 'arti-marziali', code: '506', name: 'Arti marziali' },
  avventura: { type: 'genre', slug: 'avventura', code: '144', name: 'Avventura' },
  biografico: { type: 'genre', slug: 'biografico', code: '208', name: 'Biografico' },
  comico: { type: 'genre', slug: 'comico', code: '109', name: 'Comico' },
  commedia: { type: 'genre', slug: 'commedia', code: '107', name: 'Commedia' },
  'corto-mediometraggio': { type: 'genre', slug: 'corto-mediometraggio', code: '127', name: 'Corto-mediometraggio' },
  documentario: { type: 'genre', slug: 'documentario', code: '227', name: 'Documentario' },
  drammatico: { type: 'genre', slug: 'drammatico', code: '104', name: 'Drammatico' },
  erotico: { type: 'genre', slug: 'erotico', code: '191', name: 'Erotico' },
  fantascienza: { type: 'genre', slug: 'fantascienza', code: '100', name: 'Fantascienza' },
  fantastico: { type: 'genre', slug: 'fantastico', code: '117', name: 'Fantastico' },
  fiction: { type: 'genre', slug: 'fiction', code: '362', name: 'Fiction' },
  gangster: { type: 'genre', slug: 'gangster-noir', code: '124', name: 'Gangster' },
  giallo: { type: 'genre', slug: 'giallo', code: '108', name: 'Giallo' },
  guerra: { type: 'genre', slug: 'guerra', code: '121', name: 'Guerra' },
  horror: { type: 'genre', slug: 'horror', code: '112', name: 'Horror' },
  musicale: { type: 'genre', slug: 'musicale', code: '142', name: 'Musicale' },
  peplum: { type: 'genre', slug: 'peplum', code: '136', name: 'Peplum' },
  poliziesco: { type: 'genre', slug: 'poliziesco', code: '163', name: 'Poliziesco' },
  sentimentale: { type: 'genre', slug: 'sentimentale', code: '287', name: 'Sentimentale' },
  'spaghetti-western': { type: 'genre', slug: 'spaghetti-western', code: '165', name: 'Spaghetti western' },
  spionaggio: { type: 'genre', slug: 'spionaggio', code: '115', name: 'Spionaggio' },
  teatro: { type: 'genre', slug: 'teatro', code: '275', name: 'Teatro' },
  thriller: { type: 'genre', slug: 'thriller', code: '111', name: 'Thriller' },
  western: { type: 'genre', slug: 'western', code: '123', name: 'Western' },
  netflix: { type: 'streaming', slug: 'netflix', name: 'Netflix' },
  'amazon-prime-video': { type: 'streaming', slug: 'amazon-prime-video', name: 'Amazon Prime Video' },
  'now-tv': { type: 'streaming', slug: 'now-tv', name: 'NOW TV' },
  'rai-play': { type: 'streaming', slug: 'rai-play', name: 'RaiPlay' },
  mubi: { type: 'streaming', slug: 'mubi', name: 'MUBI' },
  'disney-plus': { type: 'streaming', slug: 'disney-plus', name: 'Disney+' },
  timvision: { type: 'streaming', slug: 'timvision', name: 'TIMvision' },
  'mediaset-infinity': { type: 'streaming', slug: 'mediaset-infinity', name: 'Mediaset Infinity' },
  chili: { type: 'streaming', slug: 'chili', name: 'Chili' },
  'apple-tv-plus': { type: 'streaming', slug: 'apple-tv-plus', name: 'Apple TV+' },
  'google-play-movies': { type: 'streaming', slug: 'google-play-movies', name: 'Google Play Movies' },
  'rakuten-tv': { type: 'streaming', slug: 'rakuten-tv', name: 'Rakuten TV' },
  'amazon-video': { type: 'streaming', slug: 'amazon-video', name: 'Amazon Video' },
  'paramount-plus': { type: 'streaming', slug: 'paramount-plus', name: 'Paramount+' },
  'apple-tv': { type: 'streaming', slug: 'apple-tv', name: 'Apple TV' }
};

const DEFAULT_FEEDS = ['commedia', 'fantascienza', 'netflix'];

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function decodeConfigSegment(segment) {
  if (!segment) return { feeds: DEFAULT_FEEDS };

  try {
    const normalized = decodeURIComponent(segment);
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = safeJsonParse(json, { feeds: DEFAULT_FEEDS });
    const requested = Array.isArray(parsed.feeds)
      ? parsed.feeds
      : (Array.isArray(parsed.genres) ? parsed.genres : DEFAULT_FEEDS);

    const validFeeds = requested
      .map(v => String(v).trim().toLowerCase())
      .filter(v => GENRE_FEEDS[v]);

    return { feeds: validFeeds.length ? validFeeds : DEFAULT_FEEDS };
  } catch {
    return { feeds: DEFAULT_FEEDS };
  }
}

function encodeConfig(config) {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
}

function normalizeLink(link) {
  if (!link) return '';
  if (link.startsWith('http://') || link.startsWith('https://')) return link;
  return `https://www.davinotti.com${link}`;
}

function withDavinottiSource(text) {
  const clean = (text || '').trim();
  if (!clean) return `Sinossi non disponibile${DAVINOTTI_SUFFIX}`;
  if (clean.includes(DAVINOTTI_SUFFIX)) return clean;
  return `${clean}${DAVINOTTI_SUFFIX}`;
}

function buildFeedUrl(feedKey) {
  const feed = GENRE_FEEDS[feedKey];
  if (!feed) return '';

  if (feed.type === 'streaming') {
    return `https://www.davinotti.com/xml/streaming/${feed.slug}`;
  }

  return `https://www.davinotti.com/xml/film-per-genere/${feed.slug}/${feed.code}`;
}

function buildCatalogId(feedKey) {
  return `davinotti_${feedKey}`;
}

function feedDisplayName(feedKey) {
  return GENRE_FEEDS[feedKey]?.name || feedKey;
}

function getOrigin(reqHost) {
  return (BASE_URL || reqHost || `http://localhost:${PORT}`).replace(/\/$/, '');
}

function getExistingAssetUrl(origin, names) {
  for (const name of names) {
    if (fs.existsSync(path.join(__dirname, name))) {
      return `${origin}/${name}`;
    }
  }
  return undefined;
}

function buildManifest(config, reqHost) {
  const feeds = config.feeds || DEFAULT_FEEDS;
  const origin = getOrigin(reqHost);

  return {
    id: 'community.davinotti.classifiche.xml',
    version: ADDON_VERSION,
    name: 'Davinotti Classifiche',
    description: 'Cataloghi Davinotti per generi e piattaforme streaming',
    logo: getExistingAssetUrl(origin, ['davinotti-logo.png', 'davinotti-logo.jpg', 'davinotti-logo.jpeg']),
    background: getExistingAssetUrl(origin, ['davinotti-background.jpg', 'davinotti-background.jpeg', 'davinotti-background.png']),
    resources: ['catalog', 'meta'],
    types: ['movie'],
    idPrefixes: ['tt', 'dv'],
    catalogs: feeds.map(feedKey => ({
      type: 'movie',
      id: buildCatalogId(feedKey),
      name: `Davinotti - ${feedDisplayName(feedKey)}`,
      extra: [{ name: 'skip', isRequired: false }]
    })),
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

function formatRating(value) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(1)}/10` : null;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function fetchTmdbMovieById(tmdbId) {
  if (!TMDB_API_KEY || !tmdbId) return null;

  const cacheKey = `tmdb:${tmdbId}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
      timeout: 10000,
      params: {
        api_key: TMDB_API_KEY,
        language: 'it-IT'
      }
    });

    const data = response.data || null;
    tmdbCache.set(cacheKey, data);
    return data;
  } catch (err) {
    if (err.response?.status === 404) {
      tmdbCache.set(cacheKey, null);
      console.warn(`TMDB movie/${tmdbId} non trovato`);
      return null;
    }

    console.error(`Errore TMDB movie/${tmdbId}:`, err.message);
    return null;
  }
}

function parseXmlItems(xml) {
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  const items = [];
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    items.push(match[1]);
  }

  return items;
}

function extractXmlValue(block, tag) {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = block.match(regex);
  if (!match) return '';
  return cheerio.load(match[1], { xmlMode: true }).text().trim();
}

function mapXmlItemToMeta(itemXml, feedKey) {
  const feed = GENRE_FEEDS[feedKey];
  if (!feed) return null;

  const title = extractXmlValue(itemXml, 't');
  const year = extractXmlValue(itemXml, 'y');
  const category = extractXmlValue(itemXml, 'c');
  const dvIdRaw = extractXmlValue(itemXml, 'id');
  const imdbIdRaw = extractXmlValue(itemXml, 'i_id');
  const tmdbIdRaw = extractXmlValue(itemXml, 't_id');
  const link = normalizeLink(extractXmlValue(itemXml, 'l'));
  const votes = extractXmlValue(itemXml, 'v');
  const reviews = extractXmlValue(itemXml, 'vc');

  const imdbId = imdbIdRaw && imdbIdRaw.startsWith('tt') ? imdbIdRaw : '';
  const tmdbId = tmdbIdRaw && /^\d+$/.test(tmdbIdRaw) ? tmdbIdRaw : '';
  const davinottiId = dvIdRaw ? `dv${dvIdRaw}` : '';
  const finalId = imdbId || davinottiId;

  if (!title || !finalId || !link) {
    return null;
  }

  const fallbackDescription = `Film dalla classifica ${feedDisplayName(feedKey)} su davinotti.com`;
  const descriptionParts = [];
  if (category) descriptionParts.push(`Genere: ${category}`);
  if (year) descriptionParts.push(`Anno: ${year}`);
  if (votes) descriptionParts.push(`Voto Davinotti: ${votes}`);
  if (reviews) descriptionParts.push(`Recensioni: ${reviews}`);

  return {
    id: finalId,
    type: 'movie',
    name: title,
    poster: FALLBACK_POSTER,
    posterShape: 'poster',
    description: descriptionParts.length ? descriptionParts.join(' • ') : fallbackDescription,
    genres: [category || feed.name],
    releaseInfo: year || '',
    links: [{ name: 'Scheda Davinotti', category: 'read', url: link }],
    website: link,
    davinottiId,
    imdbId: imdbId || undefined,
    tmdbId: tmdbId || undefined,
    davinottiVotes: votes || undefined,
    davinottiReviews: reviews || undefined,
    feedKey,
    feedName: feed.name
  };
}

async function downloadBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DavinottiStremioAddon/2.0; +Render)'
    }
  });

  return Buffer.from(response.data);
}

function buildPosterSvg(width, height, imdbText, dvText) {
  const bandHeight = Math.max(64, Math.round(height * 0.145));
  const padX = Math.max(12, Math.round(width * 0.04));
  const fontSize = Math.max(27, Math.round(width * 0.080));
  const labelFontSize = Math.max(14, Math.round(width * 0.034));
  const imdbBadgeW = Math.max(44, Math.round(width * 0.15));
  const dvBadgeW = Math.max(34, Math.round(width * 0.10));
  const badgeH = Math.max(28, Math.round(bandHeight * 0.52));
  const baselineY = height - Math.round(bandHeight * 0.28);
  const bottomY = height - bandHeight;
  const dvX = Math.round(width * 0.605);

  return Buffer.from(`
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bandFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.10)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.82)"/>
    </linearGradient>
  </defs>

  <rect x="0" y="${bottomY}" width="${width}" height="${bandHeight}" fill="url(#bandFade)"/>

  <rect x="${padX}" y="${bottomY + Math.round((bandHeight - badgeH) / 2)}" rx="4" ry="4" width="${imdbBadgeW}" height="${badgeH}" fill="#f5c518"/>
  <text x="${padX + Math.round(imdbBadgeW / 2)}" y="${baselineY}" font-family="Arial, Helvetica, sans-serif" font-size="${labelFontSize}" font-weight="700" text-anchor="middle" fill="#111111">IMDb</text>
  <text x="${padX + imdbBadgeW + 10}" y="${baselineY}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff" stroke="rgba(0,0,0,0.45)" stroke-width="1.2" paint-order="stroke">${escapeXml(imdbText || '--')}</text>

  <rect x="${dvX}" y="${bottomY + Math.round((bandHeight - badgeH) / 2)}" rx="4" ry="4" width="${dvBadgeW}" height="${badgeH}" fill="#1f8b4c"/>
  <text x="${dvX + Math.round(dvBadgeW / 2)}" y="${baselineY}" font-family="Arial, Helvetica, sans-serif" font-size="${labelFontSize}" font-weight="700" text-anchor="middle" fill="#ffffff">DV</text>
  <text x="${dvX + dvBadgeW + 10}" y="${baselineY}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="800" fill="#ffffff" stroke="rgba(0,0,0,0.45)" stroke-width="1.2" paint-order="stroke">${escapeXml(dvText || '--')}</text>
</svg>`);
}

function buildPosterCacheKey(meta) {
  return `poster:${meta.id}:${meta.imdbRating || ''}:${meta.davinottiVotes || ''}:${meta.basePoster || meta.poster || ''}`;
}

function buildPosterCachePath(meta) {
  const safeName = buildPosterCacheKey(meta).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(POSTER_CACHE_DIR, `${safeName}.png`);
}

async function renderPosterWithRatings(meta) {
  const cacheKey = buildPosterCacheKey(meta);
  const cached = posterCache.get(cacheKey);
  if (cached) return cached;

  const filePath = buildPosterCachePath(meta);
  if (fs.existsSync(filePath)) {
    const fileBuffer = fs.readFileSync(filePath);
    posterCache.set(cacheKey, fileBuffer);
    return fileBuffer;
  }

  const sourcePoster = meta.basePoster || meta.poster;
  if (!sourcePoster || sourcePoster.includes('placehold.co')) return null;

  const originalBuffer = await downloadBuffer(sourcePoster);
  const image = sharp(originalBuffer, { failOn: 'none' });
  const info = await image.metadata();

  const width = info.width || 300;
  const height = info.height || 450;
  const imdbText = formatRating(meta.imdbRating);
  const dvText = formatRating(meta.davinottiVotes);

  if (!imdbText && !dvText) {
    posterCache.set(cacheKey, originalBuffer);
    return originalBuffer;
  }

  const overlay = buildPosterSvg(width, height, imdbText, dvText);

  const output = await image
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toBuffer();

  fs.writeFileSync(filePath, output);
  posterCache.set(cacheKey, output);
  return output;
}

async function enrichPreviewWithTmdb(meta, reqHost) {
  const origin = getOrigin(reqHost);
  if (!meta) return meta;

  if (!meta.tmdbId) {
    return {
      ...meta,
      basePoster: meta.poster,
      poster: `${origin}/poster/${encodeURIComponent(meta.id)}.png`
    };
  }

  const tmdbData = await fetchTmdbMovieById(meta.tmdbId);
  const basePoster = tmdbData?.poster_path
    ? `https://image.tmdb.org/t/p/w342${tmdbData.poster_path}`
    : meta.poster;

  return {
    ...meta,
    basePoster,
    poster: `${origin}/poster/${encodeURIComponent(meta.id)}.png`,
    background: tmdbData?.backdrop_path
      ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}`
      : meta.background,
    releaseInfo: meta.releaseInfo || tmdbData?.release_date || '',
    imdbRating: tmdbData?.vote_average ? String(tmdbData.vote_average) : meta.imdbRating
  };
}

async function mapWithConcurrency(items, limit, asyncMapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) break;
      results[current] = await asyncMapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchFeedMetas(feedKey, reqHost) {
  const cacheKey = `feed:${feedKey}:${getOrigin(reqHost)}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return cached;

  const url = buildFeedUrl(feedKey);
  if (!url) return [];

  try {
    const response = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DavinottiStremioAddon/2.0; +Render)',
        'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8'
      }
    });

    const xml = response.data;
    const items = parseXmlItems(xml);
    const seen = new Set();
    const baseMetas = [];

    for (const itemXml of items) {
      const baseMeta = mapXmlItemToMeta(itemXml, feedKey);
      if (!baseMeta || seen.has(baseMeta.id)) continue;
      seen.add(baseMeta.id);
      baseMetas.push(baseMeta);
    }

    const enrichedList = await mapWithConcurrency(baseMetas, 5, async (baseMeta) => {
      try {
        return await enrichPreviewWithTmdb(baseMeta, reqHost);
      } catch (err) {
        console.warn(`Errore enrich TMDB ${baseMeta.id}: ${err.message}`);
        return {
          ...baseMeta,
          basePoster: baseMeta.poster,
          poster: `${getOrigin(reqHost)}/poster/${encodeURIComponent(baseMeta.id)}.png`
        };
      }
    });

    const metas = enrichedList.filter(Boolean);

    for (const enriched of metas) {
      metaCache.set(enriched.id, enriched);
      if (enriched.davinottiId) metaCache.set(enriched.davinottiId, enriched);
      if (enriched.imdbId) metaCache.set(enriched.imdbId, enriched);
    }

    feedCache.set(cacheKey, metas);
    return metas;
  } catch (err) {
    console.error(`Errore feed XML ${feedKey}:`, err.message);
    return [];
  }
}

async function scrapeMovieDetail(davinottiUrl, baseMeta) {
  const cacheKey = `detail:${baseMeta.id}`;
  const cached = metaCache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await axios.get(davinottiUrl, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DavinottiStremioAddon/2.0; +Render)'
      }
    });

    const $ = cheerio.load(response.data);
    const pageTitle = $('h1').first().text().trim() || baseMeta.name;

    let description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      $('.field-name-body').text().trim() ||
      $('.node-film .content').text().trim() ||
      $('.content').first().text().trim() ||
      baseMeta.description;

    if (description) {
      description = description.replace(/\s+/g, ' ').trim().slice(0, 1400);
    }

    const tmdbData = baseMeta.tmdbId ? await fetchTmdbMovieById(baseMeta.tmdbId) : null;
    const background = tmdbData?.backdrop_path
      ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}`
      : baseMeta.background;

    const detailParts = [];
    if (baseMeta.releaseInfo) detailParts.push(`Anno: ${baseMeta.releaseInfo}`);
    if (baseMeta.genres?.length) detailParts.push(`Genere: ${baseMeta.genres.join(', ')}`);
    if (baseMeta.imdbRating) detailParts.push(`IMDb: ${formatRating(baseMeta.imdbRating)}`);
    if (baseMeta.davinottiVotes) detailParts.push(`Voto Davinotti: ${formatRating(baseMeta.davinottiVotes)}`);
    if (baseMeta.davinottiReviews) detailParts.push(`Recensioni: ${baseMeta.davinottiReviews}`);

    const fullDescription = [
      detailParts.length ? detailParts.join(' • ') : '',
      description || baseMeta.description || ''
    ].filter(Boolean).join('\n\n');

    const detailed = {
      ...baseMeta,
      name: pageTitle,
      poster: baseMeta.poster,
      background,
      description: withDavinottiSource(fullDescription),
      website: davinottiUrl,
      links: [{ name: 'Scheda Davinotti', category: 'read', url: davinottiUrl }]
    };

    metaCache.set(cacheKey, detailed);
    metaCache.set(detailed.id, detailed);
    if (detailed.davinottiId) metaCache.set(detailed.davinottiId, detailed);
    return detailed;
  } catch (err) {
    console.error(`Errore dettaglio ${davinottiUrl}:`, err.message);
    const fallback = {
      ...baseMeta,
      description: withDavinottiSource(baseMeta.description),
      website: davinottiUrl
    };
    metaCache.set(cacheKey, fallback);
    metaCache.set(baseMeta.id, fallback);
    if (baseMeta.davinottiId) metaCache.set(baseMeta.davinottiId, fallback);
    return fallback;
  }
}

async function findMetaById(id, config, reqHost) {
  const cached = metaCache.get(id);
  if (cached) return cached;

  const feeds = config.feeds?.length ? config.feeds : DEFAULT_FEEDS;
  for (const feedKey of feeds) {
    const metas = await fetchFeedMetas(feedKey, reqHost);
    const found = metas.find(item => item.id === id || item.davinottiId === id || item.imdbId === id);
    if (found) {
      metaCache.set(id, found);
      return found;
    }
  }

  return null;
}

function buildRouterForConfig(config, reqHost) {
  const manifest = buildManifest(config, reqHost);
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'movie') return { metas: [] };

    const match = id.match(/^davinotti_(.+)$/);
    if (!match) return { metas: [] };

    const feedKey = match[1];
    const skip = parseInt((extra && extra.skip) || 0, 10) || 0;
    const metas = await fetchFeedMetas(feedKey, reqHost);

    return {
      metas: metas.slice(skip, skip + 25),
      cacheMaxAge: 21600,
      staleRevalidate: 3600,
      staleError: 86400
    };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'movie') return { meta: null };

    const baseMeta = await findMetaById(id, config, reqHost);
    if (!baseMeta) {
      return {
        meta: {
          id,
          type: 'movie',
          name: 'Titolo non disponibile',
          poster: FALLBACK_POSTER,
          posterShape: 'poster',
          description: 'Dettagli non disponibili',
          genres: []
        }
      };
    }

    const davinottiLink = baseMeta.website || baseMeta.links?.[0]?.url || '';
    if (!davinottiLink) return { meta: baseMeta };

    const detailedMeta = await scrapeMovieDetail(davinottiLink, baseMeta);
    return { meta: detailedMeta };
  });

  return getRouter(builder.getInterface());
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(html);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(text);
}

function sendStaticFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    return sendText(res, 404, 'File non trovato');
  }

  res.writeHead(200, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*'
  });
  return fs.createReadStream(filePath).pipe(res);
}

function renderConfigureHtml(reqHost) {
  const preferred = ['configure.html', 'configure-2.html'];
  const fileName = preferred.find(name => fs.existsSync(path.join(__dirname, name))) || 'configure.html';
  let html = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
  const origin = getOrigin(reqHost);
  const manifestVersion = buildManifest({ feeds: DEFAULT_FEEDS }, reqHost).version;

  html = html.replaceAll('__BASE_URL__', origin);
  html = html.replaceAll('__ADDON_VERSION__', manifestVersion);

  return html;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    return res.end();
  }

  const host = req.headers.host || `localhost:${PORT}`;
  const protocol = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
  const reqHost = `${protocol}://${host}`;
  const url = new URL(req.url, reqHost);
  const pathname = url.pathname;

  if (pathname.startsWith('/poster/') && pathname.endsWith('.png')) {
    try {
      const rawId = pathname.replace('/poster/', '').replace(/\.png$/, '');
      const metaId = decodeURIComponent(rawId);

      let meta = metaCache.get(metaId);

      if (!meta && !missingMetaCache.get(metaId)) {
        meta = await findMetaById(metaId, { feeds: DEFAULT_FEEDS }, reqHost);

        if (!meta) {
          meta = await findMetaById(metaId, { feeds: Object.keys(GENRE_FEEDS) }, reqHost);
        }

        if (!meta) {
          missingMetaCache.set(metaId, true);
          return sendText(res, 404, 'Poster metadata non trovati');
        }
      }

      if (!meta) {
        return sendText(res, 404, 'Poster metadata non trovati');
      }

      const posterBuffer = await renderPosterWithRatings(meta);
      if (!posterBuffer) {
        return sendText(res, 404, 'Poster non disponibile');
      }

      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=21600',
        'Access-Control-Allow-Origin': '*'
      });

      return res.end(posterBuffer);
    } catch (err) {
      console.error('Errore route poster:', err);
      return sendText(res, 500, `Errore generazione poster: ${err.message}`);
    }
  }

  if (pathname === '/' || pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      name: 'davinotti-str-addon-xml',
      configure: `${getOrigin(reqHost)}/configure.html`,
      manifest: `${getOrigin(reqHost)}/manifest.json`
    });
  }

  if (pathname === '/davinotti-logo.png') {
    return sendStaticFile(res, path.join(__dirname, 'davinotti-logo.png'), 'image/png');
  }

  if (pathname === '/davinotti-logo.jpg' || pathname === '/davinotti-logo.jpeg') {
    const fileName = pathname.slice(1);
    return sendStaticFile(res, path.join(__dirname, fileName), 'image/jpeg');
  }

  if (pathname === '/davinotti-background.jpg' || pathname === '/davinotti-background.jpeg') {
    const fileName = pathname.slice(1);
    return sendStaticFile(res, path.join(__dirname, fileName), 'image/jpeg');
  }

  if (pathname === '/davinotti-background.png') {
    return sendStaticFile(res, path.join(__dirname, 'davinotti-background.png'), 'image/png');
  }

  if (pathname === '/configure' || pathname === '/configure.html') {
    try {
      return sendHtml(res, renderConfigureHtml(reqHost));
    } catch (err) {
      return sendText(res, 500, `Errore caricamento configure.html: ${err.message}`);
    }
  }

  if (pathname === '/manifest.json') {
    const router = buildRouterForConfig({ feeds: DEFAULT_FEEDS }, reqHost);
    return router(req, res, () => sendText(res, 404, 'Not found'));
  }

  const configManifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
  if (configManifestMatch) {
    const config = decodeConfigSegment(configManifestMatch[1]);
    const originalUrl = req.url;
    req.url = '/manifest.json';
    const router = buildRouterForConfig(config, reqHost);
    return router(req, res, () => {
      req.url = originalUrl;
      sendText(res, 404, 'Not found');
    });
  }

  const configCatalogMatch = pathname.match(/^\/([^/]+)\/catalog\/movie\/([^/]+)\.json$/);
  if (configCatalogMatch) {
    const config = decodeConfigSegment(configCatalogMatch[1]);
    const catalogId = configCatalogMatch[2];
    const skip = url.searchParams.get('skip');
    const query = skip ? `?skip=${encodeURIComponent(skip)}` : '';
    const rewritten = `/catalog/movie/${catalogId}.json${query}`;
    const originalUrl = req.url;
    req.url = rewritten;
    const router = buildRouterForConfig(config, reqHost);
    return router(req, res, () => {
      req.url = originalUrl;
      sendText(res, 404, 'Not found');
    });
  }

  const configMetaMatch = pathname.match(/^\/([^/]+)\/meta\/movie\/([^/]+)\.json$/);
  if (configMetaMatch) {
    const config = decodeConfigSegment(configMetaMatch[1]);
    const metaId = configMetaMatch[2];
    const rewritten = `/meta/movie/${metaId}.json`;
    const originalUrl = req.url;
    req.url = rewritten;
    const router = buildRouterForConfig(config, reqHost);
    return router(req, res, () => {
      req.url = originalUrl;
      sendText(res, 404, 'Not found');
    });
  }

  if (/^\/catalog\/movie\/([^/]+)\.json$/.test(pathname) || /^\/meta\/movie\/([^/]+)\.json$/.test(pathname)) {
    const router = buildRouterForConfig({ feeds: DEFAULT_FEEDS }, reqHost);
    return router(req, res, () => sendText(res, 404, 'Not found'));
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, () => {
  const localBase = getOrigin(`http://localhost:${PORT}`);
  const sampleConfig = encodeConfig({ feeds: ['commedia', 'netflix', 'fantascienza'] });
  const appVersion = buildManifest({ feeds: DEFAULT_FEEDS }, localBase).version;

  console.log('==========================================');
  console.log('Davinotti Stremio Addon XML avviato');
  console.log(`Versione: ${appVersion}`);
  console.log(`Porta: ${PORT}`);
  console.log(`Base URL: ${localBase}`);
  console.log(`Configure: ${localBase}/configure.html`);
  console.log(`Manifest default: ${localBase}/manifest.json`);
  console.log(`Manifest configurato: ${localBase}/${sampleConfig}/manifest.json`);
  console.log('TMDB API key:', TMDB_API_KEY ? 'CONFIGURATA' : 'NON CONFIGURATA');
  console.log('==========================================');
});
