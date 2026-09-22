import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../../lib/notify', async (orig) => ({
  ...(await orig<typeof import('../../lib/notify')>()),
  loadTraders: vi.fn(),
}));
import { apiFetch } from '../../lib/api';
import { loadTraders } from '../../lib/notify';
import RequestMissingDetailsTool from './RequestMissingDetailsTool';
import type { Conversation } from '../../lib/conversation';

const api = apiFetch as unknown as ReturnType<typeof vi.fn>;
const traders = loadTraders as unknown as ReturnType<typeof vi.fn>;

const GROUP: Conversation = {
  channel: 'teams', conversationId: '19:abc@thread.v2', isGroup: true, source: 'request.conversation',
  participants: [
    { userId: 'u-ivo', displayName: 'Ivo Jr.', isCurrentSpeaker: true, channelIdentity: { provider: 'teams', externalId: 't1', email: 'ivo@sucafina.com' } },
    { userId: 'u-tom', displayName: 'Tommie Schretlen', channelIdentity: { provider: 'teams', externalId: 't2', email: 'tommie.schretlen@sucafina.com' } },
    { userId: 'u-gl', displayName: 'Gloria Wanjiru', channelIdentity: { provider: 'teams', externalId: 't3' } },
    { userId: 'u-ext', displayName: 'Jane Edmax', channelIdentity: { provider: 'teams', externalId: 't4', email: 'jane@edmax.co.ke' } },
  ],
};

/** The API as request_missing_details sees it: one logged Commercial sample for Beyers, no address on file. */
function wireApi(posted: any[]) {
  api.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/samples/resolve')) return { candidates: [{ tab: 'bulk', id: 'b1', ref: 'TYPE-113', receiver: 'Beyers', status: 'requested', date_on: '2026-09-22' }] };
    if (path === '/bulk-samples/b1') return { id: 'b1', sample_ref: 'TYPE-113', client_id: 'c1', quality: 'AB FAQ', qty_grams: 300, sample_type_norm: 'type', requested_by: 'Ivo Jr.' };
    if (path === '/clients/c1') return { id: 'c1', name: 'Beyers', country: 'Belgium', contacts: [], account_owner: null };
    if (path.startsWith('/search?')) return { data: [{ ref: 'TYPE-113' }] };
    if (path === '/clients/c1/detail-requests') { posted.push(['detail-requests', JSON.parse(String(init?.body))]); return { ok: true }; }
    if (path === '/traders' && init?.method === 'POST') { const b = JSON.parse(String(init.body)); posted.push(['traders', b]); return { id: 't-new', ...b }; }
    // resolveOrCreatePerson reads the roster through the module-internal loadTraders → the API; same rows as the mock.
    if (path === '/traders') return { data: await traders() };
    if (path.startsWith('/traders/') && init?.method === 'PATCH') { const b = JSON.parse(String(init.body)); posted.push(['traders-patch', b]); return { id: path.split('/')[2], name: 'Gloria', role: 'trader', active: true, ...b }; }
    throw new Error(`unexpected ${path} ${init?.method ?? 'GET'}`);
  });
}

/** `deliverResult` is what the 1:1 leg reports ('email' by default; 'teams' = a warm DM landed). */
function tool(o: { conversation?: Conversation; deliverGroup?: any; deliverResult?: 'teams' | 'email' | null } = {}) {
  const groupPosts: any[] = [];
  const mails: any[] = [];
  const t = new RequestMissingDetailsTool({
    conversation: async () => o.conversation ?? GROUP,
    deliverGroup: o.deliverGroup ?? (async (x: any) => { groupPosts.push(x); return true; }),
    deliver: async (x: any) => { mails.push(x); return o.deliverResult === undefined ? ('email' as const) : o.deliverResult; },
    groupAsks: true,
  });
  return { t, groupPosts, mails };
}

beforeEach(() => { api.mockReset(); traders.mockReset(); });

describe('request_missing_details — the person named is looked up among the people in this chat first', () => {
  it('participant with an internal email who is not on the roster → added via POST /traders, asked by display name, emailed there', async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([{ id: 'r1', name: 'Ivo', email: 'ivo@sucafina.com', role: 'trader', active: true }]);
    const { t, groupPosts, mails } = tool();
    const r = await t.execute({ sample_ref: 'TYPE-113', to_name: 'Tommie', missing: ['full street address'] });

    expect(posted.find((p) => p[0] === 'traders')?.[1]).toMatchObject({ name: 'Tommie Schretlen', email: 'tommie.schretlen@sucafina.com', role: 'trader' });
    expect(groupPosts).toHaveLength(1);
    expect(groupPosts[0].conversationId).toBe('19:abc@thread.v2');
    expect(groupPosts[0].text.startsWith('@Tommie Schretlen — ')).toBe(true);
    expect(mails[0]).toMatchObject({ email: 'tommie.schretlen@sucafina.com', emailOnly: true });
    expect(r).toMatchObject({ delivered: true, via: 'group', to: { name: 'Tommie Schretlen', email: 'tommie.schretlen@sucafina.com' }, also_emailed: true, recorded: true });
    expect(posted.find((p) => p[0] === 'detail-requests')?.[1]).toMatchObject({ asked_name: 'Tommie Schretlen', asked_email: 'tommie.schretlen@sucafina.com', asked_trader_id: 't-new', via: 'group' });
  });

  it('participant without an email → the roster supplies it; the group post still uses the chat display name', async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([{ id: 'r2', name: 'Gloria', email: 'gloria@sucafina.com', role: 'trader', active: true }]);
    const { t, groupPosts, mails } = tool();
    const r = await t.execute({ sample_ref: 'TYPE-113', to_name: 'gloria', missing: ['full street address'] });
    expect(posted.find((p) => p[0] === 'traders')).toBeUndefined();
    expect(groupPosts[0].text.startsWith('@Gloria Wanjiru — ')).toBe(true);
    expect(mails[0].email).toBe('gloria@sucafina.com');
    expect(r).toMatchObject({ delivered: true, via: 'group', to: { name: 'Gloria', email: 'gloria@sucafina.com' } });
  });

  it("a participant's external email is never used — that is the client, not a colleague", async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([]);
    const { t, groupPosts } = tool();
    const r = await t.execute({ sample_ref: 'TYPE-113', to_name: 'Jane', missing: ['full street address'] });
    expect(posted.find((p) => p[0] === 'traders')).toBeUndefined();
    expect(groupPosts).toHaveLength(0);
    expect(r).toMatchObject({ delivered: false, via: null, needs_email: true, recorded: true });
    expect(r.reason).toMatch(/not on the roster/);
  });

  it('nobody in the chat by that name → the roster; the ask is NOT posted into a chat they are not in — it goes to them (DM, else email)', async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([{ id: 'r3', name: 'Muki', email: 'muki@sucafina.com', role: 'trader', active: true }]);
    const { t, groupPosts, mails } = tool();
    const r = await t.execute({ sample_ref: 'TYPE-113', to_name: 'Muki', missing: ['full street address'] });
    expect(groupPosts).toHaveLength(0);
    expect(mails[0]).toMatchObject({ email: 'muki@sucafina.com', emailOnly: false });
    expect(r).toMatchObject({ delivered: true, via: 'email', to: { name: 'Muki', email: 'muki@sucafina.com' } });
    expect(r).not.toHaveProperty('group_conversation');
    expect(posted.find((p) => p[0] === 'detail-requests')?.[1]).toMatchObject({ asked_name: 'Muki', via: 'email' });
  });

  it('to_email of someone IN this chat → the group post still goes, addressed by their chat display name, and the DM is skipped', async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([{ id: 'r5', name: 'Tommie', email: 'tommie.schretlen@sucafina.com', role: 'trader', active: true }]);
    const { t, groupPosts, mails } = tool();
    const r = await t.execute({ sample_ref: 'TYPE-113', to_email: 'Tommie.Schretlen@sucafina.com', missing: ['full street address'] });
    expect(groupPosts).toHaveLength(1);
    expect(groupPosts[0].text.startsWith('@Tommie Schretlen — ')).toBe(true);
    expect(mails[0]).toMatchObject({ email: 'tommie.schretlen@sucafina.com', emailOnly: true });
    expect(r).toMatchObject({ delivered: true, via: 'group', also_emailed: true });
  });

  it('to_email of a colleague who is NOT in this chat → no group post; the 1:1 path (DM, else email) even from a group', async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([{ id: 'r6', name: 'Omar', email: 'omar@sucafina.com', role: 'trader', active: true }]);
    const { t, groupPosts, mails } = tool({ deliverResult: 'teams' });
    const r = await t.execute({ sample_ref: 'TYPE-113', to_email: 'omar@sucafina.com', missing: ['full street address'] });
    expect(groupPosts).toHaveLength(0);
    expect(mails[0]).toMatchObject({ email: 'omar@sucafina.com', emailOnly: false });
    expect(r).toMatchObject({ delivered: true, via: 'teams', to: { name: 'Omar', email: 'omar@sucafina.com' } });
    expect(r).not.toHaveProperty('group_conversation');
  });

  it('in a 1:1 the participants play no part: roster match, Teams DM / email as before', async () => {
    const posted: any[] = [];
    wireApi(posted);
    traders.mockResolvedValue([{ id: 'r4', name: 'Tommie', email: 'tommie@sucafina.com', role: 'trader', active: true }]);
    const { t, groupPosts, mails } = tool({ conversation: { channel: 'teams', conversationId: null, isGroup: false, source: 'none', participants: [] } });
    const r = await t.execute({ sample_ref: 'TYPE-113', to_name: 'Tommie', missing: ['full street address'] });
    expect(groupPosts).toHaveLength(0);
    expect(mails[0]).toMatchObject({ email: 'tommie@sucafina.com', emailOnly: false });
    expect(r).toMatchObject({ delivered: true, via: 'email', to: { name: 'Tommie', email: 'tommie@sucafina.com' } });
  });
});
