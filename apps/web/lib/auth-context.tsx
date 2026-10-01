"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClientError, describeApiError, isUnauthorized, platformApi, type User } from "./api";

const tokenStorageKey = "ff_companybrain_token";

type AuthState = "loading" | "authenticated" | "anonymous";

type AuthContextValue = {
  state: AuthState;
  token: string | null;
  user: User | null;
  message: string | null;
  login: (input: { username: string; password: string }) => Promise<void>;
  register: (input: { username: string; password: string; displayName?: string; teamId?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export async function revokeAndClearSession(input: {
  activeToken: string | null;
  revoke?: (token?: string | null) => Promise<unknown>;
  clearSession: () => void;
  reportFailure: (message: string) => void;
}): Promise<void> {
  try {
    await (input.revoke ?? platformApi.logout)(input.activeToken);
  } catch (error) {
    input.reportFailure(describeApiError(error));
    throw error;
  }
  input.clearSession();
}

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(tokenStorageKey);
}

function storeToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(tokenStorageKey, token);
  else window.localStorage.removeItem(tokenStorageKey);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const clearSession = useCallback((reason?: string) => {
    storeToken(null);
    setToken(null);
    setUser(null);
    setState("anonymous");
    setMessage(reason ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const storedToken = readStoredToken();

    setState("loading");
    try {
      const response = await platformApi.me(storedToken);
      setToken(storedToken);
      setUser(response.user);
      setState("authenticated");
      setMessage(null);
    } catch (error) {
      const reason = !storedToken && isUnauthorized(error) ? undefined : isUnauthorized(error) ? "登录已过期，请重新登录" : describeApiError(error);
      clearSession(reason);
    }
  }, [clearSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (input: { username: string; password: string }) => {
    setState("loading");
    setMessage(null);
    try {
      const response = await platformApi.login(input);
      storeToken(response.token);
      setToken(response.token);
      setUser(response.user);
      setState("authenticated");
    } catch (error) {
      setState("anonymous");
      if (error instanceof ApiClientError) setMessage(error.message);
      else setMessage(describeApiError(error));
      throw error;
    }
  }, []);

  const register = useCallback(async (input: {
    username: string;
    password: string;
    displayName?: string;
    teamId?: string;
  }) => {
    setState("loading");
    setMessage(null);
    try {
      await platformApi.register(input);
      const response = await platformApi.login(input);
      storeToken(response.token);
      setToken(response.token);
      setUser(response.user);
      setState("authenticated");
    } catch (error) {
      setState("anonymous");
      if (error instanceof ApiClientError) setMessage(error.message);
      else setMessage(describeApiError(error));
      throw error;
    }
  }, []);

  const logout = useCallback(async () => {
    const activeToken = token ?? readStoredToken();
    setMessage(null);
    await revokeAndClearSession({
      activeToken,
      clearSession,
      reportFailure: setMessage,
    });
  }, [clearSession, token]);

  const value = useMemo<AuthContextValue>(
    () => ({ state, token, user, message, login, register, logout, refresh }),
    [state, token, user, message, login, register, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return value;
}
