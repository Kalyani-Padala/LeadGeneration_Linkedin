/**
 * apify-pipeline.js
 * Runs the 3-actor Apify LinkedIn pipeline:
 *   Actor 1: apt_marble   → basic profile + activity feed
 *   Actor 2: data-slayer  → full profile (experience, education, skills, email)
 *   Actor 3: pratikdani   → full post text for commented/truncated items
 */

const BASE = 'https://api.apify.com/v2/acts';
const EP = {
  apt:    `${BASE}/apt_marble~linkedin-profile-scraper/run-sync-get-dataset-items`,
  slayer: `${BASE}/data-slayer~linkedin-profile-scraper/run-sync-get-dataset-items`,
  pratik: `${BASE}/pratikdani~linkedin-posts-scraper/run-sync-get-dataset-items`,
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
  if (i.includes('shared'))    return 'shared';
  if (i.includes('commented')) return 'commented';
  if (i.includes('reacted'))   return 'reacted';
  if (i.includes('liked'))     return 'liked';
  return 'unknown';
}

function needsEnrichment(item) {
  const interaction = (item.interaction || '').toLowerCase();
  const title       = (item.title || '').trim();
  if (interaction.includes('commented')) return true;
  if (!title)                            return true;
  if (isTruncated(title))                return true;
  return false;
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

// ── Actor 1: apt_marble ────────────────────────────────────────────────

async function runAptMarble(profileUrl, apiKey) {
  console.log('[apify] Actor 1: apt_marble → basic profile + activity...');
  const data = first(await callActor(EP.apt, { profileUrl }, apiKey));
  if (data) {
    console.log(`[apify]   ✅ ${data.fullName} | ${(data.recentActivity || []).length} activity items`);
  }
  return data;
}

// ── Actor 2: data-slayer ───────────────────────────────────────────────

async function runDataSlayer(profileUrl, apiKey) {
  console.log('[apify] Actor 2: data-slayer → experience, education, skills, email...');

  const raw = await callActor(EP.slayer, { linkedin_urls: [profileUrl], extract_email: true }, apiKey);  const result = first(raw);

  if (!result) {
    console.warn('[apify]   ⚠️  No data returned from data-slayer');
    return null;
  }

  if (verifyProfileMatch(result, profileUrl)) {
    console.log(
      `[apify]   ✅ ${result.full_name} | ` +
      `${(result.experience || []).length} roles | ` +
      `${(result.education  || []).length} edu | ` +
      `${(result.skills     || []).length} skills | ` +
      `email: ${result.email || 'not found'}`
    );
    return result;
  }

  console.warn(`[apify]   ⚠️  Wrong profile returned (${result.full_name}) — skipping data-slayer`);
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
    const url   = item.link;
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
      post_url:              item.link,
      post_id:               item.id,
      post_image:            item.img,
      post_text:             postText,
      person_comment:        personComment,
      post_date:             item._fetched_date        || null,
      post_likes:            item._fetched_likes       || null,
      post_comments:         item._fetched_comments    || null,
      post_hashtags:         item._fetched_hashtags    || null,
      post_tagged_people:    item._fetched_tagged_people || null,
      post_author_url:       item._fetched_author_url  || null,
      post_images:           item._fetched_images      || null,
      post_embedded_links:   item._fetched_embedded_links || null,
      context_complete:      contextComplete,
      original_post_available: originalPostAvailable,
      _fetch_status:         fetchStatus,
    };
  });
}

// ── Build clean profile record ─────────────────────────────────────────

function buildRecord(profileUrl, apt, slayer, activityFeed) {
  const g = (slayerKey, aptKey = null) => {
    const v = (slayer || {})[slayerKey];
    if (v) return v;
    return aptKey ? (apt || {})[aptKey] : null;
  };

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

  const typeCount    = {};
  let completeCount  = 0;
  for (const a of activityFeed) {
    typeCount[a.interaction_type] = (typeCount[a.interaction_type] || 0) + 1;
    if (a.context_complete) completeCount++;
  }

  return {
    profileUrl,
    scrapedAt: new Date().toISOString(),
    dataSources: {
      apt_marble:  apt    != null,
      data_slayer: slayer != null,
      pratikdani:  activityFeed.some(a => a._fetch_status === 'success'),
    },
    identity: {
      fullName:        g('full_name',            'fullName'),
      firstName:       g('first_name',           'firstName'),
      lastName:        g('last_name',            'lastName'),
      headline:        g('profile_headline',     'headline'),
      location:        g('location',             'city'),
      country:         g('country',              'countryCode'),
      currentCompany:  g('current_company_name', 'currentCompany'),
      companyIndustry: g('company_industry'),
      companyWebsite:  g('company_website'),
      followers:       g('followers',            'followers'),
      connections:     g('connections',          'connections'),
      isPremium:       g('is_premium'),
      isCreator:       g('is_creator'),
      email:           g('email'),
      profileImage:    g('profile_picture',      'profileImage'),
      bannerImage:     apt?.bannerImage || null,
      about:           g('about',                'about'),
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

  const apt    = await runAptMarble(profileUrl, apiKey);
  const slayer = await runDataSlayer(profileUrl, apiKey);


  const rawActivity  = apt?.recentActivity || [];
  const richActivity = await enrichActivity(rawActivity, apiKey);
  const activityFeed = buildActivityFeed(richActivity);

  return buildRecord(profileUrl, apt, slayer, activityFeed);
}