import { describe, expect, it } from 'vitest';
import { buildSheetPayload, interpretSheetResponse } from './sheet-push';

const SESSION = { session_id: 'fb-20260918-abc123', name: 'Ivo Example', email: 'ivo@sucafina.com', role: 'trader', channel: 'teams' };

describe('buildSheetPayload', () => {
  it('carries the session identity once and one element per entry, in the order given', () => {
    const p = buildSheetPayload(SESSION, [
      { text: 'love the cards', category: 'praise', created_at: '2026-09-18T07:15:00Z' },
      { text: 'you asked me twice', category: 'bug', created_at: '2026-09-18T07:19:00Z' },
    ]);
    expect(p).toEqual({
      session_id: 'fb-20260918-abc123',
      name: 'Ivo Example',
      email: 'ivo@sucafina.com',
      role: 'trader',
      channel: 'teams',
      entries: [
        { date: '2026-09-18', time: '10:15', category: 'praise', feedback: 'love the cards' },
        { date: '2026-09-18', time: '10:19', category: 'bug', feedback: 'you asked me twice' },
      ],
    });
  });

  it('never carries a secret or session-level roll-ups', () => {
    const p = buildSheetPayload({ ...SESSION, message_count: 2, feedback_text: 'x', secret: 'nope' } as any, []) as any;
    expect(Object.keys(p).sort()).toEqual(['channel', 'email', 'entries', 'name', 'role', 'session_id']);
  });

  it('renders Nairobi time across midnight, and midnight as 00:xx', () => {
    const p = buildSheetPayload(SESSION, [
      { text: 'late', category: 'other', created_at: '2026-09-18T22:30:00Z' },
      { text: 'midnight', category: 'other', created_at: '2026-09-18T21:05:00Z' },
    ]);
    expect(p.entries[0]).toMatchObject({ date: '2026-09-19', time: '01:30' });
    expect(p.entries[1]).toMatchObject({ date: '2026-09-19', time: '00:05' });
  });

  it('an undatable entry gets blank date/time instead of throwing', () => {
    const p = buildSheetPayload(SESSION, [
      { text: 'a', category: 'other', created_at: '' },
      { text: 'b', category: 'other', created_at: 'garbage' },
    ]);
    expect(p.entries.map((e) => [e.date, e.time])).toEqual([['', ''], ['', '']]);
  });

  it('a sender missing from the roster still lands, with blanks', () => {
    const p = buildSheetPayload({ session_id: 's', name: '', email: '', role: '', channel: 'teams' }, []);
    expect(p).toMatchObject({ name: '', email: '', role: '' });
    const legacy = buildSheetPayload({ session_id: 's' } as any, []);
    expect(legacy).toMatchObject({ name: '', email: '', role: '', channel: '' });
  });
});

describe('interpretSheetResponse — HTTP 200 is not success', () => {
  it.each([
    [200, '{"ok":true,"appended":2}', { ok: true, dedup: false }],
    [200, '{"ok":true,"dedup":true}', { ok: true, dedup: true }],
    [200, '<html><body>Page not found</body></html>', { ok: false, error: 'non_json_response' }],
    [200, '{"ok":false,"error":"bad_payload"}', { ok: false, error: 'script_error: bad_payload' }],
    [200, '{"ok":false,"error":"unauthorized"}', { ok: false, error: 'script_error: unauthorized' }],
    [200, '{}', { ok: false, error: 'ok_not_true' }],
    [200, 'null', { ok: false, error: 'ok_not_true' }],
    [200, '{"ok":"true"}', { ok: false, error: 'ok_not_true' }],
    [500, '{"ok":true}', { ok: false, error: 'http_500' }],
    [302, '', { ok: false, error: 'http_302' }],
  ])('%i %s', (status, body, expected) => {
    expect(interpretSheetResponse(status as number, body as string)).toEqual(expected);
  });
});
