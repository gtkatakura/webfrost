import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import type { WebFrostClient, WebFrostError } from "@webfrost/sdk";
import { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster, toast } from "sonner";
import { ServerUnreachable } from "./components/ServerUnreachable";
import { ClientContext, defaultClient } from "./context";
import { AuthProvider, useAuth } from "./context/auth";
import { ThemeProvider } from "./context/theme";
import { Layout } from "./layouts/Layout";
import { isStatus, shouldRetry } from "./lib/errors";
import { returnToPath } from "./lib/returnTo";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ImportPage } from "./pages/ImportPage";
import { LoginPage } from "./pages/LoginPage";
import { SchedulesPage } from "./pages/SchedulesPage";
import { SearchPage } from "./pages/SearchPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { SnapshotListPage } from "./pages/SnapshotListPage";
import { TagsPage } from "./pages/TagsPage";

/** Write-only pages: a guest is sent to /login and returns here after signing in. */
function RequireWrite({ children }: { children: React.ReactNode }) {
  const { canWrite } = useAuth();
  const location = useLocation();
  if (!canWrite) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }
  return <>{children}</>;
}

function LoginRoute() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  if (isAuthenticated) return <Navigate to={returnToPath(location.state)} replace />;
  return <LoginPage />;
}

function AppRoutes() {
  const { ready, needsSetup, isAuthenticated, publicRead, bootError, retryBootstrap } = useAuth();

  // The server could not be asked at all: a login form would be a lie.
  if (bootError) return <ServerUnreachable error={bootError} onRetry={retryBootstrap} />;

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

  // Signed-in users, and anonymous visitors on a public-read instance, get the app shell.
  // Guests only reach the read-only pages; the rest are wrapped in RequireWrite.
  const canBrowse = isAuthenticated || publicRead;

  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      {canBrowse ? (
        <>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            {/* One route for the list and the detail panel over it (/snapshots/:id). */}
            <Route path="snapshots/:id?" element={<SnapshotListPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="tags" element={<TagsPage />} />
            <Route
              path="schedules"
              element={
                <RequireWrite>
                  <SchedulesPage />
                </RequireWrite>
              }
            />
            <Route
              path="import"
              element={
                <RequireWrite>
                  <ImportPage />
                </RequireWrite>
              }
            />
            <Route
              path="settings"
              element={
                <RequireWrite>
                  <SettingsPage />
                </RequireWrite>
              }
            />
            <Route
              path="settings/api-keys"
              element={
                <RequireWrite>
                  <ApiKeysPage />
                </RequireWrite>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}

const RATE_LIMIT_TOAST_ID = "rate-limited";

function notifyRateLimited(err: WebFrostError) {
  const wait =
    err.retryAfter !== undefined
      ? ` Try again in ${err.retryAfter} second${err.retryAfter === 1 ? "" : "s"}.`
      : "";
  // Fixed id so a burst of failing queries shows a single toast.
  toast.error(`The server is rate limiting requests.${wait}`, { id: RATE_LIMIT_TOAST_ID });
}

/**
 * Wires global 401 handling: when a query fails with 401 the auth state is cleared
 * (AppRoutes then redirects to /login, or keeps a guest on a public-read instance
 * where they are) and cached data is dropped.
 */
function AuthBridge({
  onUnauthorizedRef,
}: {
  onUnauthorizedRef: React.MutableRefObject<() => void>;
}) {
  const { markUnauthenticated, ready, isAuthenticated, publicRead } = useAuth();
  const queryClient = useQueryClient();
  const wasAuthenticated = useRef(false);
  onUnauthorizedRef.current = markUnauthenticated;

  // Drop cached data once signed out.
  useEffect(() => {
    const signedOut = wasAuthenticated.current && !isAuthenticated;
    wasAuthenticated.current = isAuthenticated;
    if (!ready || isAuthenticated) return;
    if (!publicRead) {
      // Pages are unmounted by now (redirect to /login).
      queryClient.clear();
    } else if (signedOut) {
      // Guest pages stay mounted: reset the cache and refetch what they show.
      queryClient.resetQueries();
    }
  }, [ready, isAuthenticated, publicRead, queryClient]);

  return null;
}

export default function App({ client = defaultClient }: { client?: WebFrostClient }) {
  const onUnauthorizedRef = useRef<() => void>(() => {});
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (err) => {
            if (isStatus(err, 401)) onUnauthorizedRef.current();
            else if (isStatus(err, 429)) notifyRateLimited(err);
          },
        }),
        // 401 always means the session is gone (a wrong current password on
        // change-password is a 403), so mutations get the same treatment as queries.
        mutationCache: new MutationCache({
          onError: (err) => {
            if (isStatus(err, 401)) onUnauthorizedRef.current();
            else if (isStatus(err, 429)) notifyRateLimited(err);
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: shouldRetry,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ClientContext.Provider value={client}>
        <ThemeProvider>
          <AuthProvider client={client}>
            <AuthBridge onUnauthorizedRef={onUnauthorizedRef} />
            <Toaster richColors position="top-right" />
            <AppRoutes />
          </AuthProvider>
        </ThemeProvider>
      </ClientContext.Provider>
    </QueryClientProvider>
  );
}
