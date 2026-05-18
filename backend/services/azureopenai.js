import OpenAI from 'openai';

function getClient() {
  if (!process.env.AZURE_OPENAI_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
    throw new Error('Azure OpenAI credentials not configured in .env');
  }
  return new OpenAI({
    apiKey: process.env.AZURE_OPENAI_KEY,
    baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini'}`,
    defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION || '2024-02-01' },
    defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_KEY },
  });
}

// Round 1 — exactly matching n8n prompt
export async function screenComments(postContent, comments, signal) {
  const client = getClient();

  const postContext = (postContent || 'business technology discussion')
    .substring(0, 600)
    .replace(/\n/g, ' ');

  const commentsText = comments
    .map((c, idx) => `${idx + 1}. Name: ${c.authorName || c.commenterName || 'Unknown'}
   Title: ${c.authorDesignation || c.designation || 'Unknown'}
   Comment: ${c.commentText || c.comment || c.text || 'No comment'}`)
    .join('\n\n');

  const prompt = `You are a B2B sales analyst identifying potential BUYERS of AI solutions from LinkedIn comments.

POST CONTEXT (what people are commenting on):
"${postContext}"

THE ONLY QUESTION THAT MATTERS:
"Does this person have a business problem they need help solving with AI?"

If YES → FLAG them
If NO → DO NOT FLAG

BUYER signals to look for:
- Describes a pain point or challenge at their company
- Asks how something works for their use case
- Questions about implementation, scale, compliance, security
- Mentions their team or company is evaluating or planning
- Failed previous attempt they want to fix
- Asks about timeline, cost, or ROI
- Tags colleagues to look at something
- Expresses frustration with current tools or processes

SELLER signals — DO NOT FLAG:
- Comment is pitching their own services or product
- Designation says "We help companies with X" or "Helping businesses do Y"
- Offering to collaborate, partner, or work together
- Sharing their own case studies or client work
- Freelancer sharing rates or availability
- Comment contains their own website, portfolio, or contact info

ROLE CHECK — only flag if they have decision making power:
- Founder, CEO, COO, CTO, President at any company
- VP, Director, Head of, GM, MD at any company
- Manager or Senior professional at a mid to large company

DO NOT FLAG:
- Students, freshers, interns
- Pure developers with no business context
- LinkedIn influencers and content creators
- Anyone whose comment is clearly pitching services

Here are the comments:
${commentsText}

Return ONLY a JSON array (no explanation, no markdown):
[
  {
    "authorName": "...",
    "designation": "...",
    "comment": "...",
    "intentLevel": "HIGH" or "MID" or "HIDDEN",
    "reason": "one line specific buying signal"
  }
]
If none qualify return: []`;

  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 800,
    temperature: 0.2,
  }, { signal });

  const raw = response.choices[0]?.message?.content || '[]';
  const clean = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    return [];
  }
}

// Round 2 — exactly matching n8n prompt
export async function deepQualify(leadData, signal) {
  const client = getClient();

  const {
    commenterName, designation, comment, postContent,
    profile, experience, company,
    intentLevel, round1Reason,
  } = leadData;

  const currentExp = (experience || [])[0] || {};
  const pastExperience = (experience || [])
    .slice(1, 4)
    .map(e => `${e.title} at ${e.companyName}`)
    .join(', ') || 'None';

  const postCtx = postContent || 'No post context available';

  const profileSummary = `
POST CONTEXT (What this discussion is about):
${postCtx}

COMMENTER PROFILE:
Name: ${commenterName}
Headline: ${profile?.headline || designation}
Location: ${profile?.geoLocation?.fullLocation || 'Unknown'}
Current Role: ${currentExp.title || 'Unknown'}
Current Company: ${currentExp.companyName || 'Unknown'}
Past Roles: ${pastExperience}
Connections: ${profile?.connectionCount || 0}

COMPANY DETAILS:
Company Name: ${company?.name || leadData.companyName || 'Unknown'}
Industry: ${company?.industry || leadData.companyIndustry || 'Unknown'}
Company Size: ${company?.staffCount ? company.staffCount + ' employees' : 'Unknown'}
Employee Range: ${company?.employeeRange ? `${company.employeeRange.start}-${company.employeeRange.end || '+'}` : 'Unknown'}
Description: ${company?.description ? company.description.substring(0, 300) : 'Unknown'}
Website: ${company?.websiteUrl || 'Unknown'}
Followers: ${leadData.companyFollowers || 0}

LINKEDIN ACTIVITY:
Comment: ${comment}
Round 1 Intent Level: ${intentLevel}
Round 1 Reason: ${round1Reason}`.trim();

  const prompt = `You are a senior B2B sales analyst making a final qualification decision on a potential buyer lead.

Based on the full profile and company information below, decide if this person is a QUALIFIED LEAD worth reaching out to for AI solutions, automation tools, or AI consulting services.

A QUALIFIED LEAD must meet MOST of these:
1. Works at a real company that could genuinely benefit from AI
2. Has decision making power OR significant influence (not just junior)
3. Company has at least 5 employees
4. Their comment shows genuine business need, curiosity, or evaluation intent
5. They are a BUYER not a SELLER of AI services

DISQUALIFY only if:
- Person is clearly a freelancer or solopreneur with no team
- Person is clearly selling AI services to others
- Student, intern, or entry level role
- Company is purely coaching, personal development, or fitness
- Fake or unclear company context

DO NOT disqualify just because:
- Company is in IT services — they can still buy AI tools
- Person asks technical questions — they may be evaluating
- Company size is unknown — give benefit of doubt
- Role title sounds technical — CTOs and tech leads buy too

IMPORTANT — USE POST CONTEXT:
- First understand what business problem or topic the POST is about
- Then evaluate whether the COMMENT is directly related to that problem
- A strong lead shows intent that is relevant to the POST (not generic discussion)
- Give higher weight if the comment reflects a real challenge, evaluation, or curiosity about the POST topic
- Ignore comments that are generic agreement, opinions, or thought leadership without business need

Here is the full profile:
${profileSummary}

Respond ONLY with JSON (no explanation, no markdown):
{
  "isQualifiedLead": true or false,
  "confidenceScore": 1-10,
  "companySize": "small/mid/enterprise",
  "decisionMakerLevel": "high/medium/low",
  "reason": "one line final qualification reason"
}`;

  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 500,
    temperature: 0.2,
  }, { signal });

  const raw = response.choices[0]?.message?.content || '{}';
  const clean = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    return { isQualifiedLead: false, confidenceScore: 0 };
  }
}


// ── ADD THIS FUNCTION TO THE BOTTOM OF azureopenai.js ────────────────

export async function generateSummary({ profile, posts, comments, name = '' }) {
  const client = getClient();

  // ── Posts this person WROTE ────────────────────────────────────────
  const postsText = posts.slice(0, 10).map((p, i) => {
    const date = p.postDate || p.postTimestamp || 'unknown date';
    const content = (p.postContent || '').substring(0, 500);
    const likes = p.likeCount || 0;
    const commentsCount = p.commentCount || 0;
    return `[Post ${i + 1}] — ${date} | ${likes} likes | ${commentsCount} comments
"${content}"`;
  }).join('\n\n---\n\n') || 'No recent posts found.';

  // ── Comments this person LEFT on others posts ──────────────────────
  const commentsText = comments.slice(0, 10).map((c, i) => {
    const date = c.postDate || c.postTimestamp || 'unknown date';
    const originalAuthor = c.author || 'Unknown person';
    const originalPost = (c.postContent || '').substring(0, 300);
    const theirComment = (c.commentContent || '').substring(0, 300);

    return `[Comment ${i + 1}] — ${date}
  ORIGINAL POST by ${originalAuthor}:
  "${originalPost}"

  WHAT ${(profile.firstName || 'THEY').toUpperCase()} COMMENTED:
  "${theirComment}"`;
  }).join('\n\n---\n\n') || 'No recent comments found.';

  const prompt = `You are a professional analyst. Based on this person's LinkedIn profile and recent activity, write a clear and insightful summary of who this person is.

════════════════════════════════
PROFILE
════════════════════════════════
════════════════════════════════
PROFILE
════════════════════════════════
Name: ${profile.firstName ? `${profile.firstName} ${profile.lastName}` : name}
Title: ${profile.linkedinJobTitle || 'See activity below'}
Company: ${profile.companyName || 'Unknown'}
Industry: ${profile.companyIndustry || 'Unknown'}
Location: ${profile.location || 'Unknown'}
About: ${(profile.linkedinDescription || 'Not provided — infer from activity below').substring(0, 500)}
Skills: ${profile.linkedinSkillsLabel || 'See activity below'}

════════════════════════════════
POSTS THIS PERSON PUBLISHED (last 30 days)
════════════════════════════════
${postsText}

════════════════════════════════
COMMENTS THIS PERSON MADE ON OTHER PEOPLE'S POSTS (last 30 days)
Each entry shows the original post they responded to AND what they wrote.
This reveals what topics they engage with and how they think.
════════════════════════════════
${commentsText}

════════════════════════════════
YOUR TASK
════════════════════════════════
Write a professional summary of ${profile.firstName || name.split(' ')[0]} covering:
1. Who they are professionally — always use their name "${profile.firstName || name.split(' ')[0]}", never say "this individual" or "they"
2. What topics they clearly care about based on their posts and comments
3. How they think and communicate
4. What kind of professional they are

IMPORTANT: Use the person's first name throughout. Never use "this individual", "they", or "this person".

Respond ONLY with this JSON (no markdown, no explanation):
{
  "interests": ["topic1", "topic2", "topic3", "topic4"],
  "expertise": ["skill1", "skill2", "skill3"],
  "summary": "A clear 3-4 sentence summary of who this person is, what drives them, and what they care about professionally. Be specific — reference actual topics from their posts and comments, not generic statements."
}`;

  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
    temperature: 0.3,
  });

  const raw = response.choices[0]?.message?.content || '{}';
  const clean = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch {
    return {
      interests: [],
      expertise: [],
      summary: 'Could not generate summary.',
    };
  }
}