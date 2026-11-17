"use client";
/* Browser storage and cookie sessions are external systems hydrated after SSR. */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
  Dispatch,
  SetStateAction,
  useCallback,
} from "react";
import { MotionConfig } from "motion/react";
import { useCompanyPersistence } from "./use-company-persistence";
import { DemoState } from "@/types";
import { initialState } from "@/data/fixtures";
import { parseState, STORAGE_KEY } from "@/lib/storage";
import {
  AuthApiError,
  getCurrentUser,
  loginUser,
  logoutUser,
  SessionUser,
} from "@/lib/auth-api";
type AuthStatus =
  "checking" | "authenticated" | "unauthenticated" | "unavailable";
interface Store extends Omit<
  ReturnType<typeof useCompanyPersistence>,
  "loadForUser" | "clear"
> {
  state: DemoState;
  setState: Dispatch<SetStateAction<DemoState>>;
  ready: boolean;
  authStatus: AuthStatus;
  sessionError: string;
  refreshSession: () => Promise<void>;
  signIn: (
    email: string,
    password: string,
    remember: boolean,
  ) => Promise<string>;
  signOut: () => Promise<boolean>;
  isSigningOut: boolean;
  toast: (message: string) => void;
  reset: () => void;
}
const Context = createContext<Store | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const [ready, setReady] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("checking");
  const [sessionError, setSessionError] = useState("");
  const [message, setMessage] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const persistence = useCompanyPersistence(state, setState);
  const loadCompany = persistence.loadForUser;
  const loadedCompany = useRef(false);
  const legacy = useRef(initialState());
  const activeId = useRef<string | null>(null);
  const sessionVersion = useRef(0);
  const loggingOut = useRef(false);
  const toast = useCallback((text: string) => setMessage(text), []);
  const applyUser = useCallback(
    async (user: SessionUser) => {
      let restored: DemoState | undefined;
      if (activeId.current !== user.id || !loadedCompany.current) {
        activeId.current = user.id;
        restored = await loadCompany(user);
        loadedCompany.current = true;
      }
      setState((s) => restored || { ...s, user, authenticated: true });
      setSessionError("");
      setAuthStatus("authenticated");
      return restored;
    },
    [loadCompany],
  );
  const refreshSession = useCallback(async () => {
    const version = sessionVersion.current;
    try {
      const user = await getCurrentUser();
      if (version === sessionVersion.current) await applyUser(user);
    } catch (error) {
      if (version !== sessionVersion.current) return;
      setState((s) => ({ ...s, user: null, authenticated: false }));
      if (error instanceof AuthApiError && error.status === 401) {
        setAuthStatus("unauthenticated");
        setSessionError("");
      } else {
        setAuthStatus("unavailable");
        setSessionError(
          error instanceof Error
            ? error.message
            : "Session verification failed. Please try again.",
        );
      }
    }
  }, [applyUser]);
  useEffect(() => {
    let cancelled = false;
    try {
      legacy.current = parseState(localStorage.getItem(STORAGE_KEY));
      sessionStorage.removeItem("socialai-session");
    } catch {}
    setState({ ...legacy.current, user: null, authenticated: false });
    refreshSession().finally(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshSession]);
  useEffect(() => {
    if (!ready) return;
    const verify = () => {
      if (document.visibilityState === "visible" && !loggingOut.current)
        void refreshSession();
    };
    window.addEventListener("focus", verify);
    document.addEventListener("visibilitychange", verify);
    const interval = setInterval(verify, 60000);
    return () => {
      window.removeEventListener("focus", verify);
      document.removeEventListener("visibilitychange", verify);
      clearInterval(interval);
    };
  }, [ready, refreshSession]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [message]);
  async function signIn(email: string, password: string, remember: boolean) {
    ++sessionVersion.current;
    await loginUser(email, password, remember);
    // Confirm the browser accepted the cookie before opening protected screens.
    const user = await getCurrentUser();
    await applyUser(user);
    setReady(true);
    return "/dashboard";
  }
  async function signOut() {
    if (loggingOut.current) return false;
    loggingOut.current = true;
    setIsSigningOut(true);
    ++sessionVersion.current;
    try {
      await logoutUser();
      activeId.current = null;
      loadedCompany.current = false;
      persistence.clear();
      setState(initialState());
      setAuthStatus("unauthenticated");
      setSessionError("");
      return true;
    } catch (error) {
      toast(
        error instanceof Error
          ? error.message
          : "Logout failed. Please try again.",
      );
      return false;
    } finally {
      loggingOut.current = false;
      setIsSigningOut(false);
    }
  }
  function reset() {
    // Reset only simulated posts/competitors; server company records remain authoritative.
    setState((s) => ({
      ...s,
      posts: initialState().posts,
      competitorIds: [],
      customCompetitors: [],
    }));
  }
  return (
    <Context.Provider
      value={{
        ...persistence,
        state,
        setState,
        ready,
        authStatus,
        sessionError,
        refreshSession,
        signIn,
        signOut,
        isSigningOut,
        toast,
        reset,
      }}
    >
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
      {message && (
        <div className="toast" role="status">
          <span className="success-dot" />
          {message}
          <button
            aria-label="Dismiss notification"
            onClick={() => setMessage("")}
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export function useStore() {
  const store = useContext(Context);
  if (!store) throw new Error("Provider missing");
  return store;
}
