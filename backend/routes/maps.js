//Fixed Zip Codes issues 
import { Router } from 'express';
import { runMapsScrape, abortRun } from '../services/apify-maps.js';

export const mapsRouter = Router();

// Map of lowercase country names / common aliases -> ISO 3166-1 alpha-2 code
const COUNTRY_NAME_TO_CODE = {
  'afghanistan': 'AF', 'albania': 'AL', 'algeria': 'DZ', 'andorra': 'AD',
  'angola': 'AO', 'antigua and barbuda': 'AG', 'argentina': 'AR', 'armenia': 'AM',
  'australia': 'AU', 'austria': 'AT', 'azerbaijan': 'AZ', 'bahamas': 'BS',
  'bahrain': 'BH', 'bangladesh': 'BD', 'barbados': 'BB', 'belarus': 'BY',
  'belgium': 'BE', 'belize': 'BZ', 'benin': 'BJ', 'bhutan': 'BT',
  'bolivia': 'BO', 'bosnia and herzegovina': 'BA', 'bosnia': 'BA',
  'botswana': 'BW', 'brazil': 'BR', 'brunei': 'BN', 'bulgaria': 'BG',
  'burkina faso': 'BF', 'burundi': 'BI', 'cambodia': 'KH', 'cameroon': 'CM',
  'canada': 'CA', 'cape verde': 'CV', 'central african republic': 'CF',
  'chad': 'TD', 'chile': 'CL', 'china': 'CN', 'colombia': 'CO',
  'comoros': 'KM', 'congo': 'CG', 'democratic republic of the congo': 'CD',
  'dr congo': 'CD', 'costa rica': 'CR', 'croatia': 'HR', 'cuba': 'CU',
  'cyprus': 'CY', 'czech republic': 'CZ', 'czechia': 'CZ', 'denmark': 'DK',
  'djibouti': 'DJ', 'dominica': 'DM', 'dominican republic': 'DO',
  'ecuador': 'EC', 'egypt': 'EG', 'el salvador': 'SV',
  'equatorial guinea': 'GQ', 'eritrea': 'ER', 'estonia': 'EE',
  'eswatini': 'SZ', 'swaziland': 'SZ', 'ethiopia': 'ET', 'fiji': 'FJ',
  'finland': 'FI', 'france': 'FR', 'gabon': 'GA', 'gambia': 'GM',
  'georgia': 'GE', 'germany': 'DE', 'ghana': 'GH', 'greece': 'GR',
  'grenada': 'GD', 'guatemala': 'GT', 'guinea': 'GN', 'guinea-bissau': 'GW',
  'guyana': 'GY', 'haiti': 'HT', 'honduras': 'HN', 'hungary': 'HU',
  'iceland': 'IS', 'india': 'IN', 'indonesia': 'ID', 'iran': 'IR',
  'iraq': 'IQ', 'ireland': 'IE', 'israel': 'IL', 'italy': 'IT',
  'ivory coast': 'CI', "cote d'ivoire": 'CI', 'jamaica': 'JM', 'japan': 'JP',
  'jordan': 'JO', 'kazakhstan': 'KZ', 'kenya': 'KE', 'kiribati': 'KI',
  'kosovo': 'XK', 'kuwait': 'KW', 'kyrgyzstan': 'KG', 'laos': 'LA',
  'latvia': 'LV', 'lebanon': 'LB', 'lesotho': 'LS', 'liberia': 'LR',
  'libya': 'LY', 'liechtenstein': 'LI', 'lithuania': 'LT',
  'luxembourg': 'LU', 'madagascar': 'MG', 'malawi': 'MW', 'malaysia': 'MY',
  'maldives': 'MV', 'mali': 'ML', 'malta': 'MT', 'marshall islands': 'MH',
  'mauritania': 'MR', 'mauritius': 'MU', 'mexico': 'MX',
  'micronesia': 'FM', 'moldova': 'MD', 'monaco': 'MC', 'mongolia': 'MN',
  'montenegro': 'ME', 'morocco': 'MA', 'mozambique': 'MZ', 'myanmar': 'MM',
  'burma': 'MM', 'namibia': 'NA', 'nauru': 'NR', 'nepal': 'NP',
  'netherlands': 'NL', 'new zealand': 'NZ', 'nicaragua': 'NI', 'niger': 'NE',
  'nigeria': 'NG', 'north korea': 'KP', 'north macedonia': 'MK',
  'macedonia': 'MK', 'norway': 'NO', 'oman': 'OM', 'pakistan': 'PK',
  'palau': 'PW', 'palestine': 'PS', 'panama': 'PA',
  'papua new guinea': 'PG', 'paraguay': 'PY', 'peru': 'PE',
  'philippines': 'PH', 'poland': 'PL', 'portugal': 'PT', 'qatar': 'QA',
  'romania': 'RO', 'russia': 'RU', 'rwanda': 'RW',
  'saint kitts and nevis': 'KN', 'saint lucia': 'LC',
  'saint vincent and the grenadines': 'VC', 'samoa': 'WS',
  'san marino': 'SM', 'sao tome and principe': 'ST', 'saudi arabia': 'SA',
  'senegal': 'SN', 'serbia': 'RS', 'seychelles': 'SC', 'sierra leone': 'SL',
  'singapore': 'SG', 'slovakia': 'SK', 'slovenia': 'SI',
  'solomon islands': 'SB', 'somalia': 'SO', 'south africa': 'ZA',
  'south korea': 'KR', 'korea': 'KR', 'south sudan': 'SS', 'spain': 'ES',
  'sri lanka': 'LK', 'sudan': 'SD', 'suriname': 'SR', 'sweden': 'SE',
  'switzerland': 'CH', 'syria': 'SY', 'taiwan': 'TW', 'tajikistan': 'TJ',
  'tanzania': 'TZ', 'thailand': 'TH', 'timor-leste': 'TL',
  'east timor': 'TL', 'togo': 'TG', 'tonga': 'TO',
  'trinidad and tobago': 'TT', 'tunisia': 'TN', 'turkey': 'TR',
  'turkmenistan': 'TM', 'tuvalu': 'TV', 'uganda': 'UG', 'ukraine': 'UA',
  'united arab emirates': 'AE', 'uae': 'AE', 'united kingdom': 'GB',
  'uk': 'GB', 'great britain': 'GB', 'england': 'GB',
  'united states': 'US', 'united states of america': 'US', 'usa': 'US',
  'us': 'US', 'america': 'US', 'uruguay': 'UY', 'uzbekistan': 'UZ',
  'vanuatu': 'VU', 'vatican city': 'VA', 'venezuela': 'VE',
  'vietnam': 'VN', 'yemen': 'YE', 'zambia': 'ZM', 'zimbabwe': 'ZW',
};

// In-flight scrape sessions keyed by the frontend's clientRunId.
// Lets POST /stop find and abort the Apify runs spawned by an
// /scrape SSE handler the HTTP layer can no longer reach directly.
const activeRuns = new Map(); // clientRunId -> { cancelled, apifyRunIds, apifyKey }

function send(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Socket may have closed between the check and the write — ignore.
  }
}

// ── Get country code from country name ────────────────────────────────
// ── Get country code from country name ────────────────────────────────
mapsRouter.get('/country-code', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Country name required' });

  const key = name.trim().toLowerCase();
  const code = COUNTRY_NAME_TO_CODE[key];

  if (!code) {
    return res.status(404).json({ error: `Country "${name}" not found — try a different spelling` });
  }

  res.json({ code, name: name.trim() });
});

// ── Get ZIP codes for city + country code ─────────────────────────────
mapsRouter.get('/zipcodes', async (req, res) => {
  const { city, countryCode } = req.query;
  if (!city || !countryCode) return res.status(400).json({ error: 'city and countryCode required' });

  try {
    // Step 1 — Get state/region from Nominatim
    const cityRes = await fetch(
      `https://nominatim.openstreetmap.org/search?` + new URLSearchParams({
        city,
        countrycode: countryCode.toLowerCase(),
        format: 'json',
        limit: 1,
        addressdetails: 1,
      }),
      { headers: { 'User-Agent': 'LeadGenApp/1.0' } }
    );

    const cityData = await cityRes.json();
    if (!cityData.length) return res.json({ zips: [], fallback: true });

    const address = cityData[0].address;

    // Get state code e.g. "US-WA" -> "WA"
    const stateCode = address['ISO3166-2-lvl4']?.split('-')[1];

    if (!stateCode) return res.json({ zips: [], fallback: true });

    // Step 2 — Use Zippopotam with state + city (works for US)
    const zipRes = await fetch(
      `https://api.zippopotam.us/${countryCode.toLowerCase()}/${stateCode.toLowerCase()}/${encodeURIComponent(city.toLowerCase())}`,
      { headers: { 'User-Agent': 'LeadGenApp/1.0' } }
    );

    if (!zipRes.ok) return res.json({ zips: [], fallback: true });

    const zipData = await zipRes.json();
    const zips = (zipData.places || []).map(p => p['post code']);

    if (!zips.length) return res.json({ zips: [], fallback: true });

    res.json({ zips, fallback: false });

  } catch (err) {
    res.json({ zips: [], fallback: true });
  }
});

// ── Run Google Maps scrape ────────────────────────────────────────────
//
// Async Apify pattern: start a run, poll status (streaming live progress
// back to the client via SSE), fetch the dataset on success. If the
// client disconnects, the in-flight Apify run is aborted so we don't
// burn credits on results no one will see.
mapsRouter.post('/scrape', async (req, res) => {
  const { searches, apifyKey, maxResults = 20, clientRunId } = req.body;

  if (!apifyKey) return res.status(400).json({ error: 'Apify API key required' });
  if (!searches?.length) return res.status(400).json({ error: 'No searches provided' });
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Register this run so POST /stop can find and abort it.
  const ctx = { cancelled: false, apifyRunIds: new Set(), apifyKey };
  activeRuns.set(clientRunId, ctx);

  // Detect real client disconnect via the RESPONSE stream — not `req`,
  // which fires `close` as soon as express.json() finishes reading the
  // body (before this handler runs), causing false cancellations.
  let completed = false;
  res.on('close', () => {
    if (!completed) ctx.cancelled = true;
  });

  const allLeads = [];

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write('event: keepalive\ndata: {}\n\n');
  }, 25000);

  try {
    send(res, 'start', { total: searches.length });

    for (let si = 0; si < searches.length; si++) {
      if (ctx.cancelled) break;

      const search = searches[si];
      const { business, city, countryCode, zips } = search;
      let cityLeadCount = 0;

      // Build search tasks — one per ZIP or just city if no ZIPs
      const tasks = zips?.length
        ? zips.map(zip => ({
            query: `${business} near ${zip}, ${city}, ${countryCode.toUpperCase()}`,
            zip,
          }))
        : [{ query: `${business} near ${city}, ${countryCode.toUpperCase()}`, zip: '' }];

      send(res, 'progress', {
        message: `Searching: ${business} in ${city}, ${countryCode.toUpperCase()} — ${tasks.length} ZIP(s)`,
        current: si + 1,
        total: searches.length,
      });

      for (const task of tasks) {
        if (ctx.cancelled) break;

        try {
          let result;
          try {
            result = await runMapsScrape(
              apifyKey,
              {
                searchStringsArray:        [task.query],
                maxCrawledPlacesPerSearch: maxResults,
                language:                  'en',
                countryCode:               countryCode.toLowerCase(),
              },
              {
                isCancelled: () => ctx.cancelled,
                onProgress: (update) => {
                  if (update.stage === 'started') {
                    ctx.apifyRunIds.add(update.runId);
                    send(res, 'progress', { message: `Started Apify run for "${task.query}" (id ${update.runId})` });
                  } else if (update.stage === 'running') {
                    send(res, 'progress', {
                      message: `Apify [${task.query}]: ${update.itemCount} places scraped — ${update.runtimeSecs}s elapsed (${update.status})`,
                      itemCount:   update.itemCount,
                      runtimeSecs: update.runtimeSecs,
                    });
                  } else if (update.stage === 'poll-error') {
                    send(res, 'warning', { message: `Apify poll error: ${update.message}` });
                  } else if (update.stage === 'done') {
                    ctx.apifyRunIds.delete(update.runId);
                    send(res, 'progress', { message: `Apify finished for "${task.query}" — ${update.itemCount} raw results in ${update.runtimeSecs}s` });
                  }
                },
              }
            );
          } catch (err) {
            // `Cancelled by client` is benign — fall through to outer loop break.
            if (ctx.cancelled) break;
            send(res, 'warning', { message: `Error for "${task.query}": ${err.message}` });
            continue;
          }

          const results = result.items || [];

          for (const d of results) {
            if (cityLeadCount >= maxResults) break;
            const email = d.email || d.emails?.[0] || '';
            const phone = d.phone || d.phoneNumber || d.phoneUnformatted || '';

            // Filter — must have email or phone
            if (!email && !phone) continue;

            const lead = {
              name:         d.title || d.name || '',
              address:      d.address || d.street || '',
              phone,
              email,
              rating:       d.totalScore || d.rating || '',
              website:      d.website || '',
              source:       d.url || d.googleMapsUrl || '',
              zipCode:      task.zip,
              country:      countryCode.toUpperCase(),
              city,
              businessType: business,
              createdAt:    new Date().toISOString(),
            };

            allLeads.push(lead);
            send(res, 'lead', lead);
            cityLeadCount++;
          }

          if (cityLeadCount >= maxResults) {
            send(res, 'progress', { message: `City limit reached for ${city} — ${cityLeadCount} leads` });
            break;
          }

          send(res, 'progress', {
            message: `Kept ${cityLeadCount} leads from "${task.query}" (filtered to those with phone or email). Total so far: ${allLeads.length}`,
          });

        } catch (err) {
          send(res, 'warning', { message: `Error for "${task.query}": ${err.message}` });
        }
      }
    }

    if (ctx.cancelled) {
      send(res, 'warning', { message: 'Scrape cancelled' });
    } else {
      send(res, 'complete', {
        totalLeads: allLeads.length,
        message: `Complete — ${allLeads.length} leads found`,
      });
    }

  } catch (err) {
    send(res, 'error', { message: err.message });
  } finally {
    clearInterval(heartbeat);
    completed = true;
    activeRuns.delete(clientRunId);
    res.end();
  }
});

// ── Stop an in-flight scrape ──────────────────────────────────────────
mapsRouter.post('/stop', async (req, res) => {
  const { clientRunId } = req.body || {};
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  const ctx = activeRuns.get(clientRunId);
  if (!ctx) return res.json({ ok: true, message: 'No active run' });

  ctx.cancelled = true;

  // Eagerly abort the Apify side so credits stop burning. The SSE
  // handler will also notice ctx.cancelled and bail out of its loop.
  const ids = [...ctx.apifyRunIds];
  await Promise.all(ids.map(id => abortRun(ctx.apifyKey, id)));

  res.json({ ok: true, aborted: ids.length });
});
