// ConnectSafely API Service
// All calls use the Bearer token provided by the frontend (user's key).
// All exported functions accept an optional AbortSignal as the last
// argument so the pipeline can short-circuit in-flight HTTP calls when
// the user clicks STOP or disconnects.

const BASE_URL = 'https://api.connectsafely.ai';

// ConnectSafely rate-limits to ~1 request per 3s PER ACCOUNT. All calls
// share this queue so concurrent pipeline batches don't 429 each other.
let queue = Promise.resolve();
const MIN_GAP_MS = 3200; // slightly above 3s for safety margin
let lastCallAt = 0;

function throttle() {
  const run = queue.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastCallAt = Date.now();
  });
  queue = run.catch(() => {}); // don't let one failure break the chain
  return run;
}

async function csRequest(endpoint, body, apiKey, signal, retriesLeft = 3) {
  await throttle();

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 429 && retriesLeft > 0) {
    await new Promise(r => setTimeout(r, MIN_GAP_MS));
    return csRequest(endpoint, body, apiKey, signal, retriesLeft - 1);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ConnectSafely ${endpoint} failed [${res.status}]: ${text}`);
  }

  return res.json();
}

// Search LinkedIn posts by keyword
export async function searchPosts(keyword, accountId, apiKey, options = {}, signal) {
  return csRequest('/linkedin/posts/search', {
    accountId,
    keywords: keyword,
    count: options.postLimit || 20,
    datePosted: options.datePosted || 'past-month',
  }, apiKey, signal);
}

// Get all comments for a post
export async function getComments(postUrl, accountId, apiKey, options = {}, signal) {
  return csRequest('/linkedin/posts/comments/all', {
    accountId,
    postUrl,
    limit: options.commentLimit || 100,
  }, apiKey, signal);
}

// Get LinkedIn profile
export async function getProfile(profileId, accountId, apiKey, signal) {
  return csRequest('/linkedin/profile', {
    accountId,
    profileId,
    includeExperience: true,
    includeEducation: true,
    includeSkills: true,
    forceRefresh: true,
  }, apiKey, signal);
}

// Search company by name
export async function searchCompany(keyword, accountId, apiKey, signal) {
  return csRequest('/linkedin/search/companies', {
    accountId,
    keywords: keyword,
    count: 1,
  }, apiKey, signal);
}

// Get full company details
export async function getCompanyDetails(companyId, accountId, apiKey, signal) {
  return csRequest('/linkedin/search/companies/details', {
    accountId,
    companyId,
  }, apiKey, signal);
}