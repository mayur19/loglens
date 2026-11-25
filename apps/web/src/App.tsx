import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { ApiKeysPage } from './pages/keys/ApiKeysPage';
import { LoginPage } from './pages/LoginPage';
import { PendingPage } from './pages/PendingPage';
import { SearchPage } from './pages/search/SearchPage';
import { plannedItems } from './routes/navigation';
import { RequireAuth } from './routes/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/search" element={<SearchPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        {plannedItems().map((item) => (
          <Route key={item.path} path={item.path} element={<PendingPage item={item} />} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/search" replace />} />
    </Routes>
  );
}
