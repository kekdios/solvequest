import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type AuthMode = "demo" | "registered";

export type SessionUser = { email: string };

type SessionContextValue = {
  user: SessionUser | null;
  authLoading: boolean;
  sendOtp: (email: string) => Promise<void>;
  verifyOtp: (email: string, code: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);
const AuthModeContext = createContext<AuthMode>("demo");

export function SessionAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "include" });
      if (response.ok) {
        const data = (await response.json()) as { user?: SessionUser };
        setUser(data.user ?? null);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    setAuthLoading(true);
    void refreshUser().finally(() => setAuthLoading(false));
  }, [refreshUser]);

  const sendOtp = useCallback(async (email: string) => {
    const response = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to send verification code");
    }
  }, []);

  const verifyOtp = useCallback(async (email: string, code: string, rememberMe: boolean) => {
    const response = await fetch("/api/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, code, rememberMe }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
      user?: SessionUser;
    };
    if (!response.ok) {
      throw new Error(data.error ?? "Invalid verification code");
    }
    if (data.user) setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* still clear client */
    }
    setUser(null);
  }, []);

  const authMode: AuthMode = user ? "registered" : "demo";

  const value: SessionContextValue = {
    user,
    authLoading,
    sendOtp,
    verifyOtp,
    logout,
    refreshUser,
  };

  return (
    <SessionContext.Provider value={value}>
      <AuthModeContext.Provider value={authMode}>{children}</AuthModeContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSessionAuth(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSessionAuth must be used within SessionAuthProvider");
  }
  return ctx;
}

export function useAuthMode(): AuthMode {
  return useContext(AuthModeContext);
}

export function isDemoMode(mode: AuthMode): boolean {
  return mode === "demo";
}
