import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { ApiError, client } from "./api";
import type { User } from "./types";

interface AuthState {
  /** undefined = cargando; null = sin sesión. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    client.auth.me()
      .then(({ user }) => setUser(user))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) setUser(null);
        else setUser(null);
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setUser((await client.auth.login(email, password)).user);
  }, []);

  const register = useCallback(async (email: string, name: string, password: string) => {
    setUser((await client.auth.register(email, name, password)).user);
  }, []);

  const logout = useCallback(async () => {
    await client.auth.logout().catch(() => {});
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de AuthProvider");
  return ctx;
}
