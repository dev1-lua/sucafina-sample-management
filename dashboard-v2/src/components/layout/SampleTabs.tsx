import { NavLink } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { SAMPLE_TABS } from '@/tabs/sample-tabs';

/** Segmented tab strip at the top of the Sample Management section. Each tab is a
 * NavLink to its own route (/samples · /bulk · /forwarding), so switching tabs is a
 * real navigation — the URL keeps uniquely identifying the active view and every
 * existing deep-link / row-drawer lands on the correct tab. NavLink's default
 * prefix matching keeps the tab active while a row drawer (`/samples/:id`) is open. */
export function SampleTabs() {
  return (
    <div role="tablist" aria-label="Sample Management views" className="grid grid-cols-3 gap-3">
      {SAMPLE_TABS.map(({ key, label, path }) => (
        <NavLink
          key={key}
          to={path}
          role="tab"
          className={({ isActive }) =>
            cn(
              'flex items-center justify-center rounded-[8px] border px-4 py-2 text-sm font-medium transition-colors duration-150',
              isActive
                ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          {label}
        </NavLink>
      ))}
    </div>
  );
}
