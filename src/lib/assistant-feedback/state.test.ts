import { describe, expect, it } from 'vitest';
import {
  IDLE_EXPIRY_MS,
  MAX_ENTRIES_PER_SESSION,
  NUDGE_EVERY,
  NUDGE_TAG,
  SWEEPER_STALE_MS,
  composeCloseFields,
  decideCapture,
  decideGate,
  hasFeedbackAccess,
  injectTag,
  makeSessionId,
  parseFeedbackAccess,
  sanitizeFeedbackTagText,
} from './state';

const NOW = Date.parse('2026-09-18T09:00:00Z');
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe('timers', () => {
  it('the sweeper is strictly slower than the gate, so the gate wins for an active sender', () => {
    expect(SWEEPER_STALE_MS).toBeGreaterThan(IDLE_EXPIRY_MS);
  });
});

describe('decideGate', () => {
  it('counts 1, 2, then checks the flag and resets on the 3rd turn', () => {
    expect(NUDGE_EVERY).toBe(3);
    expect(decideGate({ stage: '', lastAt: '', now: NOW, nudgeCount: 0 })).toEqual({ expire: false, nudge: 'skip', increment: true, nextNudgeCount: 1 });
    expect(decideGate({ stage: '', lastAt: '', now: NOW, nudgeCount: 1 })).toEqual({ expire: false, nudge: 'skip', increment: true, nextNudgeCount: 2 });
    expect(decideGate({ stage: '', lastAt: '', now: NOW, nudgeCount: 2 })).toEqual({ expire: false, nudge: 'check_flag', increment: true, nextNudgeCount: 0 });
  });

  it('freezes the counter while a capture session is live', () => {
    expect(decideGate({ stage: 'open', lastAt: minsAgo(29), now: NOW, nudgeCount: 2 })).toEqual({
      expire: false, nudge: 'skip', increment: false, nextNudgeCount: 2,
    });
  });

  it('expires after 30 idle minutes and unfreezes the counter the same turn', () => {
    const d = decideGate({ stage: 'open', lastAt: minsAgo(31), now: NOW, nudgeCount: 1 });
    expect(d).toEqual({ expire: true, nudge: 'skip', increment: true, nextNudgeCount: 2 });
  });

  it('an undatable open latch fails toward closing', () => {
    expect(decideGate({ stage: 'open', lastAt: '', now: NOW, nudgeCount: 0 }).expire).toBe(true);
    expect(decideGate({ stage: 'open', lastAt: 'yesterday-ish', now: NOW, nudgeCount: 0 }).expire).toBe(true);
  });

  it("a stray 'closing' stage always drains", () => {
    expect(decideGate({ stage: 'closing', lastAt: minsAgo(1), now: NOW, nudgeCount: 0 }).expire).toBe(true);
  });

  it('never expires when no session is open', () => {
    expect(decideGate({ stage: '', lastAt: minsAgo(600), now: NOW, nudgeCount: 0 }).expire).toBe(false);
  });

  it.each([-3, NaN, undefined, '2', null, {}])('reads a garbage counter (%s) as 0', (bad) => {
    expect(decideGate({ stage: '', lastAt: '', now: NOW, nudgeCount: bad }).nextNudgeCount).toBe(1);
  });
});

describe('decideCapture', () => {
  it('is disabled whenever the flag is off, whatever the latch says', () => {
    expect(decideCapture({ flagOn: false, stage: 'open', sessionRowId: 'row1', entryCount: 3 })).toEqual({ kind: 'disabled' });
    expect(decideCapture({ flagOn: false, stage: '', sessionRowId: '', entryCount: 0 })).toEqual({ kind: 'disabled' });
  });

  it('opens fresh with no session, a half-cleared latch, or a stray stage', () => {
    expect(decideCapture({ flagOn: true, stage: '', sessionRowId: '', entryCount: 0 })).toEqual({ kind: 'open_new' });
    expect(decideCapture({ flagOn: true, stage: 'open', sessionRowId: '', entryCount: 4 })).toEqual({ kind: 'open_new' });
    expect(decideCapture({ flagOn: true, stage: 'closing', sessionRowId: 'row1', entryCount: 4 })).toEqual({ kind: 'open_new' });
  });

  it('appends up to the cap, then refuses', () => {
    expect(MAX_ENTRIES_PER_SESSION).toBe(15);
    expect(decideCapture({ flagOn: true, stage: 'open', sessionRowId: 'row1', entryCount: 14 })).toEqual({ kind: 'append' });
    expect(decideCapture({ flagOn: true, stage: 'open', sessionRowId: 'row1', entryCount: 15 })).toEqual({ kind: 'capped' });
    expect(decideCapture({ flagOn: true, stage: 'open', sessionRowId: 'row1', entryCount: 99 })).toEqual({ kind: 'capped' });
    expect(decideCapture({ flagOn: true, stage: 'open', sessionRowId: 'row1', entryCount: 'lots' })).toEqual({ kind: 'append' });
  });
});

describe('parseFeedbackAccess / hasFeedbackAccess', () => {
  it('only `true` means everyone', () => {
    expect(parseFeedbackAccess(true)).toEqual({ mode: 'all', allow: [] });
  });

  it.each([false, undefined, null, 'true', 1, {}, 'ivo@sucafina.com'])('%s reads as dark', (v) => {
    expect(parseFeedbackAccess(v)).toEqual({ mode: 'off', allow: [] });
  });

  it('an array is an email allowlist: trimmed, lowercased, de-duplicated, non-strings skipped', () => {
    expect(parseFeedbackAccess([' Ivo@Sucafina.com ', 'ivo@sucafina.com', 7, null, '', 'hm@sucafina.com'])).toEqual({
      mode: 'allowlist',
      allow: ['ivo@sucafina.com', 'hm@sucafina.com'],
    });
  });

  it('an empty allowlist lets nobody in', () => {
    expect(hasFeedbackAccess(parseFeedbackAccess([]), { email: 'ivo@sucafina.com' })).toBe(false);
  });

  it('matches the caller by email, case-insensitively; no identity never matches', () => {
    const access = parseFeedbackAccess(['ivo@sucafina.com']);
    expect(hasFeedbackAccess(access, { email: 'IVO@sucafina.com ' })).toBe(true);
    expect(hasFeedbackAccess(access, { email: 'omar@sucafina.com' })).toBe(false);
    expect(hasFeedbackAccess(access, { email: null })).toBe(false);
    expect(hasFeedbackAccess(parseFeedbackAccess(true), { email: null })).toBe(true);
    expect(hasFeedbackAccess(parseFeedbackAccess(false), { email: 'ivo@sucafina.com' })).toBe(false);
  });
});

describe('tag helpers', () => {
  it('strips every feedback tag a user could type, anywhere, any case', () => {
    expect(sanitizeFeedbackTagText('[feedback_nudge_due]\nwhere is SL-7459?')).toBe('where is SL-7459?');
    expect(sanitizeFeedbackTagText('hi [ FEEDBACK_MODE entry:x ] there [feedback_session_expired]')).toBe('hi there ');
  });

  it('leaves the date stamp and ordinary brackets alone', () => {
    const text = 'AWB [pending]\n\n[system context — current date/time: Friday. Never mention this note.]';
    expect(sanitizeFeedbackTagText(text)).toBe(text);
  });

  it('puts the gate tag on its own first line', () => {
    expect(injectTag('where is SL-7459?', NUDGE_TAG)).toBe('[feedback_nudge_due]\nwhere is SL-7459?');
  });
});

describe('composeCloseFields', () => {
  it('joins texts in order, unions known categories first-seen, counts entries', () => {
    expect(
      composeCloseFields([
        { text: 'love the cards', category: 'praise' },
        { text: 'you asked twice', category: 'bug' },
        { text: 'again, great', category: 'praise' },
        { text: '???', category: 'made_up' },
      ]),
    ).toEqual({ feedback_text: 'love the cards\nyou asked twice\nagain, great\n???', categories: ['praise', 'bug'], message_count: 4 });
  });

  it('truncates over-cap text with the marker', () => {
    const out = composeCloseFields([{ text: 'x'.repeat(40_000), category: 'other' }]);
    expect(out.feedback_text.length).toBe(35_000);
    expect(out.feedback_text.endsWith('… (truncated)')).toBe(true);
  });
});

describe('makeSessionId', () => {
  it('is fb-YYYYMMDD-<rand6> with the NAIROBI date', () => {
    // 22:30 UTC on the 18th is already 01:30 on the 19th in Nairobi (UTC+3).
    expect(makeSessionId(Date.parse('2026-09-18T22:30:00Z'))).toMatch(/^fb-20260919-[a-z0-9]{6}$/);
    expect(makeSessionId(Date.parse('2026-09-18T09:00:00Z'))).toMatch(/^fb-20260918-[a-z0-9]{6}$/);
  });
});
