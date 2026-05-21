/**
 * linkedin-llm.js
 * Builds a rich LLM prompt from Apify pipeline data and calls Azure OpenAI.
 *
 * Output shape:
 * {
 *   interests:         string[]
 *   expertise:         string[]
 *   outreach:          { hook, talkingPoints, icebreakers, bestAngle }
 *   summary:           string
 *   careerStory:       string
 *   activityNarrative: string  ← NEW: what they post/comment/react to
 * }
 */

import OpenAI from 'openai';

function getClient() {
  if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
    throw new Error('Azure OpenAI credentials not configured in .env');
  }
  return new OpenAI({
    apiKey:         process.env.AZURE_OPENAI_KEY,
    baseURL:        `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini'}`,
    defaultQuery:   { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-01' },
    defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY },
  });
}

// ── Format helpers ─────────────────────────────────────────────────────

function formatExperience(experience = []) {
  if (!experience.length) return 'Not available';
  return experience.slice(0, 8).map((e, i) => {
    const period = e.started_on
      ? `${e.started_on} → ${e.ended_on || 'present'}`
      : '';
    const desc = (e.job_description || []).slice(0, 3).join(' | ');
    return [
      `${i + 1}. ${e.job_title || 'Unknown role'} @ ${e.company_name || 'Unknown'}`,
      period         ? `   Period   : ${period}`            : '',
      e.job_location ? `   Location : ${e.job_location}`    : '',
      e.company_industry ? `   Industry : ${e.company_industry}` : '',
      e.employment_type  ? `   Type     : ${e.employment_type}`  : '',
      desc           ? `   Details  : ${desc}`              : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function formatEducation(education = []) {
  if (!education.length) return 'Not available';
  return education.map((e, i) => {
    const years = e.started_year && e.ended_year
      ? `${e.started_year} – ${e.ended_year}`
      : e.started_year || '';
    const fields = (e.fields_of_study || []).join(', ');
    return [
      `${i + 1}. ${e.degree || 'Degree'} — ${e.university_name || 'Unknown'}`,
      years  ? `   Years  : ${years}`  : '',
      fields ? `   Fields : ${fields}` : '',
      e.grade ? `   Grade  : ${e.grade}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}

function formatCertifications(certs = []) {
  if (!certs.length) return 'None listed';
  return certs.slice(0, 10).map((c, i) =>
    `${i + 1}. ${c.name || c.title || JSON.stringify(c)}`
  ).join('\n');
}

function formatLanguages(languages = []) {
  if (!languages.length) return 'Not listed';
  return languages.map(l =>
    typeof l === 'string' ? l : `${l.name || ''}${l.proficiency ? ` (${l.proficiency})` : ''}`
  ).join(', ');
}

function formatActivity(activityFeed = []) {
  const posts    = activityFeed.filter(a => a.interaction_type === 'shared'    && a.post_text);
  const comments = activityFeed.filter(a => a.interaction_type === 'commented' && a.person_comment);
  const reacted  = activityFeed.filter(a => ['reacted', 'liked'].includes(a.interaction_type) && a.post_text);

  // ── Posts they published ──────────────────────────────────────────
  const postsText = posts.slice(0, 10).map((p, i) => {
    const likes    = p.post_likes    != null ? `${p.post_likes} likes`    : '';
    const cmts     = p.post_comments != null ? `${p.post_comments} comments` : '';
    const stats    = [likes, cmts].filter(Boolean).join(' | ');
    const hashtags = (p.post_hashtags || []).slice(0, 5).join(' ');
    return [
      `[Post ${i + 1}]${stats ? ` — ${stats}` : ''}${hashtags ? ` | Tags: ${hashtags}` : ''}`,
      `"${(p.post_text || '').substring(0, 1000)}"`,
    ].join('\n');
  }).join('\n\n---\n\n') || 'No original posts found.';

  // ── Comments they left ────────────────────────────────────────────
  const commentsText = comments.slice(0, 10).map((c, i) => {
    const originalPost = (c.post_text     || '').substring(0, 600);
    const theirComment = (c.person_comment || '').substring(0, 600);
    const author       = c.post_author_url ? `post by ${c.post_author_url}` : '';
    return [
      `[Comment ${i + 1}]${author ? ` (${author})` : ''}`,
      `  ORIGINAL POST : "${originalPost}"`,
      `  THEIR COMMENT : "${theirComment}"`,
    ].join('\n');
  }).join('\n\n---\n\n') || 'No comments found.';

  // ── Content they reacted/liked ────────────────────────────────────
  const reactedText = reacted.slice(0, 8).map((r, i) => {
    const hashtags = (r.post_hashtags || []).slice(0, 5).join(' ');
    return [
      `[Reacted ${i + 1}]${hashtags ? ` | Tags: ${hashtags}` : ''}`,
      `"${(r.post_text || '').substring(0, 600)}"`,
    ].join('\n');
  }).join('\n\n---\n\n') || 'No reactions found.';

  return { postsText, commentsText, reactedText };
}

// ── Main export ────────────────────────────────────────────────────────

export async function generateApifySummary(record) {
  const client    = getClient();
  const identity  = record.identity || {};
  const career    = record.career   || {};
  const firstName = identity.firstName || identity.fullName?.split(' ')[0] || 'This person';

  const { postsText, commentsText, reactedText } = formatActivity(record.activityFeed || []);

  const experienceText     = formatExperience(career.experience     || []);
  const educationText      = formatEducation(career.education       || []);
  const certificationsText = formatCertifications(career.certifications || []);
  const languagesText      = formatLanguages(career.languages       || []);
  const skillsText         = (career.skills || []).slice(0, 20).join(', ') || 'Not listed';
  const volunteerText      = (career.volunteer || []).length
    ? career.volunteer.slice(0, 3).map(v => `${v.role || ''} @ ${v.organization || ''}`).join(', ')
    : 'None listed';

  const aboutText = (identity.about || 'Not provided').substring(0, 1000);

  const activityStats = record.summary || {};

  const prompt = `You are a professional analyst preparing an outreach dossier on a LinkedIn contact.
Use ONLY the data provided below — do not invent facts.
Always refer to the person by their first name "${firstName}", never "this individual", "they", or "this person".

════════════════════════════════════════════════════
IDENTITY
════════════════════════════════════════════════════
Full Name    : ${identity.fullName       || 'Unknown'}
Headline     : ${identity.headline      || 'Unknown'}
Company      : ${identity.currentCompany || 'Unknown'} (${identity.companyIndustry || 'Unknown industry'})
Website      : ${identity.companyWebsite || 'Unknown'}
Location     : ${identity.location      || 'Unknown'}
Country      : ${identity.country       || 'Unknown'}
Email        : ${identity.email         || 'Not found'}
Followers    : ${identity.followers     || 0}
Connections  : ${identity.connections   || 0}
Premium      : ${identity.isPremium     ? 'Yes' : 'No'}
Creator Mode : ${identity.isCreator     ? 'Yes' : 'No'}

ABOUT / BIO:
${aboutText}

════════════════════════════════════════════════════
CAREER HISTORY (most recent first)
════════════════════════════════════════════════════
${experienceText}

════════════════════════════════════════════════════
EDUCATION
════════════════════════════════════════════════════
${educationText}

════════════════════════════════════════════════════
SKILLS (${(career.skills || []).length} total)
════════════════════════════════════════════════════
${skillsText}

════════════════════════════════════════════════════
CERTIFICATIONS
════════════════════════════════════════════════════
${certificationsText}

════════════════════════════════════════════════════
LANGUAGES
════════════════════════════════════════════════════
${languagesText}

════════════════════════════════════════════════════
VOLUNTEER WORK
════════════════════════════════════════════════════
${volunteerText}

════════════════════════════════════════════════════
ACTIVITY OVERVIEW
════════════════════════════════════════════════════
Total activity items : ${activityStats.totalActivityItems || 0}
Posts published      : ${(record.activityFeed || []).filter(a => a.interaction_type === 'shared').length}
Comments left        : ${(record.activityFeed || []).filter(a => a.interaction_type === 'commented').length}
Reactions/likes      : ${(record.activityFeed || []).filter(a => ['reacted','liked'].includes(a.interaction_type)).length}

════════════════════════════════════════════════════
POSTS ${firstName.toUpperCase()} PUBLISHED
(Reveals topics they believe in and want to promote publicly)
════════════════════════════════════════════════════
${postsText}

════════════════════════════════════════════════════
COMMENTS ${firstName.toUpperCase()} LEFT ON OTHERS' POSTS
(Reveals what they engage with, how they think, and what they care about)
════════════════════════════════════════════════════
${commentsText}

════════════════════════════════════════════════════
CONTENT ${firstName.toUpperCase()} REACTED OR LIKED
(Reveals passive interests and what resonates with them)
════════════════════════════════════════════════════
${reactedText}

════════════════════════════════════════════════════
YOUR TASK
════════════════════════════════════════════════════
Produce a full outreach dossier for ${firstName}. Be specific — reference real topics, post themes, comment patterns, and career facts from the data above. Never be generic.

Use straight double quotes only. Do not escape quotes inside string values — rephrase instead.
Respond ONLY with this JSON (no markdown, no explanation, no extra fields):
{
  "interests": ["4-6 specific topics ${firstName} clearly cares about based on posts/comments/reactions — be specific, not generic"],
  "expertise": ["4-6 professional skills or areas of deep knowledge from their career and skills list"],
  "summary": "3-4 sentence professional overview. Who is ${firstName}, what drives them, what do they stand for? Cite actual topics from their content and career.",
  "careerStory": "2-3 sentence career arc. What is the thread connecting their roles? What progression or pivot stands out?",
  "activityNarrative": "3-5 sentences specifically about ${firstName}'s LinkedIn activity. What specific topics did they post about? What did their comments reveal about their thinking and opinions? What content did they react to and what does that signal about their interests? Name actual topics and themes — not generalities.",
  "outreach": {
    "hook": "One specific, personalised opening line referencing something real from their posts or comments — a specific topic, opinion, or achievement. Must NOT be generic.",
    "talkingPoints": [
      "Talking point 1 — reference a specific post topic or theme they published",
      "Talking point 2 — connect to their career progression or current role context",
      "Talking point 3 — reference something from their comments or reactions that reveals their values"
    ],
    "icebreakers": [
      "Icebreaker 1 — a genuine question about something specific they posted or commented on",
      "Icebreaker 2 — a question about their career journey or a transition they made",
      "Icebreaker 3 — a question about content they reacted to or a topic they repeatedly engage with"
    ],
    "bestAngle": "In 1-2 sentences: what is the single best way to approach ${firstName}? What tone, topic, and angle will land best based on how they communicate and what they care about?"
  }
}`;

  const response = await client.chat.completions.create({
    model:       process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini',
    messages:    [{ role: 'user', content: prompt }],
    max_tokens:  3000,
    temperature: 0.3,
  });

  const raw   = response.choices[0]?.message?.content || '{}';
  const clean = raw
    .replace(/```json|```/g, '')
    .replace(/\\"/g, '"')     // fix escaped quotes
    .replace(/\\\\/g, '\\')  // fix double-escaped backslashes
    .trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    // second attempt — extract just the JSON object
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      } catch {}
    }
    console.error('[linkedin-llm] JSON parse failed:', e.message);
    console.error('[linkedin-llm] Raw response was:', raw.substring(0, 500));
    return {
      interests:         [],
      expertise:         [],
      summary:           'Could not generate summary.',
      careerStory:       '',
      activityNarrative: '',
      outreach: { hook: '', talkingPoints: [], icebreakers: [], bestAngle: '' },
    };
  }


  try {
  return JSON.parse(clean);
} catch (e) {
  console.error('[linkedin-llm] JSON parse failed:', e.message);
  console.error('[linkedin-llm] Raw response was:', raw.substring(0, 500));
  return {
    interests:         [],
    expertise:         [],
    summary:           'Could not generate summary.',
    careerStory:       '',
    activityNarrative: '',
    outreach: { hook: '', talkingPoints: [], icebreakers: [], bestAngle: '' },
  };
}
}