# Stremio Davinotti Addon

Addon per Stremio che mostra i migliori film dalle categorie di [davinotti.com](https://www.davinotti.com).

## 🚀 Caratteristiche

- **Cataloghi personalizzabili**: Scegli i generi cinematografici che preferisci
- **Scraping automatico**: Recupera i film direttamente dal sito davinotti.com
- **Cache intelligente**: Le liste dei film vengono memorizzate per 6 ore per ottimizzare le prestazioni
- **Pagina di configurazione**: Interfaccia web intuitiva per selezionare i generi

## 📋 Prerequisiti

- Node.js (versione 14 o superiore)
- npm o yarn

## 🔧 Installazione

### 1. Clona o scarica il progetto

```bash
git clone <repository-url>
cd stremio-davinotti-addon
```

### 2. Installa le dipendenze

```bash
npm install
```

### 3. Avvia l'addon

```bash
npm start
```

L'addon sarà in esecuzione su `http://localhost:7000`

## 🎬 Utilizzo

### Configurazione

1. Apri nel browser: `http://localhost:7000/configure/configure.html`
2. Seleziona i generi cinematografici che ti interessano
3. Clicca su "Genera URL di installazione"
4. Copia l'URL generato

### Installazione in Stremio

1. Apri Stremio
2. Vai su **Addons** → **Community Addons**
3. Clicca su **Install from URL** (icona matita in alto a destra)
4. Incolla l'URL copiato
5. Clicca **Install**

## 🎯 Generi Disponibili

- Action
- Animazione
- Avventura
- Biografico
- Commedia
- Documentario
- Drammatico
- Fantascienza
- Fantastico
- Giallo
- Guerra
- Horror
- Thriller
- Western

## 🔍 Come Funziona

### Architettura

L'addon utilizza:
- **Stremio Addon SDK**: Framework ufficiale per creare addon Stremio
- **Axios**: Per effettuare richieste HTTP al sito davinotti.com
- **Cheerio**: Per il parsing e scraping dell'HTML
- **NodeCache**: Per memorizzare in cache i risultati e ridurre le richieste

### Flusso di Lavoro

1. **Configurazione**: L'utente seleziona i generi dalla pagina web
2. **Generazione Manifest**: Viene creato un manifest dinamico con i cataloghi selezionati
3. **Scraping**: Quando richiesto, l'addon scrapa le pagine del genere su davinotti.com
4. **Parsing**: Estrae titolo, anno, link delle recensioni
5. **Cache**: Memorizza i risultati per 6 ore
6. **Delivery**: Fornisce i dati a Stremio in formato JSON

### Struttura Dati

Ogni film viene rappresentato con:
- `id`: Identificativo univoco (formato: dv + ID da davinotti)
- `type`: "movie"
- `name`: Titolo del film
- `year`: Anno di uscita (quando disponibile)
- `genres`: Array con il genere
- `description`: Breve descrizione
- `links`: Link alla recensione su davinotti.com

## ⚙️ Configurazione Avanzata

### Variabili d'Ambiente

Puoi configurare la porta modificando la variabile d'ambiente `PORT`:

```bash
PORT=8080 npm start
```

### Aggiungere Nuovi Generi

Per aggiungere un nuovo genere, modifica l'oggetto `GENRE_IDS` in `addon.js`:

```javascript
const GENRE_IDS = {
    'nuovo_genere': 'ID_NUMERICO',
    // ...
};
```

Trova l'ID visitando la pagina del genere su davinotti.com e analizzando l'URL.

### Modificare la Durata della Cache

Nel file `addon.js`, modifica il valore `stdTTL` (in secondi):

```javascript
const cache = new NodeCache({ stdTTL: 21600 }); // 6 ore = 21600 secondi
```

## 🐛 Troubleshooting

### L'addon non trova film

- Verifica che davinotti.com sia raggiungibile
- Controlla i log della console per errori di scraping
- Assicurati che gli ID dei generi siano corretti
- Il sito potrebbe aver cambiato struttura HTML (aggiorna i selettori CSS)

### Stremio non carica l'addon

- Verifica che l'addon sia in esecuzione su localhost:7000
- Controlla che l'URL di installazione sia corretto
- Prova a reinstallare l'addon
- Verifica i log di Stremio (Help → Logs)

### Cache non funziona

- Riavvia l'addon per pulire la cache
- Verifica che node-cache sia installato correttamente

## 📝 Note Tecniche

### Selettori CSS

L'addon utilizza diversi selettori CSS per adattarsi alla struttura di davinotti.com:
- `.film-item, .movie-item, article, .list-item` per i contenitori principali
- `h2, h3, .title` per i titoli
- `.year, .anno` per l'anno

Se il sito cambia struttura, aggiorna questi selettori.

### Rate Limiting

L'addon implementa un sistema di cache per evitare troppe richieste a davinotti.com. 
La cache è impostata a 6 ore per bilanciare freschezza dei dati e carico sul server.

### Conformità

Questo addon è stato creato per scopi educativi. Assicurati di rispettare i termini di servizio 
di davinotti.com quando usi questo addon. Considera di contattare i gestori del sito per 
verificare se offrono API ufficiali.

## 📜 Licenza

MIT License - Sentiti libero di modificare e distribuire

## 🤝 Contributi

Contributi, issues e feature requests sono benvenuti!

## 📧 Supporto

Per problemi o domande, apri una issue nel repository.

## 🔗 Link Utili

- [Documentazione Stremio Addon SDK](https://github.com/Stremio/stremio-addon-sdk)
- [Guida ufficiale Stremio](https://stremio.github.io/stremio-addon-guide/)
- [Davinotti.com](https://www.davinotti.com)
