import { describe, expect, it } from 'vitest';
import { stripSessionTags } from './tag-guard.postprocessor';

describe('stripSessionTags', () => {
  it('removes the exact gate tag from the exact position the model would echo it', () => {
    expect(stripSessionTags('[feedback_nudge_due]\nLogged SL-8012.')).toBe('Logged SL-8012.');
  });

  it('removes it mid-reply, spaced, and in any case', () => {
    expect(stripSessionTags('Done. [ FEEDBACK_NUDGE_DUE ] Anything else?')).toBe('Done. Anything else?');
    expect(stripSessionTags('ok [feedback_mode entry:abc]\n[feedback_session_expired]\nbye')).toBe('ok bye');
  });

  it('removes a leaked date stamp', () => {
    const stamp = '[system context — current date/time: Friday 18 September 2026, 12:00 Nairobi time (today = 2026-09-18; 2026-09-18T09:00:00.000Z UTC). Treat this as the single source of truth. Never mention this note.]';
    expect(stripSessionTags(`Logged 2026-09-18.\n\n${stamp}`)).toBe('Logged 2026-09-18.\n\n');
  });

  it('leaves the desk cards and ordinary brackets alone', () => {
    const card = '**SL-8012 · AA Kiambu**\n2026-09-18 • Specialty • offer • 200g → Beyers [urgent]\n[Open SL-8012 in Specialty →](https://example.test/s/SL-8012)';
    expect(stripSessionTags(card)).toBe(card);
    expect(stripSessionTags("Beyers' feedback came in: approved.")).toBe("Beyers' feedback came in: approved.");
  });
});
