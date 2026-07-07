import { NavLink, Route, Routes } from 'react-router-dom';
import SamplesPage from './pages/SamplesPage';

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
        </Routes>
      </main>
    </>
  );
}
