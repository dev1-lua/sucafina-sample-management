import { NavLink, Route, Routes } from 'react-router-dom';
import SamplesPage from './pages/SamplesPage';
import SampleDetailPage from './pages/SampleDetailPage';
import ClientsPage from './pages/ClientsPage';
import ChaserPage from './pages/ChaserPage';

export default function App() {
  return (
    <>
      <nav>
        <span className="brand">☕ Sucafina Sample Desk</span>
        <NavLink to="/">Samples</NavLink>
        <NavLink to="/clients">Clients</NavLink>
        <NavLink to="/chaser">Chaser</NavLink>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<SamplesPage />} />
          <Route path="/samples/:id" element={<SampleDetailPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/chaser" element={<ChaserPage />} />
        </Routes>
      </main>
    </>
  );
}
