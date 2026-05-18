import { Router } from 'express';
import { runPhantom } from '../services/phantombuster.js';
import { generateSummary } from '../services/azureopenai.js';

export const summaryRouter = Router();

/**
 * POST /api/summary/profile
 * Body: {
 *   pbApiKey, activityAgentId, profileAgentId,
 *   linkedinCookie, profileUrl
 * }
 */
summaryRouter.post('/profile', async (req, res) => {
  const {
    pbApiKey,
    activityAgentId,
    profileAgentId,
    linkedinCookie,
    profileUrl,
  } = req.body;

  // ── Validate ─────────────────────────────────────────────────────
  if (!pbApiKey || !activityAgentId || !profileAgentId || !linkedinCookie || !profileUrl) {
    return res.status(400).json({
      error: 'Missing required fields: pbApiKey, activityAgentId, profileAgentId, linkedinCookie, profileUrl',
    });
  }

  try {
    console.log(`[summary] Starting scrape for ${profileUrl}`);

    // ── Run both phantoms in parallel ────────────────────────────────
    let activityRows = [];
    let profileRows = [];

    try {
      activityRows = await runPhantom(pbApiKey, activityAgentId, {
      spreadsheetUrl: profileUrl,
      activitiesToScrape: ['Post', 'Comment'],
      numberOfLinesPerLaunch: 10,
      numberMaxOfPosts: 20,
      numberOfDaysLimit: 30,
      csvName: `result_${Date.now()}`,  // ← unique name every run
      sessionCookie: linkedinCookie,
    });
    } catch (err) {
      console.error('[summary] Activity scraper failed:', err.message);
    }

    try {
      profileRows = await runPhantom(pbApiKey, profileAgentId, {
      spreadsheetUrl: profileUrl,
      numberOfLinesPerLaunch: 1,
      sessionCookie: linkedinCookie,
      csvName: `profile_${Date.now()}`,  // ← force new file name
    });
    } catch (err) {
      console.error('[summary] Profile scraper failed:', err.message);
    }

    if (!activityRows.length && !profileRows.length) {
      return res.status(500).json({ error: 'Both phantoms failed — check your LinkedIn cookie in Settings' });
    }
    console.log(`[summary] Activity: ${activityRows.length} rows, Profile: ${profileRows.length} rows`);

    // ── Separate posts from comments ─────────────────────────────────
    // Posts = rows where person published original content
    const posts = activityRows.filter(r =>
      (r.action || '').toLowerCase().includes('posted') ||
      (!r.commentContent && r.postContent)
    );

    // Comments = rows where person commented on someone else's post
    const comments = activityRows.filter(r =>
      (r.action || '').toLowerCase().includes('commented') ||
      Boolean(r.commentContent)
    );

    console.log(`[summary] Posts: ${posts.length}, Comments: ${comments.length}`);

    const profile = profileRows[0] || {};

    // ── Send to Azure OpenAI ──────────────────────────────────────────
    const summary = await generateSummary({ profile, posts, comments });

    return res.json({
      success: true,
      profile: {
        name: `${profile.firstName || ''} ${profile.lastName || ''}`.trim(),
        title: profile.linkedinJobTitle || '',
        company: profile.companyName || '',
        industry: profile.companyIndustry || '',
        location: profile.location || '',
        skills: profile.linkedinSkillsLabel || '',
        about: profile.linkedinDescription || '',
        imageUrl: profile.linkedinProfileImageUrl || '',
      },
      stats: {
        postsCount: posts.length,
        commentsCount: comments.length,
        daysScanned: 30,
      },
      summary,
    });

  } catch (err) {
    console.error('[summary] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});