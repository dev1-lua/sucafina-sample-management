import { describe, it, expect } from 'vitest';
import { conversationFromRequest, GROUP_ASKS_ENABLED, matchParticipant, type ConversationParticipant } from './conversation';

const P: ConversationParticipant[] = [
  { userId: 'u-ivo', displayName: 'Ivo Jr.', isCurrentSpeaker: true, channelIdentity: { provider: 'teams', externalId: 't1', email: 'ivo@sucafina.com' } },
  { userId: 'u-tom', displayName: 'Tommie Schretlen', channelIdentity: { provider: 'teams', externalId: 't2', email: 'tommie.schretlen@sucafina.com' } },
  { userId: 'u-tho', displayName: 'Thomas Müller', channelIdentity: { provider: 'teams', externalId: 't3' } },
  { userId: 'u-tho2', displayName: 'Thomas Otieno' },
];

describe('conversationFromRequest — Lua.request.conversation first (lua-cli ≥ 3.36)', () => {
  it('a Teams group chat: isGroup, the Teams conversation id, the participants', () => {
    const c = conversationFromRequest({
      channel: 'teams',
      conversation: { id: 'room:1', kind: 'group', channel: 'teams', externalId: '19:abc@thread.v2', currentSpeakerId: 'u-ivo', participants: P, participantCount: 4, truncated: false },
    });
    expect(c).toMatchObject({ channel: 'teams', conversationId: '19:abc@thread.v2', isGroup: true, source: 'request.conversation' });
    expect(c.participants.map((p) => p.displayName)).toEqual(['Ivo Jr.', 'Tommie Schretlen', 'Thomas Müller', 'Thomas Otieno']);
  });

  it('a direct conversation is not a group; no externalId → no conversation id', () => {
    const c = conversationFromRequest({ channel: 'teams', conversation: { id: 'room:2', kind: 'direct', channel: 'teams', participants: [P[0]!], participantCount: 1, truncated: false } });
    expect(c).toMatchObject({ isGroup: false, conversationId: null, source: 'request.conversation' });
    expect(c.participants).toHaveLength(1);
  });

  it('no conversation on the request → the webhook payload parser, with no participants', () => {
    const c = conversationFromRequest({ channel: 'teams', webhook: { payload: { conversation: { id: '19:xyz@thread.v2', conversationType: 'groupChat' } } } });
    expect(c).toMatchObject({ conversationId: '19:xyz@thread.v2', isGroup: true, source: 'webhook.conversation', participants: [] });
  });

  it('nothing at all → a 1:1 for our purposes', () => {
    expect(conversationFromRequest(undefined)).toEqual({ channel: null, conversationId: null, isGroup: false, source: 'none', participants: [] });
  });

  it('group asks are live', () => {
    expect(GROUP_ASKS_ENABLED).toBe(true);
  });
});

describe('matchParticipant — who the speaker named, from the people in the chat', () => {
  it('whole word, case-insensitive, first name is enough', () => {
    expect(matchParticipant('tommie', P)?.userId).toBe('u-tom');
    expect(matchParticipant('Schretlen', P)?.userId).toBe('u-tom');
  });

  it('a whole-word hit beats a substring hit', () => {
    const list: ConversationParticipant[] = [{ userId: 'a', displayName: 'Tom Hardy' }, { userId: 'b', displayName: 'Tommie Schretlen' }];
    expect(matchParticipant('Tom', list)?.userId).toBe('a');
  });

  it('falls back to a substring match', () => {
    expect(matchParticipant('Schret', P)?.userId).toBe('u-tom');
  });

  it('two people match → throws listing them, never guesses', () => {
    expect(() => matchParticipant('Thomas', P)).toThrow('Several people in this chat match "Thomas": Thomas Müller, Thomas Otieno');
  });

  it('nobody → null (the roster is next)', () => {
    expect(matchParticipant('Gloria', P)).toBeNull();
    expect(matchParticipant('  ', P)).toBeNull();
  });
});
