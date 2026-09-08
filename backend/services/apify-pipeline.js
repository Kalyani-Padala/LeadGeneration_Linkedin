/**
 * apify-pipeline.js
 * Runs a 2-actor Apify LinkedIn pipeline:
 *   Actor A: harvestapi/linkedin-profile-posts
 *            → the profile's own posts/shares
 *   Actor B: scraping_solutions/linkedin-profile-comments-reactions-scraper-no-cookies
 *            → comments and reactions made BY the profile on others' posts
 *   Actor 2 (unchanged): data-slayer → full profile (experience, education, skills, email)
 *
 * Replaces apt_marble, which was returning "status 404" on the free tier
 * (LinkedIn blocking that actor's proxy/session pool). Both new actors
 * return full, untruncated text directly, so the old Actor 3 (pratikdani)
 * enrichment step is no longer needed — nothing here is truncated.
 */

const BASE = 'https://api.apify.com/v2/acts';
const EP = {
  posts:    `${BASE}/harvestapi~linkedin-profile-posts/run-sync-get-dataset-items`,
  activity: `${BASE}/scraping_solutions~linkedin-profile-comments-reactions-scraper-no-cookies/run-sync-get-dataset-items`,
  slayer:   `${BASE}/data-slayer~linkedin-profile-scraper/run-sync-get-dataset-items`,
};

// ── Helpers ────────────────────────────────────────────────────────────

function first(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

function isTruncated(text = '') {
  const t = text.trim();
  return t.endsWith('…') || t.endsWith('...');
}

function classifyInteraction(interaction = '') {
  const i = interaction.toLowerCase();
  if (i.includes('shared') || i.includes('posted') || i.includes('published') ||
      i.includes('reposted'))                                                    return 'shared';
  if (i.includes('commented'))                                                   return 'commented';
  if (i.includes('reacted') || i.includes('celebrated') || i.includes('supported') ||
      i.includes('love') || i.includes('insightful') || i.includes('curious'))  return 'reacted';
  if (i.includes('liked'))                                                       return 'liked';
  console.warn(`[apify] Unknown interaction type: "${interaction}"`);
  return 'reacted';
}

function resolvePostUrl(link = '') {
  if (!link) return null;
  if (link.includes('session_redirect=')) {
    try {
      const match = link.match(/session_redirect=([^&]+)/);
      if (match) return decodeURIComponent(match[1]);
    } catch { }
  }
  if (link.startsWith('/')) return `https://www.linkedin.com${link}`;
  return link;
}

function needsEnrichment(item) {
  const interaction = (item.interaction || '').toLowerCase();
  const title       = (item.title || '').trim();
  if (interaction.includes('commented')) return true;
  if (!title)                            return true;
  if (isTruncated(title))                return true;
  return false;
function extractUsername(profileUrl) {
  return profileUrl.replace(/\/$/, '').split('/').pop();
}

function verifyProfileMatch(result, expectedUrl) {
  const expectedId = expectedUrl.replace(/\/$/, '').split('/').pop().toLowerCase();
  const fields = ['profile_link', 'profileUrl', 'linkedin_url', 'url', 'linkedinUrl', 'profile_url', 'social_url'];
  for (const field of fields) {
    const val = (result[field] || '').toLowerCase().replace(/\/$/, '');
    if (val && val.includes(expectedId)) return true;
  }
  return false;
}

// ── Actor calls ────────────────────────────────────────────────────────

async function callActor(endpoint, payload, apiKey, timeoutMs = 240000) {
  if (!apiKey) throw new Error('APIFY_TOKEN not provided');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${endpoint}?token=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apify HTTP ${res.status}: ${text.substring(0, 200)}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Actor A: harvestapi own posts ───────────────────────────────────────

async function runOwnPosts(profileUrl, apiKey) {
  console.log('[apify] Actor A: harvestapi/linkedin-profile-posts → own posts...');
  const t0 = Date.now();
  try {
    const raw = await callActor(EP.posts, {
      targetUrls: [profileUrl],
      scrapeReactions: false, // reactions/comments ON this post by others — not needed here
      scrapeComments: false,
      maxPosts: 25,
    }, apiKey);

    const posts = Array.isArray(raw) ? raw : [];
    console.log(`[apify]   ✅ ${posts.length} own posts fetched (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    return posts.map(p => ({
      interaction_type: 'shared',
      interaction_raw: 'posted',
      post_url: p.linkedinUrl || null,
      post_id: p.id || null,
      post_text: p.content || null,
      person_comment: null,
      post_date: p.postedAt?.date || null,
      post_likes: p.engagement?.likes ?? null,
      post_comments: p.engagement?.comments ?? null,
      post_reposts: p.engagement?.shares ?? null,
      post_hashtags: null,
      post_tagged_people: null,
      post_author_url: profileUrl,
      post_images: (p.postImages || []).map(img => img.url || img).filter(Boolean),
      post_embedded_links: null,
      context_complete: Boolean(p.content),
      original_post_available: true,
      _fetch_status: 'not_needed', // full text already present, no enrichment needed
    }));
  } catch (err) {
    console.warn(`[apify]   ⚠️  harvestapi posts failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
  }
}

// ── Actor B: comments + reactions ───────────────────────────────────────

async function runCommentsAndReactions(profileUrl, apiKey) {
  console.log('[apify] Actor B: comments+reactions scraper...');
  const username = extractUsername(profileUrl);
  const t0 = Date.now();

  try {
    const raw = await callActor(EP.activity, {
      usernames: [username],
      type: 'both',
      maxItemsPerProfile: 100,
    }, apiKey);

    const rows = Array.isArray(raw) ? raw : [];
    console.log(`[apify]   ✅ ${rows.length} comment/reaction items fetched  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

    return rows.map(row => {
      const isReaction = row.sourceType === 'reaction';
      return {
        interaction_type: isReaction ? 'reacted' : 'commented',
        interaction_raw: row.action || row.sourceType,
        post_url: row.postUrl || null,
        post_id: null,
        post_text: row.postText || (isReaction ? row.content : null) || null,
        person_comment: isReaction ? null : row.content,
        post_date: row.eventDate || null,
        post_likes: row.postTotalReactions ?? null,
        post_comments: row.postCommentsCount ?? null,
        post_reposts: row.postRepostsCount ?? null,
        post_hashtags: null,
        post_tagged_people: null,
        post_author_url: row.postAuthorProfileUrl || null,
        post_author_name: row.postAuthorName || row.actorName || null,
        post_images: null,
        post_embedded_links: null,
        context_complete: Boolean(row.postText || row.content),
        original_post_available: Boolean(row.postText),
        _fetch_status: 'not_needed',
      };
    });
  } catch (err) {
    console.warn(`[apify]   ⚠️  comments+reactions actor failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${err.message}`);
    return [];
  }
}

// ── Actor 2 (unchanged): data-slayer ────────────────────────────────────

async function runDataSlayer(profileUrl, apiKey) {
  console.log('[apify] Actor 2: data-slayer → experience, education, skills, email...');
  const t0 = Date.now();

  const raw = await callActor(EP.slayer, { linkedin_urls: [profileUrl], extract_email: true }, apiKey);
  const result = first(raw);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1) + 's';

  if (!result) {
    console.warn(`[apify]   ⚠️  No data returned from data-slayer (${elapsed}ms)`);
    return null;
  }

  if (verifyProfileMatch(result, profileUrl)) {
    console.log(
      `[apify]   ✅ ${result.full_name} | ` +
      `${(result.experience || []).length} roles | ` +
      `${(result.education  || []).length} edu | ` +
      `${(result.skills     || []).length} skills | ` +
      `email: ${result.email || 'not found'} (${elapsed}ms)`
    );
    return result;
  }

  console.warn(`[apify]   ⚠️  Wrong profile returned (${result.full_name}) — skipping data-slayer (${elapsed}ms)`);
  return null;
}

// ── Actor 3: pratikdani ────────────────────────────────────────────────

async function fetchPost(postUrl, apiKey) {
  try {
    const raw = await callActor(EP.pratik, { url: postUrl }, apiKey, 120000);
    return first(raw);
  } catch {
    return null;
  }
}

async function enrichActivity(items, apiKey) {
  console.log('[apify] Actor 3: pratikdani → enriching incomplete items...');

  const toFetch   = items.map((item, i) => ({ i, item })).filter(({ item }) => needsEnrichment(item));
  const skipCount = items.length - toFetch.length;
  console.log(`[apify]   Skipping : ${skipCount} (full text present)`);
  console.log(`[apify]   Fetching : ${toFetch.length} (commented or truncated)`);

  const enriched = items.map(item => ({ ...item }));

  for (const { i, item } of toFetch) {
    const url   = resolvePostUrl(item.link);
    const itype = classifyInteraction(item.interaction || '');

    if (!url) {
      enriched[i]._fetch_status = 'skipped_no_url';
      continue;
    }

    console.log(`[apify]   [${itype}] ${url.substring(0, 70)}...`);
    const post = await fetchPost(url, apiKey);

    if (post?.post_text) {
      enriched[i]._fetched_post_text      = post.post_text;
      enriched[i]._fetched_date           = post.date_posted;
      enriched[i]._fetched_likes          = post.num_likes;
      enriched[i]._fetched_comments       = post.num_comments;
      enriched[i]._fetched_hashtags       = post.hashtags;
      enriched[i]._fetched_tagged_people  = post.tagged_people;
      enriched[i]._fetched_author_url     = post.use_url;
      enriched[i]._fetched_images         = post.images;
      enriched[i]._fetched_embedded_links = post.embedded_links;
      enriched[i]._fetch_status           = 'success';
      console.log(`[apify]     ✅ "${post.post_text.substring(0, 80)}..."`);
    } else {
      enriched[i]._fetched_post_text = null;
      enriched[i]._fetch_status      = 'failed';
      console.warn(`[apify]     ⚠️  Could not fetch post text`);
    }
  }

  return enriched;
}

// ── Build activity feed ────────────────────────────────────────────────

function buildActivityFeed(enrichedItems) {
  return enrichedItems.map(item => {
    const itype       = classifyInteraction(item.interaction || '');
    const rawTitle    = (item.title || '').trim();
    const fetchedText = item._fetched_post_text;
    const fetchStatus = item._fetch_status || 'not_needed';

    let postText, personComment, originalPostAvailable;

    if (itype === 'commented') {
      personComment        = rawTitle;
      postText             = fetchedText || null;
      originalPostAvailable = Boolean(fetchedText);
    } else {
      personComment        = null;
      postText             = fetchedText || rawTitle;
      originalPostAvailable = true;
    }

    const contextComplete = (
      Boolean(postText) &&
      !isTruncated(postText || '') &&
      ['success', 'not_needed'].includes(fetchStatus)
    );

    return {
      interaction_type:      itype,
      interaction_raw:       item.interaction,
      post_url:              resolvePostUrl(item.link),
      post_id:               item.id,
      post_image:            item.img,
      post_text:             postText,
      person_comment:        personComment,
      post_date:             item._fetched_date          || null,
      post_likes:            item._fetched_likes         || null,
      post_comments:         item._fetched_comments      || null,
      post_hashtags:         item._fetched_hashtags      || null,
      post_tagged_people:    item._fetched_tagged_people || null,
      post_author_url:       item._fetched_author_url    || null,
      post_images:           item._fetched_images        || null,
      post_embedded_links:   item._fetched_embedded_links || null,
      context_complete:      contextComplete,
      original_post_available: originalPostAvailable,
      _fetch_status:         fetchStatus,
    };
  });
}

// ── Build clean profile record ─────────────────────────────────────────

function buildRecord(profileUrl, slayer, activityFeed) {
  const g = (slayerKey) => (slayer || {})[slayerKey] || null;

  const experience = (slayer?.experience || []).map(e => ({
    job_title:        e.job_title || e.raw_job_title,
    company_name:     e.company_name || e.raw_company_name,
    company_url:      e.company_url,
    company_website:  e.company_website,
    company_industry: e.company_industry,
    employment_type:  e.employment_type,
    job_location:     e.job_location,
    started_on:       e.job_started_on,
    ended_on:         e.job_ended_on || (e.job_still_working ? 'present' : null),
    is_current:       Boolean(e.job_still_working),
    job_description:  e.job_description || [],
  }));

  const education = (slayer?.education || []).map(e => ({
    university_name: e.university_name,
    degree:          e.degree,
    fields_of_study: e.fields_of_study || [],
    started_year:    (e.started_on || {}).year,
    ended_year:      (e.ended_on   || {}).year,
    grade:           e.grade,
    description:     e.description,
  }));

  const typeCount   = {};
  let completeCount = 0;
  for (const a of activityFeed) {
    typeCount[a.interaction_type] = (typeCount[a.interaction_type] || 0) + 1;
    if (a.context_complete) completeCount++;
  }

  return {
    profileUrl,
    scrapedAt: new Date().toISOString(),
    dataSources: {
      harvestapi_posts: activityFeed.some(a => a.interaction_type === 'shared'),
      comments_reactions: activityFeed.some(a => a.interaction_type === 'commented' || a.interaction_type === 'reacted'),
      data_slayer: slayer != null,
    },
    identity: {
      fullName:        g('full_name'),
      firstName:       g('first_name'),
      lastName:        g('last_name'),
      headline:        g('profile_headline'),
      location:        g('location'),
      country:         g('country'),
      currentCompany:  g('current_company_name'),
      companyIndustry: g('company_industry'),
      companyWebsite:  g('company_website'),
      followers:       g('followers'),
      connections:     g('connections'),
      isPremium:       g('is_premium'),
      isCreator:       g('is_creator'),
      email:           g('email'),
      profileImage:    g('profile_picture'),
      bannerImage:     null,
      about:           g('about'),
    },
    career: {
      experience,
      education,
      skills:         slayer?.skills         || [],
      certifications: slayer?.certifications || [],
      languages:      slayer?.languages      || [],
      volunteer:      slayer?.volunteering   || [],
    },
    activityFeed,
    summary: {
      totalActivityItems: activityFeed.length,
      contextComplete:    completeCount,
      contextIncomplete:  activityFeed.length - completeCount,
      activityByType:     typeCount,
      experienceRoles:    experience.length,
      educationEntries:   education.length,
      skillsCount:        (slayer?.skills || []).length,
    },
  };
}

// ── Main export ────────────────────────────────────────────────────────

export async function runApifyPipeline(profileUrl, apiKey) {
  console.log(`[apify] Starting pipeline for ${profileUrl}`);
  const pipelineStart = Date.now();

  // Run all three independent calls in parallel — none depend on each other's output.
  const [ownPosts, activity, slayer] = await Promise.all([
    runOwnPosts(profileUrl, apiKey),
    runCommentsAndReactions(profileUrl, apiKey),
    runDataSlayer(profileUrl, apiKey),
  ]);

  const activityFeed = [...ownPosts, ...activity].sort((a, b) => {
    const da = a.post_date ? new Date(a.post_date).getTime() : 0;
    const db = b.post_date ? new Date(b.post_date).getTime() : 0;
    return db - da; // newest first
  });

  const record = buildRecord(profileUrl, slayer, activityFeed);
  console.log(`[apify] ⏱ Pipeline total: ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`);
  return record;
}