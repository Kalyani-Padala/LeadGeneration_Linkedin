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

function sanitizeText(str) {
  return (str || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // control chars
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')        // unpaired high surrogates
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');      // unpaired low surrogates
}

// Round 1 — exactly matching n8n prompt
export async function screenComments(postContent, comments, signal) {
  if (!comments.length) return [];

  const client = getClient();

  const postContext = sanitizeText(postContent || 'business technology discussion')
    .substring(0, 600)
    .replace(/\n/g, ' ');

  const commentsText = comments
    .map((c, idx) => `${idx + 1}. Name: ${sanitizeText(c.authorName || c.commenterName || 'Unknown')}
   Title: ${sanitizeText(c.authorDesignation || c.designation || 'Unknown')}
   Comment: ${sanitizeText(c.commentText || c.comment || c.text || 'No comment')}`)
    .join('\n\n');

  const prompt = `You are a B2B sales analyst identifying potential BUYERS of AI solutions from LinkedIn comments.

POST CONTEXT (what people are commenting on):
"${postContext}"

THE ONLY QUESTION THAT MATTERS:
"Does this person have a SPECIFIC business problem they need help solving with AI?"

If YES, with specific detail → FLAG them
If NO, or too vague/generic → DO NOT FLAG

BUYER signals to look for (comment must show SPECIFIC context, not a generic phrase):
- Describes a pain point or challenge at their company, with some detail
- Asks how something works for THEIR specific use case (names their situation)
- Questions about implementation, scale, compliance, security — with context
- Mentions their team or company is evaluating or planning something specific
- Failed previous attempt they want to fix — describes what failed
- Asks about timeline, cost, or ROI
- Tags colleagues to look at something
- Expresses frustration with current tools or processes — names the tool/process

REJECT low-effort generic comments even if they sound interested:
- "Interested in this", "I'm interested in deploying this", "Would love to try this",
  "This is exactly what we need" — with no company, use case, or problem named
- Single-line comments with no specific detail are HIDDEN regardless of apparent enthusiasm
- Generic enthusiasm/agreement without a specific business context is NOT a buyer signal

SELLER signals — DO NOT FLAG:
- Comment is pitching their own services or product
- Designation says "We help companies with X" or "Helping businesses do Y"
- Offering to collaborate, partner, or work together
- Sharing their own case studies or client work
- Freelancer sharing rates or availability
- Comment contains their own website, portfolio, or contact info
- Comment gives confident, detailed technical advice/solutions unprompted —
  this is a practitioner/expert demonstrating knowledge, not a buyer with a
  need. A real buyer describes THEIR problem; they don't solve someone else's.

ROLE CHECK — title/designation data at this stage is often missing or unreliable.
Do NOT disqualify someone just because their title is "Unknown" or unclear —
seniority will be properly verified later with full profile data. Only use
this check to filter out CLEARLY disqualifying roles when the title IS known:

DO NOT FLAG (only if designation is clearly stated and matches):
- Explicitly a student, fresher, or intern
- Pure individual-contributor developer with a comment that has no business context
- Clearly a LinkedIn influencer/content creator with no company affiliation
- Anyone whose comment is clearly pitching services

If designation is "Unknown" or missing, judge PURELY on the comment content
and the buyer/seller signals above — do not let missing title data cause
an automatic HIDDEN classification.

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

  try {
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
  } catch (err) {
    // If the request itself was rejected (bad JSON body) and this chunk
    // has more than one comment, split it in half and retry each half
    // separately — isolates which specific comment is causing the issue
    // instead of silently dropping the whole chunk.
    const isBadRequest = err?.status === 400 || /invalid.*json/i.test(err?.message || '');
    if (isBadRequest && comments.length > 1) {
      console.warn(`[screenComments] Chunk of ${comments.length} failed (${err.message}) — splitting and retrying`);
      const mid = Math.ceil(comments.length / 2);
      const [firstHalf, secondHalf] = [comments.slice(0, mid), comments.slice(mid)];
      const [r1, r2] = await Promise.all([
        screenComments(postContent, firstHalf, signal).catch(() => []),
        screenComments(postContent, secondHalf, signal).catch(() => []),
      ]);
      return [...r1, ...r2];
    }
    // Single comment still failing, or non-recoverable error — give up on it.
    console.warn(`[screenComments] Comment(s) permanently failed: ${err.message}`);
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
4. Their comment shows genuine business need, curiosity, or evaluation intent — with SPECIFIC context, not generic enthusiasm
5. They are a BUYER not a SELLER of AI services, AND not a technical
   practitioner offering their own solution/expertise in the comment, AND
   their comment shows a SPECIFIC business context — not generic interest

DISQUALIFY only if:
- Person is clearly a freelancer or solopreneur with no team
- Person is clearly selling AI services to others
- Student, intern, or entry level role
- Company is purely coaching, personal development, or fitness
- Fake or unclear company context
- Company's own business IS software, IT services, AI/ML, data science, or
  technology consulting — these are peers/competitors, not buyers. Target
  customers are retail and manufacturing companies, not tech companies.
- Comment is vague/generic interest with no specific company context, use
  case, or problem described (e.g. "interested in deploying this",
  "would love to try this") — even if enthusiastic, this alone is not
  evaluation intent.
- Comment demonstrates the person giving detailed technical advice/solutions
  to the post author — this is expert/practitioner behavior, not buyer
  behavior.

DO NOT disqualify just because:
- Company size is unknown — give benefit of doubt
- Role title sounds technical — CTOs and tech leads at RETAIL/MANUFACTURING
  companies buy too (but the company's core business must not itself be
  software/IT/AI/consulting — see disqualify rule above)

IMPORTANT — USE POST CONTEXT:
- First understand what business problem or topic the POST is about
- Then evaluate whether the COMMENT is directly related to that problem
- A strong lead shows intent that is relevant to the POST (not generic discussion)
- Give higher weight if the comment reflects a real challenge, evaluation, or curiosity about the POST topic
- Ignore comments that are generic agreement, opinions, thought leadership, or unsolicited technical advice without business need

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