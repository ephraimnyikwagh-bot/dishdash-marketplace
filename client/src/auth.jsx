import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import api from "./api.js";

const AuthContext = createContext(null);
const SESSION_KEY = "dishdash.session";

function getStoredSession() {
  try {
    const stored = window.localStorage.getItem(SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(getStoredSession);
  const [loading, setLoading] = useState(Boolean(getStoredSession()?.token));

  useEffect(() => {
    let active = true;
    if (!session?.token) {
      setLoading(false);
      return () => {
        active = false;
      };
    }

    api
      .get("/auth/me")
      .then(({ data }) => {
        if (!active) return;
        const nextSession = { ...session, user: data.user };
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
        setSession(nextSession);
      })
      .catch(() => {
        if (!active) return;
        window.localStorage.removeItem(SESSION_KEY);
        setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const { data } = await api.post("/auth/login", credentials);
    const nextSession = { token: data.token, user: data.user };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    return data.user;
  }, []);

  const register = useCallback(async (details) => {
    const { data } = await api.post("/auth/register", details);
    const nextSession = { token: data.token, user: data.user };
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      user: session?.user || null,
      token: session?.token || null,
      loading,
      login,
      register,
      logout
    }),
    [session, loading, login, register, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
