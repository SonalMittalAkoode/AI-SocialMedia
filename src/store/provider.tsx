"use client";
/* Browser storage is an external system. These effects hydrate after SSR and report write failures. */
/* eslint-disable react-hooks/set-state-in-effect */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  Dispatch,
  SetStateAction,
  useCallback,
} from "react";
import { DemoState } from "@/types";
import { initialState } from "@/data/fixtures";
import { parseState, serializeState, STORAGE_KEY } from "@/lib/storage";
import { MotionConfig } from "motion/react";
interface Store {
  state: DemoState;
  setState: Dispatch<SetStateAction<DemoState>>;
  ready: boolean;
  toast: (message: string) => void;
  reset: () => void;
}
const Context = createContext<Store | null>(null);
export function Provider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    try {
      const saved = parseState(localStorage.getItem(STORAGE_KEY));
      setState({
        ...saved,
        authenticated: saved.rememberSession
          ? saved.authenticated
          : sessionStorage.getItem("socialai-session") === "active",
      });
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(
          STORAGE_KEY,
          serializeState({
            ...state,
            authenticated: state.rememberSession && state.authenticated,
          }),
        );
        if (state.authenticated)
          sessionStorage.setItem("socialai-session", "active");
        else sessionStorage.removeItem("socialai-session");
      } catch {
        setMessage(
          "Browser storage is full or unavailable. Changes will last for this session.",
        );
      }
  }, [state, ready]);
  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(() => setMessage(""), 4000);
    return () => clearTimeout(timeout);
  }, [message]);
  const toast = useCallback((text: string) => setMessage(text), []);
  return (
    <Context.Provider
      value={{
        state,
        setState,
        ready,
        toast,
        reset: () => setState(initialState()),
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
