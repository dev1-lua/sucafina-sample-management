import express from 'express';
import { requireApiKey } from './auth.js';
import { errorHandler } from './errors.js';
import { clients } from './routes/clients.js';
import { samples } from './routes/samples.js';

export const app = express();
app.use(express.json({ limit: '1mb' }));

// CORS for the local dashboard
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type,x-api-key,x-actor');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  next();
});
app.options(/.*/, (_req, res) => res.sendStatus(204));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use(requireApiKey);
app.use('/clients', clients);
app.use('/samples', samples);

app.use(errorHandler);
