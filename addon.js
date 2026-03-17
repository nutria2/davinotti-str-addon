// const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
// const { addonBuilder } = require("stremio-addon-sdk");
//const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
//const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
//console.log("Cosa contiene l'SDK:", Object.keys(stremio));

const stremio = require("stremio-addon-sdk");

// Dato che il log dice che 'stremio' è [Function: Addon]
// usiamo quella funzione direttamente come costruttore.
const addonBuilder = stremio; 

// Per la funzione serveHTTP, solitamente è attaccata alla funzione stessa
const serveHTTP = stremio.serveHTTP || require("stremio-addon-sdk/src/getRouter"); 

console.log("SDK caricato come funzione. Procedo...");
console.log("--- DEBUG SDK ---");
console.log("Contenuto:", Object.keys(sdk));
console.log("È una funzione?:", typeof sdk.addonBuilder);
console.log("-----------------");


const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const path = require('path');
const fs = require('fs');
const http = require('http');

// Cache per 6 ore
const cache = new NodeCache({ stdTTL: 21600 });

// Generi disponibili su davinotti.com
const AVAILABLE_GENRES = [
    'action', 'animali assassini', 'animazione', 'antologia', 'arti marziali',
    'avventura', 'biografico', 'comico', 'commedia', 'corto/mediometraggio',
    'documentario', 'drammatico', 'erotico', 'fantascienza', 'fantastico',
    'fiction', 'gangster/noir', 'giallo', 'guerra', 'horror', 'musicale',
    'peplum', 'poliziesco', 'sentimentale', 'spaghetti western', 'spionaggio',
    'teatro', 'thriller', 'western'
];

// Mappa generi a ID (da esplorare manualmente o via scraping)
const GENRE_IDS = {
    'action': '101',
    'animazione': '103',
    'avventura': '105',
    'biografico': '208',
    'commedia': '107',
    'documentario': '111',
    'drammatico': '113',
    'fantascienza': '117',
    'fantastico': '119',
    'giallo': '123',
    'guerra': '125',
    'horror': '127',
    'thriller': '143',
    'western': '147'
};

// Funzione per creare il manifest dinamico basato sulla configurazione
function createManifest(config = {}) {
    const selectedGenres = config.genres || ['commedia', 'drammatico', 'thriller'];

    const catalogs = selectedGenres.map(genre => ({
        type: 'movie',
        id: `davinotti_${genre.replace(/\s+/g, '_')}`,
        name: `Davinotti - ${genre.charAt(0).toUpperCase() + genre.slice(1)}`,
        extra: [{ name: 'skip', isRequired: false }]
    }));

    return {
        id: 'community.davinotti',
        version: '1.0.0',
        name: 'Davinotti Film',
        description: 'I migliori film dalle categorie di davinotti.com',
        resources: ['catalog'],
        types: ['movie'],
        catalogs: catalogs,
        idPrefixes: ['tt', 'dv'],
        behaviorHints: {
            configurable: true,
            configurationRequired: false
        }
    };
}

// Funzione di scraping per ottenere i film da una categoria
async function scrapeGenreMovies(genre, skip = 0) {
    const cacheKey = `genre_${genre}_${skip}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    try {
        const genreId = GENRE_IDS[genre];
        if (!genreId) {
            console.log(`Genere ${genre} non trovato nella mappa`);
            return [];
        }

        const url = `https://www.davinotti.com/film-per-genere/${genre}/${genreId}`;
        console.log(`Scraping URL: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        const movies = [];

        // Adatta i selettori alla struttura HTML di davinotti.com
        $('.film-item, .movie-item, article, .list-item').each((i, elem) => {
            if (i >= skip && movies.length < 100) {
                const $elem = $(elem);
                const title = $elem.find('h2, h3, .title, a').first().text().trim();
                const link = $elem.find('a').first().attr('href');
                const year = $elem.find('.year, .anno').text().trim() || '';

                if (title && link) {
                    // Estrai ID dal link
                    const match = link.match(/\/film\/[^\/]+\/(\d+)/);
                    const id = match ? `dv${match[1]}` : `dv${Date.now()}_${i}`;

                    movies.push({
                        id: id,
                        type: 'movie',
                        name: title,
                        year: year || undefined,
                        poster: undefined,
                        genres: [genre],
                        description: `Film dalla categoria ${genre} su davinotti.com`,
                        links: [{
                            name: 'Davinotti',
                            category: 'recensione',
                            url: `https://www.davinotti.com${link}`
                        }]
                    });
                }
            }
        });

        // Se non trova elementi con i selettori precedenti, prova un approccio alternativo
        if (movies.length === 0) {
            $('a[href*="/film/"]').each((i, elem) => {
                if (i >= skip && movies.length < 50) {
                    const $elem = $(elem);
                    const title = $elem.text().trim();
                    const link = $elem.attr('href');

                    if (title && link && title.length > 3) {
                        const match = link.match(/\/film\/[^\/]+\/(\d+)/);
                        const id = match ? `dv${match[1]}` : `dv${Date.now()}_${i}`;

                        movies.push({
                            id: id,
                            type: 'movie',
                            name: title,
                            genres: [genre],
                            description: `Film dalla categoria ${genre} su davinotti.com`,
                            links: [{
                                name: 'Davinotti',
                                category: 'recensione',
                                url: link.startsWith('http') ? link : `https://www.davinotti.com${link}`
                            }]
                        });
                    }
                }
            });
        }

        console.log(`Trovati ${movies.length} film per il genere ${genre}`);
        cache.set(cacheKey, movies);
        return movies;

    } catch (error) {
        console.error(`Errore nello scraping del genere ${genre}:`, error.message);
        return [];
    }
}

// Crea l'addon con configurazione base
//const builder = addonBuilder(createManifest());
const builder = new addonBuilder(createManifest());

//const builder = new stremio.addonBuilder(createManifest());

// Handler per i cataloghi
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`Richiesta catalogo: type=${type}, id=${id}`);

    if (type !== 'movie') {
        return { metas: [] };
    }

    // Estrai il genere dall'ID del catalogo
    const genreMatch = id.match(/^davinotti_(.+)$/);
    if (!genreMatch) {
        return { metas: [] };
    }

    const genre = genreMatch[1].replace(/_/g, ' ');
    const skip = parseInt(extra?.skip) || 0;

    const movies = await scrapeGenreMovies(genre, skip);

    return { 
        metas: movies,
        cacheMaxAge: 21600 // 6 ore
    };
});

// Avvia il server con gestione custom per la pagina di configurazione
const port = process.env.PORT || 7000;
const addonInterface = builder.getInterface();

// Server HTTP personalizzato
const server = http.createServer((req, res) => {
    // Gestione della pagina di configurazione
    if (req.url === '/configure' || req.url === '/configure.html') {
        const configPath = path.join(__dirname, 'configure.html');

        if (fs.existsSync(configPath)) {
            fs.readFile(configPath, 'utf8', (err, data) => {
                if (err) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Errore nel caricamento della pagina di configurazione');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            });
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Pagina di configurazione non trovata');
        }
        return;
    }

    // Gestione delle richieste dell'addon
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        addonInterface.get(req, (err, result) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message }));
                return;
            }

            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': '*'
            });
            res.end(JSON.stringify(result));
        });
    });
});

server.listen(port, () => {
    console.log('\n===========================================');
    console.log('🎬 Addon Davinotti in esecuzione!');
    console.log('===========================================');
    console.log(`📍 Server: http://localhost:${port}`);
    console.log(`⚙️  Configurazione: http://localhost:${port}/configure.html`);
    console.log(`📋 Manifest: http://localhost:${port}/manifest.json`);
    console.log('===========================================\n');
});
