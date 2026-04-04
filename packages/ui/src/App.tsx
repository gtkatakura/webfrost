import type { WebFrostClient } from "@webfrost/sdk";
import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { ClientContext, defaultClient } from "./context";
import { AuthProvider, useAuth } from "./context/auth";
import { ThemeProvider } from "./context/theme";
import { Layout } from "./layouts/Layout";
import { ImportPage } from "./pages/ImportPage";
import { LoginPage } from "./pages/LoginPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SnapshotDetailPage } from "./pages/SnapshotDetailPage";
import { SnapshotListPage } from "./pages/SnapshotListPage";
import { TagsPage } from "./pages/TagsPage";

function AppRoutes() {
  const { ready, isAuthenticated } = useAuth();

  // Wait for session check before rendering routes to avoid flash
  if (!ready) return null;

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <LoginPage />}
      />
      {isAuthenticated ? (
        <Route element={<Layout />}>
          <Route index element={<SnapshotListPage />} />
          <Route path="snapshots" element={<SnapshotListPage />} />
          <Route path="snapshots/:id" element={<SnapshotDetailPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="schedules" element={<SchedulesPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<PlaceholderPage title="Settings" />} />
        </Route>
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
