const http = require('http');
const fs = require('fs');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const cache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });
const metaCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });
const DAVINOTTI_SUFFIX = ' (fonte DAVINOTTI.COM)';
const FALLBACK_POSTER = 'https://placehold.co/300x450?text=Davinotti';

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

const DEFAULT_FEEDS = ['commedia', 'drammatico', 'thriller'];

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

/* OLD
function buildManifest(config) {
  const feeds = config.feeds || DEFAULT_FEEDS;

  return {
    id: 'community.davinotti.classifiche.xml',
    version: '2.5.1',
    name: 'Davinotti Classifiche',
    description: 'Cataloghi Davinotti per generi e piattaforme streaming',
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
} */

function buildManifest(config) {
  const feeds = config.feeds || DEFAULT_FEEDS;

  return {
    id: 'community.davinotti.classifiche.xml',
    version: '2.5.5',
    name: 'Davinotti Classifiche',
    description: 'Cataloghi Davinotti per generi e piattaforme streaming',
    logo: `${BASE_URL || ''}/davinotti-logo.png`,
    background: `${BASE_URL || ''}/davinotti-background.jpg`,
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


async function fetchTmdbMovieById(tmdbId) {
  if (!TMDB_API_KEY || !tmdbId) return null;

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}`, {
      timeout: 15000,
      params: {
        api_key: TMDB_API_KEY,
        language: 'it-IT'
      }
    });
    return response.data || null;
  } catch (err) {
    console.error(`Errore TMDB movie/${tmdbId}:`, err.message);
    return null;
  }
}

function parseXmlItems(xml) {
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
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
  return cheerio.load(`<root>${match[1]}</root>`, { xmlMode: true }).text().trim();
}

function mapXmlItemToMeta(itemXml, feedKey) {
  const feed = GENRE_FEEDS[feedKey];

  const title = extractXmlValue(itemXml, 't');
  const year = extractXmlValue(itemXml, 'y');
  const category = extractXmlValue(itemXml, 'c');
  const dvIdRaw = extractXmlValue(itemXml, 'id');
  const imdbIdRaw = extractXmlValue(itemXml, 'i_id');
  const tmdbIdRaw = extractXmlValue(itemXml, 't_id');
  const link = extractXmlValue(itemXml, 'l');
  const votes = extractXmlValue(itemXml, 'v');
  const reviews = extractXmlValue(itemXml, 'vc');

  const imdbId = imdbIdRaw && imdbIdRaw.startsWith('tt') ? imdbIdRaw : '';
  const tmdbId = tmdbIdRaw && /^\d+$/.test(tmdbIdRaw) ? tmdbIdRaw : '';
  const davinottiId = dvIdRaw ? `dv${dvIdRaw}` : '';
  const finalId = imdbId || davinottiId;

  if (!title || !finalId || !link) {
    console.log('ITEM SCARTATO DETTAGLIO', {
      title,
      dvIdRaw,
      imdbIdRaw,
      tmdbIdRaw,
      finalId,
      link
    });
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
    feedKey,
    feedName: feed.name
  };
}


async function enrichPreviewWithTmdb(meta) {
  if (!meta || !meta.tmdbId) return meta;
  const tmdbData = await fetchTmdbMovieById(meta.tmdbId);
  if (!tmdbData) return meta;

  return {
    ...meta,
    poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : meta.poster,
    background: tmdbData.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}` : meta.background,
    description: meta.description,
    releaseInfo: meta.releaseInfo || tmdbData.release_date || '',
    imdbRating: tmdbData.vote_average ? String(tmdbData.vote_average) : undefined
  };
}

async function fetchFeedMetas(feedKey) {
  const cacheKey = `feed:${feedKey}`;
  const cached = cache.get(cacheKey);
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
    const metas = [];
    const seen = new Set();
	
	
	console.log('FEED KEY:', feedKey);
console.log('FEED URL:', url);
console.log('XML LENGTH:', typeof xml === 'string' ? xml.length : 0);
console.log('ITEMS PARSED:', items.length);


    for (const itemXml of items) {
      const baseMeta = mapXmlItemToMeta(itemXml, feedKey);
	  if (!baseMeta) {
		  console.log('ITEM SCARTATO');
		  continue;
		}
      if (!baseMeta || seen.has(baseMeta.id)) continue;
      seen.add(baseMeta.id);
      const enriched = await enrichPreviewWithTmdb(baseMeta);
      metas.push(enriched);
      metaCache.set(enriched.id, enriched);
      if (enriched.davinottiId) metaCache.set(enriched.davinottiId, enriched);
	  //console.log('FIRST ITEM TITLE:', items[0] ? extractXmlValue(items[0], 'title') : 'nessuno');
    }

    cache.set(cacheKey, metas);

    
	return metas;
  } catch (err) {
    //console.error(`Errore feed XML ${feedKey}:`, err.message);
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
    const poster = tmdbData?.poster_path
      ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
      : (baseMeta.poster || FALLBACK_POSTER);
    const background = tmdbData?.backdrop_path
      ? `https://image.tmdb.org/t/p/original${tmdbData.backdrop_path}`
      : baseMeta.background;

    const detailed = {
      ...baseMeta,
      name: pageTitle,
      poster,
      background,
      description: withDavinottiSource(description || baseMeta.description),
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

async function findMetaById(id, config) {
  const cached = metaCache.get(id);
  if (cached) return cached;

  const feeds = config.feeds && config.feeds.length ? config.feeds : DEFAULT_FEEDS;
  for (const feedKey of feeds) {
    const metas = await fetchFeedMetas(feedKey);
    const found = metas.find(item => item.id === id || item.davinottiId === id || item.imdbId === id);
    if (found) {
      metaCache.set(id, found);
      return found;
    }
  }

  return null;
}



function buildRouterForConfig(config) {
  const manifest = buildManifest(config);
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'movie') return { metas: [] };
    const match = id.match(/^davinotti_(.+)$/);
    if (!match) return { metas: [] };

    const feedKey = match[1];
    const skip = parseInt((extra && extra.skip) || 0, 10) || 0;
    const metas = await fetchFeedMetas(feedKey);

    return {
      metas: metas.slice(skip, skip + 25),
      cacheMaxAge: 21600,
      staleRevalidate: 3600,
      staleError: 86400
    };
  });

  builder.defineMetaHandler(async ({ type, id }) => {
    if (type !== 'movie') return { meta: null };

    const baseMeta = await findMetaById(id, config);
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

    const davinottiLink = baseMeta.website || (baseMeta.links && baseMeta.links[0] ? baseMeta.links[0].url : '');
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

function renderConfigureHtml(reqHost) {
	// ritorna i valori alla pagina di configurazione
  const preferred = ['configure.html', 'configure-2.html'];
  const fileName = preferred.find(name => fs.existsSync(path.join(__dirname, name))) || 'configure.html';
  let html = fs.readFileSync(path.join(__dirname, fileName), 'utf8');
  const origin = BASE_URL || reqHost;
  const manifestVersion = buildManifest({ feeds: DEFAULT_FEEDS }).version;

  html = html.replaceAll('__BASE_URL__', origin.replace(/\/$/, ''));
  html = html.replaceAll('__ADDON_VERSION__', manifestVersion);

  return html;
}

const server = http.createServer((req, res) => {
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

  if (pathname === '/' || pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      name: 'davinotti-str-addon-xml',
      configure: `${reqHost}/configure.html`,
      manifest: `${reqHost}/manifest.json`
    });
  }

	if (pathname === '/davinotti-logo.png') {
	  const logoPath = path.join(__dirname, 'davinotti-logo.png');
	  if (fs.existsSync(logoPath)) {
		res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
		return fs.createReadStream(logoPath).pipe(res);
	  }
	  return sendText(res, 404, 'Logo non trovato');
	}


  if (pathname === '/configure' || pathname === '/configure.html') {
    try {
      return sendHtml(res, renderConfigureHtml(reqHost));
    } catch (err) {
      return sendText(res, 500, `Errore caricamento configure.html: ${err.message}`);
    }
  }

  if (pathname === '/manifest.json') {
    const router = buildRouterForConfig({ feeds: DEFAULT_FEEDS });
    return router(req, res, () => sendText(res, 404, 'Not found'));
  }

  const configManifestMatch = pathname.match(/^\/([^/]+)\/manifest\.json$/);
  if (configManifestMatch) {
    const config = decodeConfigSegment(configManifestMatch[1]);
    const originalUrl = req.url;
    req.url = '/manifest.json';
    const router = buildRouterForConfig(config);
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
    const router = buildRouterForConfig(config);
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
    const router = buildRouterForConfig(config);
    return router(req, res, () => {
      req.url = originalUrl;
      sendText(res, 404, 'Not found');
    });
  }

  if (/^\/catalog\/movie\/([^/]+)\.json$/.test(pathname) || /^\/meta\/movie\/([^/]+)\.json$/.test(pathname)) {
    const router = buildRouterForConfig({ feeds: DEFAULT_FEEDS });
    return router(req, res, () => sendText(res, 404, 'Not found'));
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, () => {
  const localBase = BASE_URL || `http://localhost:${PORT}`;
  const sampleConfig = encodeConfig({ feeds: ['commedia', 'netflix', 'thriller'] });
  console.log('==========================================');
  console.log('Davinotti Stremio Addon XML avviato');
  console.log(`Porta: ${PORT}`);
  console.log(`Base URL: ${localBase}`);
  console.log(`Configure: ${localBase}/configure.html`);
  console.log(`Manifest default: ${localBase}/manifest.json`);
  console.log(`Manifest configurato: ${localBase}/${sampleConfig}/manifest.json`);
  console.log('TMDB API key:', TMDB_API_KEY ? 'CONFIGURATA' : 'NON CONFIGURATA');
  console.log('==========================================');
});
