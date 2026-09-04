/**
 * apify-summary.js
 * Route: POST /api/apify-summary/profile
 *
 * Apify-driven profile summary. Used by the Lookup tab. Does NOT replace
 * the existing /api/summary/profile (PhantomBuster) route — both coexist.
 *
 * Body: { profileUrl: "https://www.linkedin.com/in/...", apifyToken: "..." }
 */

import { Router } from 'express';
import { runApifyPipeline } from '../services/apify-pipeline.js';
import { generateApifySummary } from '../services/linkedin-llm.js';

export const apifySummaryRouter = Router();

apifySummaryRouter.post('/profile', async (req, res) => {
  const { profileUrl, apifyToken } = req.body;

  if (!profileUrl) {
    return res.status(400).json({ error: 'Missing required field: profileUrl' });
  }
  if (!profileUrl.includes('linkedin.com/in/')) {
    return res.status(400).json({ error: 'profileUrl must be a LinkedIn profile URL (linkedin.com/in/...)' });
  }

  const token = apifyToken || process.env.APIFY_TOKEN;
  if (!token) {
    return res.status(400).json({ error: 'apifyToken is required' });
  }

  try {
    console.log(`[apify-summary] Starting pipeline for ${profileUrl}`);

    const routeStart = Date.now();

    const record  = await runApifyPipeline(profileUrl, token);
    console.log(`[apify-summary] ⏱ Apify pipeline stage: ${((Date.now() - routeStart) / 1000).toFixed(1)}s`);
    const llmStart = Date.now();
    const summary = await generateApifySummary(record);
    console.log(`[apify-summary] ⏱ LLM stage: ${((Date.now() - llmStart) / 1000).toFixed(1)}s`);
    console.log(`[apify-summary] ⏱ Total route time: ${((Date.now() - routeStart) / 1000).toFixed(1)}s`);

    const identity   = record.identity     || {};
    const career     = record.career       || {};
    const recSummary = record.summary      || {};
    const feed       = record.activityFeed || [];

    const posts    = feed.filter(a => a.interaction_type === 'shared');
    const comments = feed.filter(a => a.interaction_type === 'commented');
    const reacted  = feed.filter(a => ['reacted', 'liked'].includes(a.interaction_type));

    return res.json({
      success: true,

      profile: {
        name:           identity.fullName        || '',
        firstName:      identity.firstName       || '',
        lastName:       identity.lastName        || '',
        title:          identity.headline        || '',
        company:        identity.currentCompany  || '',
        industry:       identity.companyIndustry || '',
        location:       identity.location        || '',
        country:        identity.country         || '',
        email:          identity.email           || '',
        followers:      identity.followers       || 0,
        connections:    identity.connections     || 0,
        isPremium:      identity.isPremium       || false,
        isCreator:      identity.isCreator       || false,
        skills:         (career.skills || []).join(', '),
        about:          identity.about           || '',
        imageUrl:       identity.profileImage    || '',
        bannerUrl:      identity.bannerImage     || '',
        profileUrl:     record.profileUrl        || profileUrl,
        companyWebsite: identity.companyWebsite  || '',
      },

      career: {
        experience:     career.experience     || [],
        education:      career.education      || [],
        certifications: career.certifications || [],
        languages:      career.languages      || [],
        volunteer:      career.volunteer      || [],
      },

      stats: {
        totalActivity:     recSummary.totalActivityItems || 0,
        postsCount:        posts.length,
        commentsCount:     comments.length,
        reactedCount:      reacted.length,
        activityByType:    recSummary.activityByType    || {},
        contextComplete:   recSummary.contextComplete   || 0,
        contextIncomplete: recSummary.contextIncomplete || 0,
      },

      activityFeed: feed,

      summary: {
        interests:         summary.interests         || [],
        expertise:         summary.expertise         || [],
        summary:           summary.summary           || '',
        careerStory:       summary.careerStory       || '',
        activityNarrative: summary.activityNarrative || '',
        outreach:          summary.outreach          || {
          hook:          '',
          talkingPoints: [],
          icebreakers:   [],
          bestAngle:     '',
        },
      },

      meta: {
        scrapedAt:   record.scrapedAt,
        dataSources: record.dataSources,
      },
    });

  } catch (err) {
    console.error('[apify-summary] Error:', err.message);
    console.error('[apify-summary] Stack:', err.stack);
    return res.status(500).json({ error: err.message });
  }
});
