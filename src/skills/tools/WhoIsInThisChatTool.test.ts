import { describe, it, expect } from 'vitest';
import WhoIsInThisChatTool from './WhoIsInThisChatTool';
import type { Conversation } from '../../lib/conversation';

const group: Conversation = {
  channel: 'teams', conversationId: '19:abc@thread.v2', isGroup: true, source: 'request.conversation',
  participants: [
    { userId: 'u-ivo', displayName: 'Ivo Jr.', isCurrentSpeaker: true, channelIdentity: { provider: 'teams', externalId: 't1', email: 'ivo@sucafina.com' } },
    { userId: 'u-tom', displayName: 'Tommie Schretlen', channelIdentity: { provider: 'teams', externalId: 't2' } },
  ],
};

describe('who_is_in_this_chat', () => {
  it('names and emails only — never a user id or a Teams id', async () => {
    const r = await new WhoIsInThisChatTool({ conversation: async () => group }).execute({});
    expect(r).toEqual({
      group: true,
      participants: [
        { name: 'Ivo Jr.', email: 'ivo@sucafina.com', is_current_speaker: true },
        { name: 'Tommie Schretlen', is_current_speaker: false },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/u-ivo|u-tom|t1|t2|19:abc/);
  });

  it('a 1:1 chat: group false, nobody listed', async () => {
    const r = await new WhoIsInThisChatTool({ conversation: async () => ({ channel: 'teams', conversationId: null, isGroup: false, source: 'none', participants: [] }) }).execute({});
    expect(r).toMatchObject({ group: false, participants: [] });
  });
});
