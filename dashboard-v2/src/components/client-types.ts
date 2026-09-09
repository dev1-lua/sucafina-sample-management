import type { EventRow } from '@/types';

// Shape of a row from `client_contacts` as returned inline on `GET /clients/:id`.
export type ClientContact = {
  id: string;
  client_id: string;
  attention_to: string | null;
  full_address: string | null;
  phone: string | null;
  email: string | null;
  created_at?: string;
};

// `account_owner` on the client-detail response: a joined `traders` row, or null when unassigned.
export type AccountOwner = { id: string; name: string; role: string | null; email: string | null } | null;

// Cross-table order row union (see api/src/routes/clients.ts `orders` query against `all_samples_v`).
export type ClientOrderTab = 'specialty' | 'bulk' | 'forwarding';

export type ClientOrder = {
  tab: ClientOrderTab;
  id: string;
  ref: string | null;
  title: string | null;
  status: string | null;
  courier_norm: string | null;
  awb: string | null;
  date_on: string | null;
  delivery_on: string | null;
  result_norm: string | null;
  // Approved-sample attributes (migration 009).
  blend: string | null;
  strategy: string | null;
  highlights: string | null;
  result_on: string | null;
};

// The open "please send us your delivery details" request on a client (migration 016):
// who was asked, how, and how many times the agent has chased since. Null once delivered
// or when nobody has been asked yet.
export type ClientDetailRequest = {
  id: string;
  missing: string[];
  asked_name: string | null;
  asked_email: string | null;
  asked_by: string | null;
  note: string | null;
  via: 'teams' | 'email' | null;
  asked_at: string;
  delivered_at: string | null;
  last_chased_at: string | null;
  chase_count: number;
  escalated_at: string | null;
};

// Full `GET /clients/:id` response: the client row plus its Phase-4 drill-down relations.
export type ClientDetail = {
  id: string;
  name: string;
  country: string | null;
  account_owner_id: string | null;
  contacts: ClientContact[];
  account_owner: AccountOwner;
  orders: ClientOrder[];
  events: EventRow[];
  // Client specs (migration 009, feedback ⑯).
  spec_grades: string | null;
  spec_cup_profile: string | null;
  spec_moisture_max: number | null;
  spec_min_score: number | null;
  spec_notes: string | null;
  // Per-client phyto default (migration 010) — pre-fills new samples for this client.
  default_phyto_cert: string | null;
  // Delivery-address gap (migration 016). Optional: older API builds don't send them.
  address_missing?: boolean;
  detail_request?: ClientDetailRequest | null;
};
