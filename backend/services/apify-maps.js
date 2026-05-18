// Apify Google Maps scraper — async (start + poll + fetch) pattern.
// Replaces the previous /run-sync-get-dataset-items call which blocked the
// HTTP socket for the entire scrape and timed out after 2 minutes.

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID   = 'compass~crawler-google-places';

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_WAIT = 30 * 60 * 1000; // 30 min

const TERMINAL_OK    = new Set(['SUCCEEDED']);
const TERMINAL_FAIL  = new Set(['FAILED', 'TIMED-OUT', 'ABORTED']);

async function apifyFetch(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify ${init.method || 'GET'} ${url.replace(/token=[^&]+/, 'token=***')} [${res.status}]: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function startMapsRun(apifyKey, input) {
  const { data } = await apifyFetch(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${apifyKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return { runId: data.id, datasetId: data.defaultDatasetId };
}

export async function getRunStatus(apifyKey, runId) {
  const { data } = await apifyFetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apifyKey}`);
  return {
    status:       data.status,
    itemCount:    data.stats?.resultCount ?? 0,
    runtimeSecs:  Math.round(data.stats?.runTimeSecs ?? 0),
    startedAt:    data.startedAt,
    finishedAt:   data.finishedAt,
  };
}

export async function fetchDatasetItems(apifyKey, datasetId) {
  return apifyFetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?token=${apifyKey}&clean=true&format=json`
  );
}

export async function abortRun(apifyKey, runId) {
  try {
    await fetch(`${APIFY_BASE}/actor-runs/${runId}/abort?token=${apifyKey}`, { method: 'POST' });
  } catch {
    // Best-effort — Apify will eventually time the run out on its own.
  }
}

// Convenience: start a run, poll until done, return all items.
// `onProgress({ stage, runId, datasetId?, itemCount?, runtimeSecs?, status? })`
// is invoked on start and whenever poll detects a change. `isCancelled()` is
// checked between polls so the caller (e.g. SSE handler) can abort cleanly
// when the client disconnects.
export async function runMapsScrape(apifyKey, input, {
  onProgress,
  isCancelled,
  pollIntervalMs = POLL_INTERVAL_MS,
  maxWaitMs      = DEFAULT_MAX_WAIT,
} = {}) {
  const { runId, datasetId } = await startMapsRun(apifyKey, input);
  onProgress?.({ stage: 'started', runId, datasetId });

  const startTs = Date.now();
  let lastItemCount = -1;
  let lastStatus = '';

  while (Date.now() - startTs < maxWaitMs) {
    if (isCancelled?.()) {
      await abortRun(apifyKey, runId);
      throw new Error('Cancelled by client');
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));

    let status;
    try {
      status = await getRunStatus(apifyKey, runId);
    } catch (err) {
      // Transient — keep polling unless we've been at it for ages.
      onProgress?.({ stage: 'poll-error', runId, message: err.message });
      continue;
    }

    if (status.itemCount !== lastItemCount || status.status !== lastStatus) {
      lastItemCount = status.itemCount;
      lastStatus    = status.status;
      onProgress?.({ stage: 'running', runId, ...status });
    }

    if (TERMINAL_OK.has(status.status)) {
      const items = await fetchDatasetItems(apifyKey, datasetId);
      onProgress?.({ stage: 'done', runId, itemCount: items.length, runtimeSecs: status.runtimeSecs });
      return { runId, items };
    }

    if (TERMINAL_FAIL.has(status.status)) {
      throw new Error(`Apify run ended with status: ${status.status}`);
    }
  }

  await abortRun(apifyKey, runId);
  throw new Error(`Apify run exceeded ${Math.round(maxWaitMs / 1000)}s — aborted`);
}
