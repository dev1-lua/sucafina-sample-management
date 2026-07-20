import type { TabKey } from '@/types';

import { TAB_REGISTRY } from './registry';

/** The three sample views that live under the merged "Sample Management" section.
 * `label` is the display text for the top tab strip (client-approved wording —
 * British "Speciality" is intentional even though the DB tab key is `specialty`).
 * The route each tab points at stays the single source of truth in TAB_REGISTRY,
 * so deep-links / drawers / highlights are unaffected by the merge. */
export const SAMPLE_TABS: ReadonlyArray<{ key: TabKey; label: string; path: string }> = [
  { key: 'specialty', label: 'Speciality Samples', path: TAB_REGISTRY.specialty.path },
  { key: 'bulk', label: 'Commercial Samples', path: TAB_REGISTRY.bulk.path },
  { key: 'forwarding', label: 'EA Forwarding', path: TAB_REGISTRY.forwarding.path },
];

/** Route prefixes that all belong to the Sample Management section — used by the
 * Header to resolve any of the three sample routes back to the one nav item. */
export const SAMPLE_PATHS: ReadonlyArray<string> = SAMPLE_TABS.map((t) => t.path);
