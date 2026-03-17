const http = require('http');
const fs = require('fs');
const path = require('path');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');

const PORT = process.env.PORT || 7000;
const BASE_URL = process.env.BASE_URL || '';
const cache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });

const GENRE_IDS = {
  action: '101',
  animazione: '103',
  avventura: '105',
  biografico: '208',
  commedia: '107',
  documentario: '111',
  drammatico: '113',
  fantascienza: '117',
  fantastico: '119',
  giallo: '123',
  guerra: '125',
  horror: '127',
  thriller: '143',
  western: '147'
};

const DEFAULT_GENRES = ['commedia', 'drammatico', 'thriller'];

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function decodeConfigSegment(segment) {
  if (!segment) return { genres: DEFAULT_GENRES };

  try {
    const normalized = decodeURIComponent(segment);
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const parsed = safeJsonParse(json, { genres: DEFAULT_GENRES });

    if (!parsed || !Array.isArray(parsed.genres) || parsed.genres.length === 0) {
      return { genres: DEFAULT_GENRES };
    }

    const validGenres = parsed.genres
      .map(g => String(g).trim().toLowerCase())
      .filter(g => GENRE_IDS[g]);

    return {
      genres: validGenres.length ? validGenres : DEFAULT_GENRES
    };
  } catch {
    return { genres: DEFAULT_GENRES };
  }
}

function encodeConfig(config) {
  return Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
}

function titleCase(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function buildManifest(config) {
  const genres = config.genres || DEFAULT_GENRES;

  return {
    id: 'community.davinotti.classifiche',
    version: '1.0.0',
    name: 'Davinotti Classifiche',
    description: 'Classifiche e migliori film per categoria da davinotti.com',
    resources: ['catalog'],
    types: ['movie'],
    idPrefixes: ['dv'],
    catalogs: genres.map(genre => ({
      type: 'movie',
      id: `davinotti_${genre}`,
      name: `Davinotti - ${titleCase(genre)}`,
      extra: [{ name: 'skip', isRequired: false }]
    })),
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };
}

function normalizeLink(link) {
  if (!link) return '';
  if (link.startsWith('http://') || link.startsWith('https://')) return link;
  return `https://www.davinotti.com${link}`;
}

async function scrapeGenreMovies(genre, skip = 0) {
  const cacheKey = `genre:${genre}:${skip}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const genreId = GENRE_IDS[genre];
  if (!genreId) return [];

  const url = `https://www.davinotti.com/film-per-genere/${genre}/${genreId}`;

  try {
    const response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DavinottiStremioAddon/1.0; +Render)'
      }
    });

    const $ = cheerio.load(response.data);
    const metas = [];
    const seen = new Set();

    $('a[href*="/film/"]').each((index, el) => {
      if (metas.length >= 100) return;

      const href = $(el).attr('href');
      const name = $(el).text().trim().replace(/\s+/g, ' ');

      if (!href || !name || name.length < 2) return;

      const match = href.match(/\/film\/[^/]+\/(\d+)/);
      const numericId = match ? match[1] : null;
      const metaId = numericId ? `dv${numericId}` : `dv_${genre}_${index}`;

      if (seen.has(metaId)) return;
      seen.add(metaId);

      metas.push({
        id: metaId,
        type: 'movie',
        name,
        poster: '',
        posterShape: 'poster',
        description: `Film della categoria ${genre} da davinotti.com`,
        genres: [genre],
        links: [
          {
            name: 'Scheda Davinotti',
            category: 'read',
            url: normalizeLink(href)
          }
        ]
      });
    });

    const sliced = metas.slice(skip, skip + 25);
    cache.set(cacheKey, sliced);
    return sliced;
  } catch (err) {
    console.error(`Errore scraping genere ${genre}:`, err.message);
    return [];
  }
}

function buildRouterForConfig(config) {
  const manifest = buildManifest(config);
  const builder = new addonBuilder(manifest);

  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    if (type !== 'movie') return { metas: [] };

    const match = id.match(/^davinotti_(.+)$/);
    if (!match) return { metas: [] };

    const genre = match[1];
    const skip = parseInt((extra && extra.skip) || 0, 10) || 0;
    const metas = await scrapeGenreMovies(genre, skip);

    return {
      metas,
      cacheMaxAge: 21600,
      staleRevalidate: 3600,
      staleError: 86400
    };
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
  const filePath = path.join(__dirname, 'configure.html');
  let html = fs.readFileSync(filePath, 'utf8');

  const origin = BASE_URL || reqHost;

  html = html.replace(
    '__BASE_URL__',
    origin.replace(/\/$/, '')
  );

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
      name: 'davinotti-str-addon',
      configure: `${reqHost}/configure.html`,
      manifest: `${reqHost}/manifest.json`
    });
  }

  if (pathname === '/configure' || pathname === '/configure.html') {
    try {
      const html = renderConfigureHtml(reqHost);
      return sendHtml(res, html);
    } catch (err) {
      return sendText(res, 500, `Errore caricamento configure.html: ${err.message}`);
    }
  }

  if (pathname === '/manifest.json') {
    const router = buildRouterForConfig({ genres: DEFAULT_GENRES });
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

  const plainCatalogMatch = pathname.match(/^\/catalog\/movie\/([^/]+)\.json$/);
  if (plainCatalogMatch) {
    const router = buildRouterForConfig({ genres: DEFAULT_GENRES });
    return router(req, res, () => sendText(res, 404, 'Not found'));
  }

  return sendText(res, 404, 'Not found');
});

server.listen(PORT, () => {
  const localBase = BASE_URL || `http://localhost:${PORT}`;
  const sampleConfig = encodeConfig({ genres: ['commedia', 'horror', 'western'] });

  console.log('==========================================');
  console.log('Davinotti Stremio Addon avviato');
  console.log(`Porta: ${PORT}`);
  console.log(`Base URL: ${localBase}`);
  console.log(`Configure: ${localBase}/configure.html`);
  console.log(`Manifest default: ${localBase}/manifest.json`);
  console.log(`Manifest configurato: ${localBase}/${sampleConfig}/manifest.json`);
  console.log('==========================================');
});
