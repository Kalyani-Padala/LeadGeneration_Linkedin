import { Router } from 'express';
import {
  searchPosts,
  getComments,
  getProfile,
  searchCompany,
  getCompanyDetails,
} from '../services/connectsafely.js';
import { screenComments, deepQualify } from '../services/azureopenai.js';
import { matchPerson } from '../services/apollo.js';

export const pipelineRouter = Router();

const runResults = new Map();

// In-flight pipeline sessions keyed by the frontend's clientRunId.
// Lets POST /stop find and abort the run an SSE handler is processing.
const activeRuns = new Map();

function send(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Socket may have closed between the check and the write — ignore.
  }
}

// Throw a benign error so the outer loop unwinds without sending
// `error` events for what is actually user-initiated cancellation.
function bailIfCancelled(ctx) {
  if (ctx.cancelled) throw new Error('Cancelled by client');
}

pipelineRouter.post('/run', async (req, res) => {
  const { connectSafelyKey, accountId, keywords, pipelineSettings = {}, apolloKey, clientRunId } = req.body;

  if (!connectSafelyKey || !accountId || !keywords?.length) {
    return res.status(400).json({ error: 'Missing connectSafelyKey, accountId, or keywords' });
  }
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Single AbortController whose signal is threaded into every external
  // network call (ConnectSafely, OpenAI, Apollo). Aborting it short-
  // circuits in-flight requests so we stop burning credits the instant
  // the user clicks STOP or disconnects.
  const controller = new AbortController();
  const ctx = { cancelled: false, controller };
  activeRuns.set(clientRunId, ctx);
  const { signal } = controller;

  let completed = false;
  res.on('close', () => {
    if (!completed) {
      ctx.cancelled = true;
      controller.abort();
    }
  });

  const runId = `run_${Date.now()}`;
  const allLeads = [];

  try {
    send(res, 'start', { runId, totalKeywords: keywords.length });

    // ── STEP 1: Search posts ───────────────────────────────────────────
    const allPosts = [];
    const seenPostUrls = new Set();
    const POST_BATCH = 5;

    send(res, 'progress', {
      stage: 'posts',
      message: `Searching ${keywords.length} keywords in parallel...`,
      current: 0,
      total: keywords.length,
    });

    for (let ki = 0; ki < keywords.length; ki += POST_BATCH) {
      bailIfCancelled(ctx);
      const batch = keywords.slice(ki, ki + POST_BATCH);

      const results = await Promise.all(
        batch.map(async ({ keyword }) => {
          try {
            const result = await searchPosts(keyword, accountId, connectSafelyKey, pipelineSettings, signal);
            const posts = result?.posts || result?.data || [];
            return { keyword, posts };
          } catch (err) {
            if (ctx.cancelled) return { keyword, posts: [] };
            send(res, 'warning', { message: `Keyword "${keyword}" failed: ${err.message}` });
            return { keyword, posts: [] };
          }
        })
      );

      for (const { keyword, posts } of results) {
        for (const post of posts) {
          const url = post.url || post.postUrl;
          if (url && !seenPostUrls.has(url)) {
            seenPostUrls.add(url);
            allPosts.push({ ...post, keyword });
          }
        }
      }

      send(res, 'progress', {
        stage: 'posts',
        message: `Keywords searched: ${Math.min(ki + POST_BATCH, keywords.length)}/${keywords.length}`,
        current: Math.min(ki + POST_BATCH, keywords.length),
        total: keywords.length,
      });
    }

    send(res, 'progress', {
      stage: 'posts_done',
      message: `Found ${allPosts.length} unique posts`,
      count: allPosts.length,
    });

    // ── STEP 2: Fetch comments ─────────────────────────────────────────
    const postsWithComments = [];
    const COMMENT_BATCH = 5;

    send(res, 'progress', {
      stage: 'comments',
      message: `Fetching comments for ${allPosts.length} posts in parallel...`,
      current: 0,
      total: allPosts.length,
    });

    for (let pi = 0; pi < allPosts.length; pi += COMMENT_BATCH) {
      bailIfCancelled(ctx);
      const batch = allPosts.slice(pi, pi + COMMENT_BATCH);

      const results = await Promise.all(
        batch.map(async post => {
          const postUrl = post.url || post.postUrl;
          try {
            const result = await getComments(postUrl, accountId, connectSafelyKey, pipelineSettings, signal);
            const comments = result?.comments || result?.data || [];
            return { post, postUrl, comments };
          } catch {
            return { post, postUrl, comments: [] };
          }
        })
      );

      for (const { post, postUrl, comments } of results) {
        if (comments.length > 0) {
          postsWithComments.push({
            postUrl,
            postContent: post.text || post.content || '',
            keyword: post.keyword,
            comments,
          });
        }
      }

      send(res, 'progress', {
        stage: 'comments',
        message: `Comments fetched: ${Math.min(pi + COMMENT_BATCH, allPosts.length)}/${allPosts.length} posts`,
        current: Math.min(pi + COMMENT_BATCH, allPosts.length),
        total: allPosts.length,
      });
    }

    // ── STEP 3: AI Screen (Round 1) ────────────────────────────────────
    const round1Leads = [];
    const totalComments = postsWithComments.reduce((s, p) => s + p.comments.length, 0);
    let processedComments = 0;

    const intentMap = {
      'HIGH':   'high',
      'MID':    'medium',
      'HIDDEN': 'low',
    };

    send(res, 'progress', {
      stage: 'round1',
      message: `AI screening — ${totalComments} comments across ${postsWithComments.length} posts`,
      total: totalComments,
    });

    for (const postData of postsWithComments) {
      bailIfCancelled(ctx);
      const { postUrl, postContent, comments } = postData;
      const CHUNK = 10;

      for (let ci = 0; ci < comments.length; ci += CHUNK) {
        bailIfCancelled(ctx);
        const chunk = comments.slice(ci, ci + CHUNK);

        try {
          const results = await screenComments(postContent, chunk, signal);

          for (const r of results) {
            if (r.authorName && r.intentLevel && r.intentLevel !== 'HIDDEN') {
              const original = chunk.find(c =>
                (c.authorName || '').toLowerCase().trim() ===
                (r.authorName || '').toLowerCase().trim()
              );

              if (original) {
                round1Leads.push({
                  postUrl,
                  postContent,
                  ...original,
                  commenterName: r.authorName,
                  comment: r.comment || original.commentText || original.comment || '',
                  designation: r.designation || original.authorDesignation || '',
                  intentLevel: intentMap[r.intentLevel] || 'low',
                  round1Reason: r.reason,
                  keyword: postData.keyword,
                });
              }
            }
          }
        } catch (err) {
          if (ctx.cancelled) throw err;
          send(res, 'warning', { message: `AI screen error: ${err.message}` });
        }

        processedComments += chunk.length;
        send(res, 'progress', {
          stage: 'round1',
          message: `AI screen: ${processedComments}/${totalComments} comments, ${round1Leads.length} flagged`,
          current: processedComments,
          total: totalComments,
          flagged: round1Leads.length,
        });
      }
    }

    // ── DEDUP after Round 1 — by profileUrl/publicIdentifier ──────────
    const seenProfiles = new Map();
    for (const lead of round1Leads) {
      const key = lead.publicIdentifier || lead.profileUrl || lead.commenterName;
      if (!key) continue;
      const existing = seenProfiles.get(key);
      if (!existing) {
        seenProfiles.set(key, lead);
      } else {
        const intentRank = { high: 3, medium: 2, low: 1 };
        if ((intentRank[lead.intentLevel] || 0) > (intentRank[existing.intentLevel] || 0)) {
          seenProfiles.set(key, lead);
        }
      }
    }
    const dedupedLeads = Array.from(seenProfiles.values());

    send(res, 'progress', {
      stage: 'round1_done',
      message: `AI screen complete — ${dedupedLeads.length} unique leads (${round1Leads.length - dedupedLeads.length} duplicates removed)`,
      count: dedupedLeads.length,
    });

    // ── STEP 4: Enrich profiles + companies ───────────────────────────
    const enriched = [];
    const ENRICH_BATCH = 5;

    send(res, 'progress', {
      stage: 'enrichment',
      message: `Enriching ${dedupedLeads.length} profiles in parallel...`,
      current: 0,
      total: dedupedLeads.length,
    });

    for (let li = 0; li < dedupedLeads.length; li += ENRICH_BATCH) {
      bailIfCancelled(ctx);
      const batch = dedupedLeads.slice(li, li + ENRICH_BATCH);

      send(res, 'progress', {
        stage: 'enrichment',
        message: `Enriching profiles ${li + 1}–${Math.min(li + ENRICH_BATCH, dedupedLeads.length)}/${dedupedLeads.length}`,
        current: li + 1,
        total: dedupedLeads.length,
      });

      const enrichedBatch = await Promise.all(
        batch.map(async lead => {
          const profileId = lead.publicIdentifier || lead.profileUrl || lead.authorProfileUrl;
          let profile = {}, experience = [], company = {};

          try {
            const profileData = await getProfile(profileId, accountId, connectSafelyKey, signal);
            profile = profileData?.profile || profileData || {};
            experience = profileData?.experience || profile?.experience || [];
          } catch { }

          const companyName = (experience[0]?.companyName || lead.currentCompanyName || '').trim();

          if (companyName) {
            try {
              const companySearch = await searchCompany(companyName, accountId, connectSafelyKey, signal);
              const companies = companySearch?.companies || companySearch?.data || [];
              const firstCompany = companies[0];
              if (firstCompany?.companyId) {
                const details = await getCompanyDetails(firstCompany.companyId, accountId, connectSafelyKey, signal);
                company = {
                  ...(details?.company || details || {}),
                  followerCount: firstCompany.followerCount || 0,
                  industry: firstCompany.industry || details?.company?.industry || '',
                  location: firstCompany.location || '',
                };
              }
            } catch { }
          }

          return { ...lead, profile, experience, company };
        })
      );

      enriched.push(...enrichedBatch);
    }

    // ── STEP 5: AI Qualify (Round 2) ───────────────────────────────────
    send(res, 'progress', {
      stage: 'round2',
      message: `AI qualifying ${enriched.length} leads...`,
      total: enriched.length,
    });

    for (let li = 0; li < enriched.length; li++) {
      bailIfCancelled(ctx);
      const lead = enriched[li];

      send(res, 'progress', {
        stage: 'round2',
        message: `AI qualify: ${li + 1}/${enriched.length} — ${lead.commenterName}`,
        current: li + 1,
        total: enriched.length,
      });

      try {
        const result = await deepQualify(lead, signal);

        if (result.isQualifiedLead && result.confidenceScore >= (pipelineSettings.minScore || 6)) {
          const currentExp = (lead.experience || [])[0] || {};

          const qualifiedLead = {
            commenterName:      lead.commenterName || lead.authorName,
            designation:        lead.designation || currentExp.title,
            comment:            lead.comment,
            profileUrl:         lead.profileUrl || lead.authorProfileUrl,
            postUrl:            lead.postUrl,
            keyword:            lead.keyword,
            intentLevel:        lead.intentLevel,
            round1Reason:       lead.round1Reason,
            confidenceScore:    result.confidenceScore,
            decisionMakerLevel: result.decisionMakerLevel,
            round2Reason:       result.reason,
            currentRole:        currentExp.title || '',
            currentCompany:     currentExp.companyName || lead.company?.name || '',
            companyName:        lead.company?.name || currentExp.companyName || '',
            companyIndustry:    lead.company?.industry || '',
            companyFollowers:   lead.company?.followerCount || 0,
            companySize:        lead.company?.staffCount
                                  ? lead.company.staffCount <= 10  ? 'small'
                                  : lead.company.staffCount <= 200 ? 'mid'
                                  : 'enterprise'
                                  : result.companySize || '',
            companyWebsite:     lead.company?.websiteUrl || '',
            companyLocation:    lead.company?.location || '',
            companyLinkedinUrl: lead.company?.linkedinUrl || '',
            // Contact (filled by Apollo enrichment below if apolloKey present)
            email:              '',
            emailType:          '',
            emailStatus:        '',
            emailLocked:        false,
            phone:              '',
            apolloPersonId:     '',
          };

          // ── Apollo /people/match enrichment ────────────────────────
          // Tries LinkedIn URL first (best match), falls back to name + company.
          // On Apollo free tier, emails come back locked as `emailLocked: true`.
          if (apolloKey) {
            try {
              const enrich = await matchPerson({
                linkedinUrl:      qualifiedLead.profileUrl,
                name:             qualifiedLead.commenterName,
                organizationName: qualifiedLead.currentCompany || qualifiedLead.companyName,
                domain:           qualifiedLead.companyWebsite
                                    ? qualifiedLead.companyWebsite.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
                                    : undefined,
              }, apolloKey, signal);

              if (enrich) {
                qualifiedLead.email          = enrich.email;
                qualifiedLead.emailType      = enrich.emailType;
                qualifiedLead.emailStatus    = enrich.emailStatus;
                qualifiedLead.emailLocked    = enrich.emailLocked;
                qualifiedLead.phone          = enrich.phone;
                qualifiedLead.apolloPersonId = enrich.apolloPersonId;
              }
            } catch (err) {
              if (ctx.cancelled) throw err;
              send(res, 'warning', { message: `Apollo enrich failed for ${qualifiedLead.commenterName}: ${err.message}` });
            }
          }

          // Final dedup before adding
          const alreadyExists = allLeads.some(l =>
            (l.profileUrl && l.profileUrl === qualifiedLead.profileUrl) ||
            (l.commenterName === qualifiedLead.commenterName &&
             l.currentCompany === qualifiedLead.currentCompany)
          );

          if (!alreadyExists) {
            allLeads.push(qualifiedLead);
            send(res, 'lead', qualifiedLead);
          }
        }
      } catch (err) {
        if (ctx.cancelled) throw err;
        send(res, 'warning', { message: `AI qualify error for ${lead.commenterName}: ${err.message}` });
      }
    }

    // Store results
    runResults.set(runId, allLeads);
    if (runResults.size > 10) {
      runResults.delete(runResults.keys().next().value);
    }

    send(res, 'complete', {
      runId,
      totalLeads: allLeads.length,
      message: `Pipeline complete — ${allLeads.length} qualified leads found`,
    });

  } catch (err) {
    if (ctx.cancelled) {
      send(res, 'warning', { message: 'Pipeline cancelled' });
    } else {
      send(res, 'error', { message: err.message });
    }
  } finally {
    completed = true;
    activeRuns.delete(clientRunId);
    res.end();
  }
});

// ── Stop an in-flight pipeline ────────────────────────────────────────
pipelineRouter.post('/stop', (req, res) => {
  const { clientRunId } = req.body || {};
  if (!clientRunId) return res.status(400).json({ error: 'clientRunId required' });

  const ctx = activeRuns.get(clientRunId);
  if (!ctx) return res.json({ ok: true, message: 'No active run' });

  ctx.cancelled = true;
  ctx.controller.abort();
  res.json({ ok: true });
});

pipelineRouter.get('/results/:runId', (req, res) => {
  const leads = runResults.get(req.params.runId);
  if (!leads) return res.status(404).json({ error: 'Run not found' });
  res.json({ leads, count: leads.length });
});
