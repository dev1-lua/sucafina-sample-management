import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { queryClient } from './lib/query';
import { getTheme, setTheme } from './lib/theme';
import { installFreezeDiagnostics } from './lib/freeze-diag';
import './index.css';

setTheme(getTheme()); // apply persisted/system theme before first paint
installFreezeDiagnostics(); // watch for the filter-freeze; logs the culprit when the page goes dead

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
