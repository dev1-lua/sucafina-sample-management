import { lazy, Suspense } from 'react';
import { Route, Routes, useNavigate, useParams } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import DashboardPage from '@/pages/DashboardPage';
import SamplesPage from '@/pages/SamplesPage';
import BulkPage from '@/pages/BulkPage';
import ForwardingPage from '@/pages/ForwardingPage';
import ClientsPage from '@/pages/ClientsPage';
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
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/samples" element={<SamplesPage />}>
              <Route path=":id" element={<TabDrawerRoute tab="specialty" />} />
            </Route>
            <Route path="/bulk" element={<BulkPage />}>
              <Route path=":id" element={<TabDrawerRoute tab="bulk" />} />
            </Route>
            <Route path="/forwarding" element={<ForwardingPage />}>
              <Route path=":id" element={<TabDrawerRoute tab="forwarding" />} />
            </Route>
            <Route path="/clients" element={<ClientsPage />}>
              <Route path=":id" element={<TabDrawerRoute tab="clients" />} />
            </Route>
          </Routes>
        </main>
      </div>
    </div>
  );
}
