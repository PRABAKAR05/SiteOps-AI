import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { authApi, setAccessToken } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type BootResult = { access_token: string; user: User } | null;
let bootPromise: Promise<BootResult> | null = null;

function bootSession(): Promise<BootResult> {
  if (!bootPromise) {
    bootPromise = authApi
      .refresh()
      .then((response) => response.data as BootResult)
      .catch(() => null);
  }
  return bootPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    bootSession().then((result) => {
      if (cancelled) return;
      if (result) {
        setAccessToken(result.access_token);
        setUser(result.user);
      } else {
        setAccessToken(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => {
      bootPromise = null;
      setUser(null);
    };
    window.addEventListener("siteops:unauthorized", onUnauthorized);
    return () => window.removeEventListener("siteops:unauthorized", onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await authApi.login(email, password);
    setAccessToken(response.data.access_token);
    setUser(response.data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      bootPromise = null;
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, setUser }), [user, loading, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
