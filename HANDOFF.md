# Session Handoff — LeadGeneration_Linkedin

Working branch: `claude/review-repo-improvements-OZNzR` (PR #1 against `main`).

This document captures everything done in one Claude Code session so another LLM (or human) can pick up the work with full context. Read top-to-bottom.

> **Keep this file current.** The user has standing instructions to update this doc after every meaningful change. When you make a commit on this branch, also: add a row to the commit table (§3), update the affected flow's "current state" (§4), update deferred work (§5) if you closed an item or discovered a new one, and bump anything in §6–§7 if a user preference or gotcha changed.

---

## 1. What the app is

A full-stack Node + React app that replicates a B2B lead-generation n8n workflow. It has **three independent lead-gen flows** the sales team can pick from:

| Flow      | Source                         | Strength                        | Output                              |
| --------- | ------------------------------ | ------------------------------- | ----------------------------------- |
| LinkedIn  | ConnectSafely API + Azure OpenAI | High-intent (comment-based)     | Qualified individuals with score    |
| Apollo    | Apollo + Hunter.io             | ICP-driven, deterministic       | Filtered companies → decision-maker emails |
| Maps      | Apify Google Maps scraper      | Local-business cold lists       | Businesses with phone/email         |

> Apollo flow no longer uses AI in discovery — see commit `0988b66`. The LinkedIn flow still uses Azure OpenAI for the Round 1 / Round 2 screening.

**Stack**
- Backend: Node 18+ (`type: "module"`), Express 5, `openai` SDK (Azure deployment), `xlsx` for export.
- Frontend: React 19 + Vite, `react-router-dom`, all state in a single `SettingsContext` + `localStorage`, all styling inline.
- Streaming: SSE (Server-Sent Events) from `/run` / `/scrape` / `/discover` / `/enrich` endpoints, consumed by `fetch().body.getReader()` in the frontend.

**Directory layout**
```
backend/
  server.js                 Express bootstrap, CORS, route mounting
  routes/
    pipeline.js             LinkedIn flow (SSE)
    outreach.js             Apollo + Hunter flow (SSE)
    maps.js                 Google Maps flow (SSE)
    linkedin-summary.js     PhantomBuster + AI summary (single profile)
    export.js               XLSX export
  services/
    azureopenai.js          Azure OpenAI calls — screenComments, deepQualify, generateSummary
    apollo.js               Apollo company search / enrich / people-match
    apify.js                Hunter.io decision-maker lookup (badly named)
    apify-maps.js           Apify Google Maps scraper (async + abort)
    connectsafely.js        LinkedIn data via ConnectSafely
    groq.js                 Cold-email AI generation (also Azure OpenAI despite the name)
    phantombuster.js        Profile activity scraping
frontend/
  src/
    App.jsx                 Sidebar + Routes
    main.jsx                Bootstrap
    context/SettingsContext.jsx   ALL app state (settings + run state)
    pages/
      LinkedIn.jsx          LinkedIn pipeline UI
      Outreach.jsx          Apollo flow UI
      maps.jsx              Maps flow UI
      settings.jsx          API keys + per-flow config
      HowItWorks.jsx        NEW — sales-facing reference for all 3 flows
    components/SummaryPanel.jsx
```

---

## 2. Architecture conventions established this session

All three lead-gen flows now share the **same backend cancellation pattern**. If you add a new flow, use this pattern:

### Backend SSE handler pattern
```js
const activeRuns = new Map();  // clientRunId -> { cancelled, controller, ... }

function send(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
}

router.post('/run', async (req, res) => {
  const { clientRunId, /* ... */ } = req.body;
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const controller = new AbortController();
  const ctx = { cancelled: false, controller };
  activeRuns.set(clientRunId, ctx);

  let completed = false;
  // res.on('close') — NOT req.on('close'). req fires close as soon as
  // express.json() finishes consuming the body, causing a false instant
  // cancellation. res only fires on real client disconnect.
  res.on('close', () => {
    if (!completed) { ctx.cancelled = true; controller.abort(); }
  });

  try {
    // ... loop work, check ctx.cancelled between batches ...
    // Thread controller.signal into EVERY external API call.
    if (ctx.cancelled) {
      send(res, 'warning', { message: '<Flow> cancelled' });
    } else {
      send(res, 'complete', { /* ... */ });
    }
  } catch (err) {
    if (ctx.cancelled) send(res, 'warning', { message: '<Flow> cancelled' });
    else                send(res, 'error',   { message: err.message });
  } finally {
    completed = true;
    activeRuns.delete(clientRunId);
    res.end();
  }
});

router.post('/stop', (req, res) => {
  const ctx = activeRuns.get(req.body.clientRunId);
  if (!ctx) return res.json({ ok: true, message: 'No active run' });
  ctx.cancelled = true;
  ctx.controller.abort();
  res.json({ ok: true });
});
```

### Service signal threading
Every external HTTP / SDK call accepts an optional `AbortSignal` as the last parameter and passes it to `fetch({ signal })` or `openai.chat.completions.create({...}, { signal })`. Existing call-sites without a signal continue to work unchanged.

### Frontend run-state lives in SettingsContext, not local component state
This is what makes a run survive page navigation. Each flow has:
- `<flow>Runs` — persisted to `localStorage`
- `active<Flow>RunId`
- `<flow>Status` — `'idle' | 'running' | 'done' | 'error'`
- `<flow>Logs` — recent activity log entries (capped at 100)
- `add<Flow>Log(msg, type)` — log helper

If a setting is local to one component (e.g. a slider value used only on the config screen), keep it local. If it's read or written while a run is in progress, put it in context.

### Frontend SSE consumption
Identical pattern in all three pages (`reader.read()` → buffer split on `\n\n` → parse `event:`/`data:` lines → dispatch). About 30 lines copy-pasted three times. **Candidate for extraction** if you touch this again — `consumeSSE(response, handlers)`.

### Frontend STOP button pattern
```js
async function stopFlow() {
  const runId = active<Flow>RunId;
  if (!runId) return;
  addLog('Stopping…', 'warn');
  setStatus('idle');                   // snappy UI; don't wait for backend
  complete<Flow>Run(runId);            // mark done in context
  try {
    await fetch('/api/<flow>/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientRunId: runId }),
    });
    addLog('Stop acknowledged — backend aborted', 'warn');
  } catch (err) {
    addLog(`Stop failed: ${err.message}`, 'error');
  }
}
```

---

## 3. Commits in this session, in order

All on branch `claude/review-repo-improvements-OZNzR`.

| Hash      | Title                                                                       | Why                                                                                                              |
| --------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `66da675` | Enrich qualified LinkedIn leads with Apollo /people/match                   | Pipeline output was profile URLs with no email/phone — SDRs couldn't act. Added Apollo enrichment with locked-email detection for free tier. |
| `3f763a1` | Maps: switch ZIP selector to single-select                                  | Geocoder auto-selected EVERY ZIP for a city, fanning out into many Apify calls and taking forever.               |
| `871c537` | Maps: add manual ZIP input + 'How it works' note                            | Geocoder (Nominatim + Zippopotam) silently fails for many cities and non-US countries. Manual ZIP bypasses it.   |
| `98d4033` | Maps: keep run state alive across page navigation                           | `status`/`logs` were local component state; navigating away wiped them even though the SSE was still streaming.  |
| `482e40e` | Maps: async Apify scrape with live progress + client-disconnect abort       | `run-sync-get-dataset-items` had a 2-min hard timeout. New `apify-maps.js` does start/poll/fetch with live progress. |
| `1b675e7` | Maps: STOP actually aborts Apify; adaptive poll cadence                     | STOP only flipped local UI status; backend kept running. Added `/stop` + abort. Poll cadence: 2s → 5s → 10s.     |
| `ed8aaa0` | Maps: detect disconnect on res, not req                                     | `req.on('close')` fires when `express.json()` consumes the body, causing instant false cancellation. Use `res.on('close')`. |
| `cc1fba1` | Pipeline: real STOP + disconnect abort; fix azureopenai import casing       | Same architectural fixes as Maps applied to LinkedIn pipeline. Threaded signal through ConnectSafely/OpenAI/Apollo. Fixed `azureOpenAI.js` → `azureopenai.js` casing. |
| `bf02a72` | Outreach: STOP button + backend abort + survive page navigation             | Same pattern for the Apollo/Hunter flow. Added STOP button (didn't exist before).                                |
| `0993b07` | Outreach: fix '3 sizes selected' ghost + surface scoring rubric             | Employee-range default was Apollo's old letter codes; buttons used new numeric codes. Counter said 3 but nothing highlighted, filter silently broken. Also surfaced the AI scoring rubric in the UI. |
| `3c81d98` | Add Guide page                                                              | Sales users had no plain-English reference for the three flows. New `/guide` route in the sidebar.                |
| `68b9613` | Add session handoff doc                                                     | This file. Designed to be read top-to-bottom by another agent picking up the branch.                              |
| `8467418` | Outreach: lock down keyword extraction + hard-disqualify industry mismatch  | The AI keyword extractor hallucinated revenue criteria from "retail and manufacturing" and dropped the actual industries. Tightened the prompt (no inventing, examples, temp 0) and added explicit industry-mismatch disqualification rules to the scorer. Superseded by `0988b66`. |
| `0988b66` | Outreach: deterministic Apollo search — drop AI keyword + AI score          | User correctly pointed out the whole AI-keyword + AI-scoring approach was wrong for the Apollo flow. Replaced with structured Apollo filters: industry multi-select, tech-stack multi-select (Apollo technology UIDs), location, employee size. No more `cleanSearchQuery` or `scoreCompany` call from `/discover`. |
| `75fc801` | HANDOFF.md: bring up to date through 0988b66                                | Doc-only. Established the convention that HANDOFF.md is updated every commit, refreshed sections affected by the deterministic Apollo work.                                                                       |
| `821e132` | server: raise express.json() body limit to 25 MB                            | Default 100 KB tripped on Outreach FIND CONTACTS (sends the discovered-companies array) producing `PayloadTooLargeError: request entity too large`. Raised limit so larger lead lists and Excel exports go through. |

---

## 4. Current state per flow

### LinkedIn pipeline (`routes/pipeline.js` + `pages/LinkedIn.jsx`)

**Flow:** Keywords → search posts → fetch comments → AI screen (Round 1, HIGH/MID/HIDDEN intent) → dedup → enrich profile + company → AI qualify (Round 2, 1–10 confidence) → optional Apollo enrichment → emit qualified leads via SSE.

**Cancellation:** Backend route registers an `AbortController` in `activeRuns`. Signal is threaded through every external call:
- `searchPosts`, `getComments`, `getProfile`, `searchCompany`, `getCompanyDetails` (ConnectSafely)
- `screenComments`, `deepQualify` (Azure OpenAI)
- `matchPerson` (Apollo)

STOP button posts to `/api/pipeline/stop`, also aborts the local fetch. `res.on('close')` covers client disconnect.

**Apollo enrichment:**
- Uses `/api/v1/people/match` with `reveal_personal_emails: true` and `reveal_phone_number: true`.
- Detects Apollo's locked-email sentinel `email_not_unlocked@domain.com` and surfaces it as `emailLocked: true`. Free-tier emails come back locked; the UI shows 🔒.
- Lead object gains: `email`, `emailType`, `emailStatus`, `emailLocked`, `phone`, `apolloPersonId`.
- Excel export gained Email / Email Status / Email Type / Phone columns and an "APOLLO ENRICHMENT" hit-rate section in the Summary sheet.

**Known limitation:** Round 2 is still sequential (`for li in enriched`). Step 1, 2, 4 parallelize in batches of 5 but Round 2 is one-at-a-time. ~5–10× speedup available.

### Outreach / Apollo (`routes/outreach.js` + `pages/Outreach.jsx`)

**Two flows triggered by separate buttons:**
- **DISCOVER COMPANIES** — `/discover`: **Deterministic Apollo search**. Reads structured filters (`industries[]`, `technologies[]`, `targetLocations[]`, `employeeRanges[]`) from req body. Calls `searchCompanies` → enriches each result via `enrichCompany` → streams every match as a `company` event. No AI in the loop. No scoring. No filtering by anything other than what the user picked.
- **FIND CONTACTS** — `/enrich`: For each kept company, Hunter.io finds executives/directors (3 fallback attempts: strict → wider seniority → any email type). Returns up to 5 contacts/company.

**Filter inputs (UI):**
- `TARGET INDUSTRIES` — chip multi-select from 28 curated industries (Retail, Manufacturing, Healthcare, …). Sent to Apollo as `q_organization_keyword_tags` array. Single clean values match Apollo's industry taxonomy reliably.
- `TECH STACK` — chip multi-select from 25 curated tech slugs (`salesforce`, `servicenow`, `sap`, `snowflake`, …). Sent to Apollo as `currently_using_any_of_technology_uids`. **Paid Apollo feature** — user confirmed they're on a paid plan.
- `TARGET LOCATIONS` — comma-separated free text → split into array → `organization_locations`.
- `COMPANY SIZE` — chip multi-select of numeric ranges like `"11,50"` → `organization_num_employees_ranges`.
- `TARGET JOB TITLES` — used only by FIND CONTACTS (Hunter seniority filtering), not discovery.
- `PRODUCT DESCRIPTION` — **no longer used for discovery**. Lives in settings for a future outreach-draft step. UI label explicitly says "Used later for outreach drafts. Not used for discovery."
- Validation: at least one of industries / technologies / locations must be set.

**Cancellation:** Same `activeRuns` pattern as the other flows. One `clientRunId` shared by `/discover` and `/enrich`. Signal threaded through Apollo (`searchCompanies`, `enrichCompany`) and Hunter (`findDecisionMakers`). Single STOP button visible whenever `isRunning` is true.

**Dead but still-present code in `services/groq.js`:** `cleanSearchQuery` and `scoreCompany` were the AI keyword-extractor and AI scorer. They are no longer imported by `routes/outreach.js`. Left in place because the cold-email-writing functions (`createPersonalisationBrief`, `writeColdEmails`, `writeSubjectLines`) are alongside them and we'll want those later. Safe to delete the two unused ones if you're cleaning up — but check no future feature wants them first.

**Excel export still includes `Company Score` columns** (set by the LinkedIn pipeline's Apollo enrichment, not by Outreach). Don't strip them — they're needed by the LinkedIn export path.

**Employee range default:** `['11,50', '51,200', '201,500']` (Apollo's numeric format). Legacy letter codes (A–H) in `localStorage` are auto-migrated on load — see `LEGACY_RANGE_MAP` in `SettingsContext.jsx`.

**Cold-email generation (`writeColdEmails`, `writeSubjectLines`, `createPersonalisationBrief`) exists in `services/groq.js` but is NOT wired into a route yet.** They accept `signal` so they're plumbing-ready. See §5 item 5 for the planned Research tab + outreach-draft flow.

### Maps (`routes/maps.js` + `pages/maps.jsx`)

**Flow:** For each `{ business, country, city, zips }` search:
1. Build one Apify task per ZIP (or one task without ZIP if empty) using query string `{business} near {ZIP}, {city}, {country}`.
2. `runMapsScrape` in `services/apify-maps.js`: start run → poll status with adaptive cadence (2s → 5s → 10s) → fetch dataset items.
3. Filter results: must have phone OR email; otherwise discarded.
4. Stream `lead` events as kept items are processed; cap at `maxResults` per city.

**Cancellation:** Same pattern. Per-run `isCancelled` checked between polls inside `runMapsScrape`, plus `bailIfCancelled` between tasks in the route. STOP calls Apify's `/abort` on every registered runId in parallel.

**UI improvements:**
- Single-ZIP select (used to auto-select all → fanned out into N Apify calls).
- Manual ZIP / pincode input — works for any country, bypasses the flaky free geocoder.
- "How it works" info card at the top of CONFIG tab.
- Live progress in the activity log: `Apify [{query}]: 5 places scraped — 32s elapsed`.

**Known flaky bit:** the ZIP suggestion chain (Nominatim → Zippopotam) is unreliable. The manual input is the workaround. The error message was softened from `⚠ No ZIP codes found` (alarming orange) to a neutral "No ZIP suggestions — type one or leave empty for city-wide".

### Guide page (`pages/HowItWorks.jsx`, route `/guide`)

New page added in commit `3c81d98`. Plain-English reference for sales users. Renders the same scoring rubric and intent tiers used elsewhere, plus a quick-decision matrix and practical tips. No state, no API calls — pure documentation rendered in React for visual consistency.

---

## 5. Things deliberately deferred

These are real improvements I named but didn't ship in this session. Pick from these if asked "what's next":

1. **Persist `<flow>Status` and `<flow>Logs` to localStorage.** Currently they're in context but in-memory only — a full page reload still wipes the live UI (the run survives, the log does not). One-liner around the existing setters.
2. **Extract a reusable SSE client.** Same ~30-line `reader.read() + buffer.split('\n\n')` boilerplate is copied across `LinkedIn.jsx`, `Outreach.jsx`, `maps.jsx`. A `consumeSSE(response, handlers)` utility would cut ~80 LOC.
3. **Parallelize Round 2 in the LinkedIn pipeline.** All other stages batch in groups of 5; Round 2 is a sequential `for` loop. Easy 5–10× speedup.
4. **Replace in-memory `runResults` Map with SQLite.** Currently a process restart loses all run history. `better-sqlite3` is enough.
5. **Research tab + outreach-draft generation (the next big feature the user wants).** Discussed extensively at the end of the session. Plan:
   - New `/research` route + sidebar item.
   - Triggered per-lead by a "Research" button on Apollo Leads / LinkedIn Leads rows. Never bulk, never automatic — to control credit burn AND lead-quality risk.
   - Research view loads in parallel: Apollo `/people/match` (person), Apollo `/organizations/enrich` (company), **Tavily** search for company news + person mentions, plus a "Open LinkedIn" manual click-through button (NO programmatic LinkedIn scraping — user explicitly ruled out anything that uses their `li_at` cookie; see §6).
   - Notes textarea for the rep to add their own observations.
   - "WRITE OUTREACH DRAFT" button wires the existing `createPersonalisationBrief` + `writeColdEmails` + `writeSubjectLines` in `services/groq.js` into a new route. Output: 3 email drafts with subject lines, copy-to-clipboard per email. Saved back to the lead.
   - Each external call is independent — if Tavily is down or product description is empty, the panel still renders what worked.
   - The user is fine with paid Apollo, so use all paid Apollo features freely (no need for graceful free-tier degradation).
6. **TheirStack + Crustdata trigger signals.** I previously suggested these. User pushed back correctly: **for retail/manufacturing IT services, generic triggers like funding / headcount growth / SDR hiring are nearly irrelevant.** The signals that actually matter for that ICP are *role-specific* job postings ("Salesforce admin", "Data engineer", "ServiceNow admin"), *tech-stack adoption* changes, and *new CIO/CDO appointments*. If revisiting this, scope the trigger types to the user's ICP, don't import the generic SaaS-startup playbook.
7. **CRM/sequencer push.** Sales reps don't reach out from xlsx. Direct push to HubSpot / Pipedrive / Smartlead / Instantly etc. would massively shorten the funnel. Not yet scoped — user hasn't said which CRM they use.
8. **ConnectSafely preflight check.** One cheap call before the LinkedIn pipeline kicks off, surfacing "ConnectSafely auth invalid — fix your LinkedIn cookie" upfront instead of a per-keyword warning 30 seconds in. We hit this failure mode in the session.
9. **Security: keys out of `localStorage` and request bodies.** Right now every API key lives in `localStorage` and travels in `req.body`. Fine for solo localhost dev; would be a credential-exfil vector for any production deployment. CORS is also `origin: '*'`.
10. **`services/groq.js` is misnamed** — it doesn't talk to Groq, it talks to Azure OpenAI. Either rename to `services/email-ai.js` or merge into `azureopenai.js`. Cosmetic but confusing for newcomers.
11. **Delete dead code in `services/groq.js`** — `cleanSearchQuery` and `scoreCompany` are no longer imported. Safe to remove once you've confirmed nothing in the planned research-tab flow needs them.

**Closed items** (originally deferred, now done — keeping a short trail):
- ~~Outreach AI keyword extraction misbehaves~~ — solved by removing AI entirely from the discovery step (commit `0988b66`).
- ~~Multi-signal scoring~~ — moot for Outreach now that scoring is deterministic. Still relevant for LinkedIn pipeline if you want to refactor the Round 2 confidence score later.
- ~~Feedback loop from sales~~ — moot for Outreach. Still applicable to LinkedIn pipeline's Round 2 scorer.

---

## 6. Things to know about the user's environment

- **They run on macOS or Windows** (case-insensitive FS). I fixed an `azureOpenAI.js` → `azureopenai.js` casing bug that was working for them only because of FS quirks; it would have failed on Linux production.
- **They were testing ConnectSafely with an expired LinkedIn cookie.** When they say "the keyword failed", check the activity log for `Failed to get LinkedIn authentication credentials` — that's their `li_at` cookie, fix is on ConnectSafely's dashboard, not in code.
- **Apollo: paid plan.** Confirmed mid-session ("don't worry about the free plan, I can take a paid plan from my sales team"). Use paid Apollo features freely — `currently_using_any_of_technology_uids`, `revenue_range`, etc. Free-tier graceful-degradation work is not needed.
- **Apollo locked-email indicator was relevant for the LinkedIn-pipeline enrichment path** (which still runs on the paid Apollo key). The 🔒 indicator stays in the UI in case credits run out; not currently expected to fire.
- **They sell IT services to retail and manufacturing** (data analytics, web dev, Generative AI, Salesforce, ServiceNow). That ICP shapes several decisions: keep `Retail`, `Manufacturing`, plus `Salesforce`, `ServiceNow`, `SAP` near the top of dropdowns; avoid recommending generic SaaS-startup signals (funding, SDR hiring) as triggers — those are noise for this ICP.
- **No LinkedIn scraping that touches the user's account.** Explicit rule. Rules out PhantomBuster, Apify LinkedIn actors, and any service using their `li_at` cookie. They cited LinkedIn account bans they've seen with PhantomBuster.
- **Proxycurl shut down in 2024** (lost LinkedIn lawsuit). Successor "NinjaPear" is unproven. Don't recommend either. For LinkedIn person data, the cleanest legitimate paths today are People Data Labs or Coresignal (licensed/aggregated data, not the user's cookie). For v1 of the research tab, the agreed approach is **skip programmatic LinkedIn entirely** and use Apollo paid data + Tavily web search + a manual "Open LinkedIn" click-through button.
- **They use Vite dev server with proxy** (`/api` → `localhost:3001`). Pure frontend changes get HMR; backend changes need a restart even with nodemon (sometimes nodemon catches it, sometimes not).
- **They run things in VS Code locally**, not on a deployed environment. No CI configured on the GitHub repo (`get_check_runs` returned empty).

---

## 7. Stuff a new LLM should NOT do

- **Do not** put `req.on('close')` on an SSE route. It fires when `express.json()` finishes consuming the body. Use `res.on('close')`. We hit this bug; the fix is in commit `ed8aaa0` if you need the reference.
- **Do not** call `res.write()` on a closed socket. Use the safe `send()` helper that checks `res.writableEnded` / `res.destroyed`.
- **Do not** create a new SSE flow without the `clientRunId` + `activeRuns` + `/stop` pattern. The user explicitly cares about credit-burn on STOP and disconnect.
- **Do not** put run state in local component state. Use `SettingsContext`. Otherwise page navigation wipes status/logs.
- **Do not** create documentation files (`*.md`, `README*.md`) unless explicitly requested. `HANDOFF.md` is the one explicit exception, and the user wants it updated after every change — don't add other docs without asking.
- **Do not** push to `main`. All work is on `claude/review-repo-improvements-OZNzR`, which is open as PR #1.
- **Do not** add emojis to source code or prompts the user will read in product output (the `Code` component in `HowItWorks.jsx` uses a 🔒 emoji because the user *asked* for the locked-email indicator visually; that's a deliberate exception).
- **Do not reintroduce AI keyword extraction or AI scoring into the Apollo discovery flow.** The user explicitly rejected this approach after seeing the AI hallucinate ("revenue over 10 million" from "Businesses retail and manufacturing sector") and score IT services companies as 8/10 for retail/manufacturing targets. Apollo discovery is deterministic now — keep it that way. If you think AI should re-enter the Apollo flow, it belongs in *outreach drafting* (per §5 item 5), not in *discovery*.
- **Do not introduce any LinkedIn scraping that uses the user's `li_at` cookie** — PhantomBuster, Apify LinkedIn actors, etc. all banned by user policy. See §6.
- **Do not recommend Proxycurl.** It shut down in 2024. People Data Labs / Coresignal are the legitimate-looking alternatives if programmatic LinkedIn person data ever becomes necessary; the agreed v1 is to skip it entirely.
- **Do not drop the `express.json({ limit: '25mb' })` config back to the default.** A bare `express.json()` reverts to a 100 KB body cap, which trips immediately on Outreach FIND CONTACTS (full enriched-companies array) and on Excel exports of more than a couple dozen leads.

---

## 8. Quick test path for the whole branch

After pulling `claude/review-repo-improvements-OZNzR`:

1. `cd backend && npm install && npm run dev`
2. `cd frontend && npm install && npm run dev` (separate terminal)
3. Open `http://localhost:5173/guide` first — sanity-check the new page loads.
4. Settings → make sure ConnectSafely key + Account ID, Apollo key, Hunter key, Apify key are all set (you may have them already if testing locally).
5. **LinkedIn flow:** click RUN PIPELINE with default keywords. Watch the activity log. Click STOP mid-run — verify "Stop acknowledged — backend aborted" appears within a second.
6. **Outreach flow:** CONFIG tab — pick at least one industry chip (e.g. Retail, Manufacturing), optionally a tech (e.g. Salesforce), set a location and company size, save. Click DISCOVER COMPANIES. Verify the activity log shows a single line of structured filters being sent, no "Cleaning keywords with AI" or "Scoring" lines. Click STOP mid-run.
7. **Maps flow:** Add a search with country/city/manual ZIP. Click RUN SCRAPER. Verify live "Apify: N places scraped — Ms elapsed" updates every 2 seconds. Navigate to another page and back — log should be intact.

If anything misbehaves, the first thing to check is whether the backend was actually restarted (Vite HMR won't pick up Node changes).

---

End of handoff.
