/**
 * company-summary.js
 * Route: POST /api/company-summary/lookup
 * Body: { companyName, serperKey, firecrawlKey }
 */

import { Router } from 'express';
import { getCompanySummary } from '../services/company-intelligence.js';

export const companySummaryRouter = Router();

companySummaryRouter.post('/lookup', async (req, res) => {
  const { companyName, serperKey, firecrawlKey } = req.body;

  if (!companyName?.trim()) {
    return res.status(400).json({ error: 'Missing required field: companyName' });
  }

  // Accept from request body first, fall back to .env
 const sKey = serperKey    || process.env.SERPER_KEY;
 const fKey = firecrawlKey || process.env.FIRECRAWL_KEY;

  if (!sKey) return res.status(400).json({ error: 'Serper API key is required — add it in Settings' });
  if (!fKey) return res.status(400).json({ error: 'Firecrawl API key is required — add it in Settings' });

  try {
    console.log(`[company-summary] Looking up: ${companyName.trim()}`);
    const result = await getCompanySummary(companyName.trim(), sKey, fKey);

    if (!result || Object.keys(result).length === 0) {
      return res.status(500).json({ error: 'No data returned — check your API keys and try again' });
    }

    return res.json({ success: true, company: result });
  } catch (err) {
    console.error('[company-summary] Error:', err.message);
    console.error('[company-summary] Stack:', err.stack);
    return res.status(500).json({ error: err.message });
  }
});