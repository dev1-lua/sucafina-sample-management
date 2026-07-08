import { Routes, Route } from 'react-router-dom';

import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import DashboardPage from '@/pages/DashboardPage';
import SamplesPage from '@/pages/SamplesPage';
import BulkPage from '@/pages/BulkPage';
import ForwardingPage from '@/pages/ForwardingPage';
import ClientsPage from '@/pages/ClientsPage';

export default function App() {
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/samples/*" element={<SamplesPage />} />
            <Route path="/bulk/*" element={<BulkPage />} />
            <Route path="/forwarding/*" element={<ForwardingPage />} />
            <Route path="/clients/*" element={<ClientsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
