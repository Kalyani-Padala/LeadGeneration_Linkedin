import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pipelineRouter } from './routes/pipeline.js';
import { exportRouter } from './routes/export.js';
import { outreachRouter } from './routes/outreach.js';
import { mapsRouter } from './routes/maps.js';
import { summaryRouter } from './routes/linkedin-summary.js';
import { apifySummaryRouter } from './routes/apify-summary.js';



const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/api/summary', summaryRouter);
app.use('/api/pipeline', pipelineRouter);
app.use('/api/export', exportRouter);
app.use('/api/outreach', outreachRouter);
app.use('/api/maps', mapsRouter);  // ← this line was missing
app.use('/api/apify-summary', apifySummaryRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`LeadGen backend running -> http://localhost:${PORT}`);
});