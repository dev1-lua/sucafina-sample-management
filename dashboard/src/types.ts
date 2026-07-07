export type SampleStatus = 'requested' | 'preparing' | 'dispatched' | 'delivered' | 'results_in' | 'cancelled';

export interface Sample {
  id: string;
  ref: string | null;
  ref_raw: string | null;
  sample_type: string;
  shipment_month: string | null;
  quality: string | null;
  grade: string | null;
  qty_grams: number | null;
  qty_raw: string | null;
  client_id: string | null;
  receiver: string | null;
  requester: string | null;
  deadline: string | null;
  roast_instructions: string | null;
  status: SampleStatus;
  courier: string | null;
  awb: string | null;
  requested_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  result: string | null;
  cupping_notes: string | null;
  comments: string | null;
}

export interface SampleEvent {
  id: string;
  type: string;
  note: string | null;
  actor: string;
  created_at: string;
}

export interface Client {
  id: string;
  name: string;
  country: string | null;
  contact_count?: number;
  contacts?: { id: string; attention_to: string | null; full_address: string | null; phone: string | null; email: string | null }[];
}

export interface Stats {
  by_status: Record<string, number>;
  overdue: number;
  in_transit: number;
  awaiting_results: number;
  dispatched_this_week: number;
}

export interface DigestBucket { count: number; items: (Sample & Record<string, unknown>)[] }
export interface Digest {
  generated_at: string;
  buckets: { not_dispatched: DigestBucket; no_delivery_confirmation: DigestBucket; awaiting_results: DigestBucket };
}

export interface ListResponse<T> { data: T[]; total: number; page?: number; pageSize?: number }
