import type { WebFrostClient } from "@webfrost/sdk";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { isStatus } from "../lib/errors";

interface AuthState {
  /** Whether we have verified the session state with the server (true after first check). */
  ready: boolean;
  /** Whether first-run setup is needed (no admin user exists). */
  needsSetup: boolean;
  /** Whether the user is authenticated. */
  isAuthenticated: boolean;
  /** Username, if available (null for API-key auth or unauthenticated). */
  username: string | null;
  /** Whether the server lets anonymous visitors read the archive. */
  publicRead: boolean;
}

interface AuthContextValue extends AuthState {
  /** Set when the first status check failed for a reason other than "not signed in". */
  bootError: unknown;
  /** Runs the first status check again. */
  retryBootstrap: () => void;
  /** Anonymous visitor on a public-read instance: browse only, no writes. */
  isGuest: boolean;
  /** Whether write controls may be shown / write handlers may run. */
  canWrite: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Creates the admin account and returns the one-time API key. Stays in the wizard. */
  completeSetup: (username: string, password: string, setupToken?: string) => Promise<string>;
  /** Leaves the wizard for the app, signed in as the admin created by completeSetup. */
  finishSetup: (username: string) => void;
  /** Called when the server rejects a request with 401 (expired/revoked session). */
  markUnauthenticated: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  bootError: null,
  retryBootstrap: () => {},
  ready: false,
  needsSetup: false,
  isAuthenticated: false,
  username: null,
  publicRead: false,
  isGuest: false,
  canWrite: false,
  login: async () => {},
  logout: async () => {},
  completeSetup: async () => "",
  finishSetup: () => {},
  markUnauthenticated: () => {},
});

export function AuthProvider({
  client,
  children,
}: {
  client: WebFrostClient;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    needsSetup: false,
    isAuthenticated: false,
    username: null,
    publicRead: false,
  });

  // Set when the server could not be asked (down, 5xx, network): that is not "signed out".
  const [bootError, setBootError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  const retryBootstrap = useCallback(() => {
    setBootError(null);
    setAttempt((n) => n + 1);
  }, []);

  // Check setup status and session on mount (and again on Retry).
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt re-runs the check on Retry
  useEffect(() => {
    let cancelled = false;
    const settle = (next: AuthState) => {
      if (!cancelled) setState(next);
    };
    // Both questions at once: asked one after the other they cost two round trips before the first page
    // can even start loading. The session check never rejects here; its outcome is read below.
    const me = client.getMe().then(
      ({ username }) => ({ ok: true as const, username }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    client
      .getSetupStatus()
      .then(async ({ needsSetup, publicRead }) => {
        const pub = publicRead === true;
        if (needsSetup) {
          settle({
            ready: true,
            needsSetup: true,
            isAuthenticated: false,
            username: null,
            publicRead: pub,
          });
          return;
        }
        const session = await me;
        if (session.ok) {
          settle({
            ready: true,
            needsSetup: false,
            isAuthenticated: true,
            username: session.username,
            publicRead: pub,
          });
        } else {
          if (!isStatus(session.err, 401)) throw session.err;
          settle({
            ready: true,
            needsSetup: false,
            isAuthenticated: false,
            username: null,
            publicRead: pub,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (isStatus(err, 401)) {
          setState({
            ready: true,
            needsSetup: false,
            isAuthenticated: false,
            username: null,
            publicRead: false,
          });
          return;
        }
        console.error("[auth] could not reach the server:", err);
        setBootError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const login = useCallback(
    async (username: string, password: string) => {
      await client.login(username, password);
      setState((prev) => ({
        ready: true,
        needsSetup: false,
        isAuthenticated: true,
        username,
        publicRead: prev.publicRead,
      }));
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setState((prev) => ({
      ready: true,
      needsSetup: false,
      isAuthenticated: false,
      username: null,
      publicRead: prev.publicRead,
    }));
  }, [client]);

  // The wizard has a second step that shows the API key, so the app state only changes
  // in finishSetup: flipping it here would unmount the wizard before the key is seen.
  const completeSetup = useCallback(
    async (username: string, password: string, setupToken?: string): Promise<string> => {
      const { apiKey } = await client.completeSetup(username, password, setupToken);
      return apiKey;
    },
    [client],
  );

  const finishSetup = useCallback((username: string) => {
    setState((prev) => ({
      ready: true,
      needsSetup: false,
      isAuthenticated: true,
      username,
      publicRead: prev.publicRead,
    }));
  }, []);

  const markUnauthenticated = useCallback(() => {
    setState((prev) =>
      prev.isAuthenticated || !prev.ready
        ? {
            ready: true,
            needsSetup: false,
            isAuthenticated: false,
            username: null,
            // Stay on a public instance as a guest; never loops because an
            // already-unauthenticated state is returned unchanged.
            publicRead: prev.publicRead,
          }
        : prev,
    );
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        bootError,
        retryBootstrap,
        isGuest: state.publicRead && !state.isAuthenticated,
        canWrite: state.isAuthenticated,
        login,
        logout,
        completeSetup,
        finishSetup,
        markUnauthenticated,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
