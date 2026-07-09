import { Router } from 'express';
import { h, HttpError } from '../errors.js';
import { reminderBucket, REMINDER_KINDS, type ReminderKind } from '../lib/reminders.js';

export const reminders = Router();

// GET /reminders/:kind — one of courier-awb | feedback | order-placed. Read-only; the three
// reminder jobs each poll their own kind and deliver the nudge. See src/jobs/*-reminder.job.ts.
reminders.get('/:kind', h(async (req, res) => {
  const kind = req.params.kind as ReminderKind;
  if (!REMINDER_KINDS.includes(kind)) throw new HttpError(404, `unknown reminder kind: ${req.params.kind}`);
  res.json(await reminderBucket(kind));
}));
