import { motion } from 'framer-motion';

import { Badge } from '@/components/ui/badge';
import type { HighlightEvent } from '@/lib/highlight';

// Mirror DetailDrawer's DETAIL_SLIDE_TRANSITION so the banner feels part of the
// same panel motion rather than snapping in.
const BANNER_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const;

/**
 * "✨ Just created / Just updated" strip shown when a record is opened from an
 * agent deep-link (?hl=). Uses the faint-blue `--accent` token so it reads as a
 * highlight (not an alert) and stays legible in both light and dark themes.
 */
export function HighlightBanner({ event }: { event: HighlightEvent }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={BANNER_TRANSITION}
      className="flex items-center gap-2 rounded-[4px] bg-accent px-3 py-2 text-sm text-accent-foreground"
    >
      <Badge>✨ {event === 'created' ? 'Just created' : 'Just updated'}</Badge>
      <span className="opacity-70">Opened from the assistant.</span>
    </motion.div>
  );
}
