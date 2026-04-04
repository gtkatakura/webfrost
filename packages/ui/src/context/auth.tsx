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
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeSetup: (username: string, password: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue>({
  ready: false,
  needsSetup: false,
  isAuthenticated: false,
  username: null,
  login: async () => {},
  logout: async () => {},
  completeSetup: async () => "",
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
  });

  // Check setup status and session on mount
  useEffect(() => {
    client
      .getSetupStatus()
      .then(({ needsSetup }) => {
        if (needsSetup) {
          setState({ ready: true, needsSetup: true, isAuthenticated: false, username: null });
          return;
        }
        return client
          .getMe()
          .then(({ username }) => {
            setState({ ready: true, needsSetup: false, isAuthenticated: true, username });
          })
          .catch((err) => {
            const isUnauth = err instanceof WebFrostError && err.status === 401;
            if (!isUnauth) console.error("[auth] getMe error:", err);
            setState({ ready: true, needsSetup: false, isAuthenticated: false, username: null });
          });
      })
      .catch((err) => {
        console.error("[auth] getSetupStatus error:", err);
        setState({ ready: true, needsSetup: false, isAuthenticated: false, username: null });
      });
  }, [client]);

  const login = useCallback(
    async (username: string, password: string) => {
      await client.login(username, password);
      setState({ ready: true, needsSetup: false, isAuthenticated: true, username });
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setState({ ready: true, needsSetup: false, isAuthenticated: false, username: null });
  }, [client]);

  const completeSetup = useCallback(
    async (username: string, password: string): Promise<string> => {
      const { apiKey } = await client.completeSetup(username, password);
      setState({ ready: true, needsSetup: false, isAuthenticated: true, username });
      return apiKey;
    },
    [client],
  );

  return (
    <AuthContext.Provider value={{ ...state, login, logout, completeSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
