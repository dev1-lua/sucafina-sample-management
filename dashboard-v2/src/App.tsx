import { lazy, Suspense } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { useLuaChatBridge } from '@/lib/useLuaChatBridge';
import DashboardPage from '@/pages/DashboardPage';
import SampleManagementLayout from '@/pages/SampleManagementLayout';
import SampleListView from '@/pages/SampleListView';
import ClientsPage from '@/pages/ClientsPage';
import ClientDetailPage from '@/pages/ClientDetailPage';
import ChaserPage from '@/pages/ChaserPage';
import AssistantPage from '@/pages/AssistantPage';
import { TAB_REGISTRY } from '@/tabs/registry';
import type { TabKey } from '@/types';

// Lazy: DetailDrawer pulls in framer-motion + Radix Sheet/Tabs, only needed once a
// row is actually clicked — deferring it keeps those out of the initial page bundle.
const DetailDrawer = lazy(() => import('@/components/DetailDrawer').then((m) => ({ default: m.DetailDrawer })));

/** Nested `:id` child route rendered under each tab's list page. Reading the id from
 * useParams here (rather than in the parent page) is required — a parent route's
 * `element` does not receive a child route's params. Closing navigates to the tab's
 * bare path, which unmounts this route (and its useRecord query) entirely, so a
 * closed drawer never lingers as a hidden background fetch. */
function TabDrawerRoute({ tab }: { tab: TabKey }) {
  const cfg = TAB_REGISTRY[tab];
  const { id } = useParams();
  const navigate = useNavigate();

  return (
    <Suspense fallback={null}>
      <DetailDrawer
        endpoint={cfg.endpoint}
        id={id ?? ''}
        open={!!id}
        onClose={() => navigate(cfg.path)}
        fields={cfg.detailFields}
      />
    </Suspense>
  );
}

export default function App() {
  // Turn agent-rendered record links clicked inside the chat into in-app navigations.
  useLuaChatBridge();

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            {/* Sample Management: one section, three tabs. The layout renders the tab
                strip once; each tab keeps its own route (and `/:id` drawer child) so
                deep-links, highlights and record-search results are unaffected. */}
            <Route element={<SampleManagementLayout />}>
              <Route path="/samples" element={<SampleListView tab="specialty" />}>
                <Route path=":id" element={<TabDrawerRoute tab="specialty" />} />
              </Route>
              <Route path="/bulk" element={<SampleListView tab="bulk" />}>
                <Route path=":id" element={<TabDrawerRoute tab="bulk" />} />
              </Route>
              <Route path="/forwarding" element={<SampleListView tab="forwarding" />}>
                <Route path=":id" element={<TabDrawerRoute tab="forwarding" />} />
              </Route>
            </Route>
            {/* Clients drill-down is a full deep-linkable show-page (Phase 4), not a drawer
                overlaid on the list — so, unlike the three sample tabs above, `:id` is a
                sibling top-level route rather than nested under ClientsPage's <Outlet/>.
                Navigating here fully replaces the list instead of stacking a panel on it. */}
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/chaser" element={<ChaserPage />} />
            {/* Conversational data-in surface — the (heavy) Lua widget lives on
                this one route so its bundle only loads when the tab is opened. */}
            <Route path="/assistant" element={<AssistantPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
