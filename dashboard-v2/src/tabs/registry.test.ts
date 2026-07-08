import { TAB_REGISTRY } from './registry';

const WL = {
  specialty: ['date_on','delivery_on','qty_grams','ref','description','receiver_company','status','created_at'],
  bulk: ['date_on','delivery_on','qty_grams','moisture_pct','water_activity_num','sample_ref','quality','client','country','status','created_at'],
  forwarding: ['date_on','qty_grams','sample_ref','sender','origin','receiver_company','id_number','status','created_at'],
  clients: ['name','country','latest_order_date'],
} as Record<string, string[]>;

it('every column sortKey is server-whitelisted', () => {
  for (const [tab, cfg] of Object.entries(TAB_REGISTRY)) {
    for (const c of cfg.columns) if (c.sortKey) expect(WL[tab]).toContain(c.sortKey);
  }
});

it('every tab has the correct endpoint/path pairing', () => {
  expect(TAB_REGISTRY.specialty.endpoint).toBe('/specialty-samples');
  expect(TAB_REGISTRY.specialty.path).toBe('/samples');
  expect(TAB_REGISTRY.bulk.endpoint).toBe('/bulk-samples');
  expect(TAB_REGISTRY.bulk.path).toBe('/bulk');
  expect(TAB_REGISTRY.forwarding.endpoint).toBe('/forwarding-samples');
  expect(TAB_REGISTRY.forwarding.path).toBe('/forwarding');
  expect(TAB_REGISTRY.clients.endpoint).toBe('/clients');
  expect(TAB_REGISTRY.clients.path).toBe('/clients');
});
