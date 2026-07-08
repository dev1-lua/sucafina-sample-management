import { Outlet } from 'react-router-dom';

import { SampleTabs } from '@/components/layout/SampleTabs';

/** Shared shell for the merged Sample Management section: renders the top tab strip
 * once, then the active tab's list view via <Outlet/>. Wired as a react-router
 * layout route wrapping /samples, /bulk and /forwarding — those routes (and their
 * `/:id` drawer children) are otherwise unchanged, so the merge is navigation-only. */
export default function SampleManagementLayout() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <SampleTabs />
      <Outlet />
    </div>
  );
}
