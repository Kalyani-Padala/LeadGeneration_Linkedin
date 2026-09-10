import { Router } from 'express';
import { searchCompanies, enrichCompany } from '../services/apollo.js';
import { findDecisionMakers } from '../services/apify.js';

export const outreachRouter = Router();

// In-flight discovery / enrichment sessions keyed by clientRunId.
// Lets POST /stop find and abort whichever flow the user is running.
const activeRuns = new Map();

// Apollo's `q_organization_keyword_tags` is fuzzy — it matches against
// company tags and marketing copy, not Apollo's industry taxonomy. So
// sending "Retail" pulls in companies that *talk about* retail (WSJ,
// Bloomberg, recruiters for retail, etc.), not just retailers.
//
// The proper fix is `organization_industry_tag_ids` with Apollo's
// internal MongoDB IDs, but we don't have a verified mapping and
// guessing IDs silently returns zero. As a reliable workaround, we
// post-filter Apollo's results against `company.industry` (the actual
// industry classification visible in the UI).
//
// Each user-facing industry name expands to a list of Apollo synonyms;
// a company is kept if its industry contains ANY of those substrings.
const INDUSTRY_SYNONYMS = {
  'Retail':                   ['retail'],
  'Manufacturing':            ['manufacturing'],
  'Healthcare':               ['hospital', 'health care', 'healthcare', 'medical'],
  'Pharmaceuticals':          ['pharmaceutical', 'biotech'],
  'Financial Services':       ['financial services', 'capital markets', 'investment'],
  'Banking':                  ['banking', 'bank'],
  'Insurance':                ['insurance'],
  'Information Technology':   ['information technology', 'computer software', 'internet', 'computer services', 'it services'],
  'Software':                 ['software', 'saas'],
  'Telecommunications':       ['telecommunications', 'telecom', 'wireless'],
  'Marketing & Advertising':  ['marketing', 'advertising'],
  'Media':                    ['media', 'broadcasting', 'publishing', 'entertainment', 'newspapers'],
  'Real Estate':              ['real estate', 'commercial real estate'],
  'Construction':             ['construction', 'civil engineering'],
  'Education':                ['education', 'e-learning', 'higher education', 'primary/secondary education'],
  'Hospitality':              ['hospitality', 'hotels', 'leisure', 'travel'],
  'Restaurants':              ['restaurants', 'food & beverages', 'food production'],
  'Logistics & Supply Chain': ['logistics', 'supply chain', 'transportation', 'shipping', 'warehousing'],
  'Energy & Utilities':       ['energy', 'oil & energy', 'utilities', 'renewables', 'mining'],
  'Consumer Goods':           ['consumer goods', 'consumer electronics', 'apparel', 'cosmetics'],
  'Automotive':               ['automotive'],
  'Aerospace & Defense':      ['aerospace', 'defense', 'aviation'],
  'Legal Services':           ['legal', 'law practice'],
  'Professional Services':    ['professional services', 'management consulting', 'consulting'],
  'Government':               ['government', 'public policy', 'military'],
  'Non-profit':               ['non-profit', 'nonprofit', 'civic', 'philanthropy'],
  'Agriculture':              ['agriculture', 'farming', 'dairy'],
  'Wholesale':                ['wholesale'],
};

function matchesSelectedIndustries(companyIndustry, selectedIndustries) {
  if (!selectedIndustries?.length) return true;
  const ci = (companyIndustry || '').toLowerCase().trim();
  if (!ci) return false;
  for (const name of selectedIndustries) {
    const synonyms = INDUSTRY_SYNONYMS[name] || [name.toLowerCase()];
    if (synonyms.some(s => ci.includes(s))) return true;
  }
  return false;
}

function send(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Socket may have closed between the check and the write — ignore.
  }
}

function setupRun(req, res, clientRunId) {
  const controller = new AbortController();
  const ctx = { cancelled: false, controller };
  activeRuns.set(clientRunId, ctx);

  let completed = false;
  res.on('close', () => {
    if (!completed) {
      ctx.cancelled = true;
      controller.abort();
    }
  });

  return {
    ctx,
    signal: controller.signal,
    finish() { completed = true; activeRuns.delete(clientRunId); res.end(); },
  };
}

// ── FLOW 1: Company Discovery ─────────────────────────────────────────
//
// Deterministic Apollo search — no AI in this flow. Every company that
// matches the user's filters is streamed back. No scoring, no triage.
//
// Why no AI: an earlier version extracted keywords from a free-text
// "target audience" via the LLM, which hallucinated criteria not in the
// input and produced false matches. With structured filters there is
// nothing left for AI to do at this stage.
outreachRouter.post('/discover', async (req, res) => {
  const {
    apolloKey: frontendApolloKey,
    industries = [],
    technologies = [],
    targetLocations,
    employeeRanges,
    clientRunId,
  } = req.body;
  const apolloKey = frontendApolloKey || process.env.APOLLO_KEY;
  if (!apolloKey) return res.status(400).json({ error: 'Missing apolloKey' });
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });
  if (!industries.length && !technologies.length && !targetLocations?.length) {
    return res.status(400).json({ error: 'Pick at least one filter (industry, technology, or location)' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const run = setupRun(req, res, clientRunId);
  const { ctx, signal } = run;

  // Apollo's `organization_locations` expects an array of location strings;
  // accept either an array or a comma-separated string for backwards-compat.
  const locationsArr = Array.isArray(targetLocations)
    ? targetLocations
    : (targetLocations || '').split(',').map(s => s.trim()).filter(Boolean);

  try {
    send(res, 'progress', {
      message: `Searching Apollo — industries: [${industries.join(', ') || '—'}], tech: [${technologies.join(', ') || '—'}], locations: [${locationsArr.join(', ') || '—'}], sizes: [${(employeeRanges || []).join(', ') || '—'}]`,
    });

    const searchResult = await searchCompanies({
      industries,
      technologies,
      locations:      locationsArr,
      employeeRanges: employeeRanges || [],
      perPage:        50,
    }, apolloKey, signal);

    const rawCompanies = searchResult?.organizations || [];
    send(res, 'progress', { message: `Apollo returned ${rawCompanies.length} companies` });

    // Post-filter against Apollo's industry field. See INDUSTRY_SYNONYMS
    // comment for why — Apollo's keyword-tag search matches marketing
    // copy, so without this we'd surface WSJ for "Retail" etc.
    const industryFiltered = rawCompanies.filter(c => matchesSelectedIndustries(c.industry, industries));
    if (industries.length) {
      send(res, 'progress', {
        message: `Filtered to ${industryFiltered.length} companies actually classified in: ${industries.join(', ')}`,
      });
    }

    // Keep only companies with at least a domain we can later use for
    // Hunter contact lookup.
    const filtered = industryFiltered
      .filter(c => c.primary_domain || c.website_url)
      .map(c => ({
        ...c,
        primary_domain: c.primary_domain
          || c.website_url?.replace('https://', '').replace('http://', '').replace('www.', '').split('/')[0],
      }));

    send(res, 'progress', { message: `${filtered.length} companies have a domain — enriching…` });

    const seenIds = new Set();
    for (const company of filtered) {
      if (ctx.cancelled) break;
      if (seenIds.has(company.id)) continue;
      seenIds.add(company.id);

      send(res, 'progress', { message: `Enriching: ${company.name}` });
      let enriched = company;
      try {
        const enrichResult = await enrichCompany(company.primary_domain, apolloKey, signal);
        enriched = { ...company, ...enrichResult?.organization };
      } catch (err) {
        if (ctx.cancelled) break;
        // Enrichment is best-effort; we still emit the company with the
        // search-level data so the rep can see it.
      }

      send(res, 'company', {
        id:           enriched.id,
        name:         enriched.name,
        domain:       enriched.primary_domain,
        website:      enriched.website_url || '',
        linkedin:     enriched.linkedin_url || '',
        industry:     enriched.industry || '',
        employees:    enriched.estimated_num_employees || enriched.num_employees || 0,
        location:     enriched.city && enriched.state
                        ? `${enriched.city}, ${enriched.state}`
                        : enriched.state || enriched.country || '',
        description:  enriched.short_description || enriched.description || '',
        technologies: enriched.current_technologies || enriched.technology_names || [],
        state:        'qualified',
      });
    }

    if (ctx.cancelled) {
      send(res, 'warning', { message: 'Discovery cancelled' });
    } else {
      send(res, 'complete', { message: 'Company discovery complete' });
    }

  } catch (err) {
    if (ctx.cancelled) {
      send(res, 'warning', { message: 'Discovery cancelled' });
    } else {
      send(res, 'error', { message: err.message });
    }
  } finally {
    run.finish();
  }
});

// ── FLOW 2: Contact Finding ───────────────────────────────────────────
outreachRouter.post('/enrich', async (req, res) => {
 const { hunterKey: frontendHunterKey, companies, clientRunId } = req.body;
  const hunterKey = frontendHunterKey || process.env.HUNTER_KEY;
  if (!hunterKey || !companies?.length) {
    return res.status(400).json({ error: 'Missing hunterKey or companies' });
  }
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const run = setupRun(req, res, clientRunId);
  const { ctx, signal } = run;

  try {
    for (const company of companies) {
      if (ctx.cancelled) break;
      send(res, 'progress', { message: `Finding decision makers at ${company.name}...` });

      if (!company.domain || company.domain.includes(' ') || company.domain.includes(',')) {
        send(res, 'warning', { message: `Skipping ${company.name} — no valid domain` });
        continue;
      }

      let contacts = [];
      try {
        contacts = await findDecisionMakers(company.domain, hunterKey, signal);
      } catch (err) {
        if (ctx.cancelled) break;
        send(res, 'warning', { message: `Hunter failed for ${company.name}: ${err.message}` });
        continue;
      }

      if (!contacts?.length) {
        send(res, 'warning', { message: `No contacts found at ${company.name}` });
        continue;
      }

      for (const contact of contacts.slice(0, 5)) {
        // Skip if no email
        if (!contact.email) continue;

        send(res, 'lead', {
          // Person info from Hunter
          firstName:    contact.first_name,
          lastName:     contact.last_name,
          title:        contact.title || '',
          seniority:    contact.seniority || '',
          department:   contact.department || '',
          email:        contact.email,
          confidence:   contact.confidence || 0,
          linkedin:     contact.linkedin_url || '',

          // Company info from Apollo
          companyName:     company.name,
          companyDomain:   company.domain,
          companyIndustry: company.industry || '',
          companyLocation: company.location || '',
          companyScore:    company.score,
        });
      }
    }

    if (ctx.cancelled) {
      send(res, 'warning', { message: 'Enrichment cancelled' });
    } else {
      send(res, 'complete', { message: 'Contact finding complete' });
    }

  } catch (err) {
    if (ctx.cancelled) {
      send(res, 'warning', { message: 'Enrichment cancelled' });
    } else {
      send(res, 'error', { message: err.message });
    }
  } finally {
    run.finish();
  }
});

// ── Stop an in-flight discovery / enrichment ──────────────────────────
outreachRouter.post('/stop', (req, res) => {
  const { clientRunId } = req.body || {};
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  const ctx = activeRuns.get(clientRunId);
  if (!ctx) return res.json({ ok: true, message: 'No active run' });

  ctx.cancelled = true;
  ctx.controller.abort();
  res.json({ ok: true });
});
