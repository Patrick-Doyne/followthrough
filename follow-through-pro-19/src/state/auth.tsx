/**
 * JWT authentication against the Spring Boot backend (see authService in
 * services/followthrough.ts). Session state is held client-side against
 * the backend-issued token, persisted under the `followthrough.token` and
 * `followthrough.identity` localStorage keys, and attached to every request
 * by services/http.ts.
 */

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { authService } from "@/services/followthrough";

const TOKEN_KEY = "followthrough.token";
const IDENTITY_KEY = "followthrough.identity";

export interface AuthIdentity {
  name: string;
  email: string;
}

interface AuthContextValue {
  identity: AuthIdentity | null;
  isAuthenticated: boolean;
  /** false until localStorage has been read on the client */
  isReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const [isReady, setIsReady] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    try {
      const token = window.localStorage.getItem(TOKEN_KEY);
      const stored = window.localStorage.getItem(IDENTITY_KEY);
      if (token && stored) setIdentity(JSON.parse(stored) as AuthIdentity);
    } catch {
      /* ignore unavailable storage */
    }
    setIsReady(true);
  }, []);

  const persist = useCallback(
    (token: string, next: AuthIdentity) => {
      try {
        window.localStorage.setItem(TOKEN_KEY, token);
        window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
      } catch {
        /* ignore unavailable storage */
      }
      // A second account signing in in the same tab must never see the
      // previous account's cached sessions/videos/calendar/user queries.
      queryClient.clear();
      setIdentity(next);
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await authService.login(email, password);
      persist(response.token, { name: response.user.name, email: response.user.email });
    },
    [persist],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const response = await authService.register(name, email, password);
      persist(response.token, { name: response.user.name, email: response.user.email });
    },
    [persist],
  );

  const logout = useCallback(() => {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(IDENTITY_KEY);
    } catch {
      /* ignore */
    }
    queryClient.clear();
    setIdentity(null);
  }, [queryClient]);

  const value = useMemo(
    () => ({
      identity,
      isAuthenticated: identity !== null,
      isReady,
      login,
      register,
      logout,
    }),
    [identity, isReady, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
