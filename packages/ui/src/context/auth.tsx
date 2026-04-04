import type { WebFrostClient } from "@webfrost/sdk";
import { WebFrostError } from "@webfrost/sdk";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

interface AuthState {
  /** Whether we have verified the session state with the server (true after first check). */
  ready: boolean;
  /** Whether the user is authenticated. */
  isAuthenticated: boolean;
  /** Username, if available (null for API-key auth or unauthenticated). */
  username: string | null;
}

interface AuthContextValue extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  ready: false,
  isAuthenticated: false,
  username: null,
  login: async () => {},
  logout: async () => {},
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
    isAuthenticated: false,
    username: null,
  });

  // Check session on mount
  useEffect(() => {
    client
      .getMe()
      .then(({ username }) => {
        setState({ ready: true, isAuthenticated: true, username });
      })
      .catch((err) => {
        // 401 means unauthenticated — any other error is unexpected but we still mark ready
        const isUnauth = err instanceof WebFrostError && err.status === 401;
        if (!isUnauth) console.error("[auth] getMe error:", err);
        setState({ ready: true, isAuthenticated: false, username: null });
      });
  }, [client]);

  const login = useCallback(
    async (username: string, password: string) => {
      await client.login(username, password);
      setState({ ready: true, isAuthenticated: true, username });
    },
    [client],
  );

  const logout = useCallback(async () => {
    await client.logout();
    setState({ ready: true, isAuthenticated: false, username: null });
  }, [client]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
