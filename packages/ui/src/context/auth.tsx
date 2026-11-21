import type { WebFrostClient } from "@webfrost/sdk";
import { WebFrostError } from "@webfrost/sdk";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

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
  /** Anonymous visitor on a public-read instance: browse only, no writes. */
  isGuest: boolean;
  /** Whether write controls may be shown / write handlers may run. */
  canWrite: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeSetup: (username: string, password: string) => Promise<string>;
  /** Called when the server rejects a request with 401 (expired/revoked session). */
  markUnauthenticated: () => void;
}

const AuthContext = createContext<AuthContextValue>({
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

  // Check setup status and session on mount
  useEffect(() => {
    client
      .getSetupStatus()
      .then(({ needsSetup, publicRead }) => {
        const pub = publicRead === true;
        if (needsSetup) {
          setState({
            ready: true,
            needsSetup: true,
            isAuthenticated: false,
            username: null,
            publicRead: pub,
          });
          return;
        }
        return client
          .getMe()
          .then(({ username }) => {
            setState({
              ready: true,
              needsSetup: false,
              isAuthenticated: true,
              username,
              publicRead: pub,
            });
          })
          .catch((err) => {
            const isUnauth = err instanceof WebFrostError && err.status === 401;
            if (!isUnauth) console.error("[auth] getMe error:", err);
            setState({
              ready: true,
              needsSetup: false,
              isAuthenticated: false,
              username: null,
              publicRead: pub,
            });
          });
      })
      .catch((err) => {
        console.error("[auth] getSetupStatus error:", err);
        setState({
          ready: true,
          needsSetup: false,
          isAuthenticated: false,
          username: null,
          publicRead: false,
        });
      });
  }, [client]);

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

  const completeSetup = useCallback(
    async (username: string, password: string): Promise<string> => {
      const { apiKey } = await client.completeSetup(username, password);
      setState((prev) => ({
        ready: true,
        needsSetup: false,
        isAuthenticated: true,
        username,
        publicRead: prev.publicRead,
      }));
      return apiKey;
    },
    [client],
  );

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
        isGuest: state.publicRead && !state.isAuthenticated,
        canWrite: state.isAuthenticated,
        login,
        logout,
        completeSetup,
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
