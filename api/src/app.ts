import express from 'express';
import { requireApiKey } from './auth.js';
import { errorHandler } from './errors.js';
import { clients } from './routes/clients.js';
import { samples } from './routes/samples.js';
import { stats } from './routes/stats.js';
import { tracking } from './routes/tracking.js';
import { chaser } from './routes/chaser.js';
import { specialtySamples } from './routes/specialty-samples.js';
import { bulkSamples } from './routes/bulk-samples.js';
import { forwardingSamples } from './routes/forwarding-samples.js';
import { traders } from './routes/traders.js';

export const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS for the local dashboard
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-api-key,x-actor');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(requireApiKey);
app.use('/clients', clients);
app.use('/samples', samples);
app.use('/stats', stats);
app.use('/tracking', tracking);
app.use('/chaser', chaser);
app.use('/specialty-samples', specialtySamples);
app.use('/bulk-samples', bulkSamples);
app.use('/forwarding-samples', forwardingSamples);
app.use('/traders', traders);

app.use(errorHandler);
