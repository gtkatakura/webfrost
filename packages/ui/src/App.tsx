import type { WebFrostClient } from "@webfrost/sdk";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { ClientContext, defaultClient } from "./context";
import { AuthProvider, useAuth } from "./context/auth";
import { ThemeProvider } from "./context/theme";
import { Layout } from "./layouts/Layout";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { LoginPage } from "./pages/LoginPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { SnapshotDetailPage } from "./pages/SnapshotDetailPage";
import { SnapshotListPage } from "./pages/SnapshotListPage";
import { TagsPage } from "./pages/TagsPage";

function AppRoutes() {
  const { ready, needsSetup, isAuthenticated } = useAuth();

  // Wait for session check before rendering routes to avoid flash
  if (!ready) return null;

  if (needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      {isAuthenticated ? (
        <>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="snapshots" element={<SnapshotListPage />} />
            <Route path="snapshots/:id" element={<SnapshotDetailPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route path="schedules" element={<SchedulesPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="settings/api-keys" element={<ApiKeysPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}

export default function App({ client = defaultClient }: { client?: WebFrostClient }) {
  return (
    <ClientContext.Provider value={client}>
      <ThemeProvider>
        <AuthProvider client={client}>
          <Toaster richColors position="top-right" />
          <AppRoutes />
        </AuthProvider>
      </ThemeProvider>
    </ClientContext.Provider>
  );
}
