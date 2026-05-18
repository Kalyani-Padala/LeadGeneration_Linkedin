import { Router } from 'express';
import { runMapsScrape, abortRun } from '../services/apify-maps.js';

export const mapsRouter = Router();

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
mapsRouter.get('/country-code', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Country name required' });

  try {
    const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(name.trim())}?fields=cca2,name`;
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || !Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: `Country "${name}" not found — try a different spelling` });
    }

    const country = data[0];
    res.json({ code: country.cca2, name: country.name.common });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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