import { useCallback, useEffect, useRef, useState } from "react";
import { getToken, setToken, clearToken, whoami } from "./auth";
import "./GhAuthButton.css";

/**
 * Global GitHub sign-in control. Auth is the one thing that's legitimately
 * global here (one account, one token) — which repo each folder syncs to is
 * configured per-directory via the tree's right-click menu, not here.
 */
export function GhAuthButton() {
  const [open, setOpen] = useState(false);
  const [login, setLogin] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshIdentity = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLogin(null);
      return;
    }
    try {
      const identity = await whoami(token);
      setLogin(identity.login);
    } catch {
      setLogin(null);
    }
  }, []);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const identity = await whoami(tokenInput);
      setToken(tokenInput);
      setTokenInput("");
      setLogin(identity.login);
      setOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = () => {
    clearToken();
    setLogin(null);
  };

  return (
    <div className="idbfs-gh-auth" ref={panelRef}>
      <button className="idbfs-gh-auth__trigger" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        {login ?? "github: sign in"}
      </button>

      {open && (
        <div className="idbfs-gh-auth__panel">
          {login ? (
            <div className="idbfs-gh-auth__row">
              <span className="idbfs-gh-auth__label">signed in as {login}</span>
              <button className="idbfs-gh-auth__link" onClick={handleLogout}>
                sign out
              </button>
            </div>
          ) : (
            <>
              <input
                className="idbfs-gh-auth__input"
                type="password"
                placeholder="personal access token"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
              />
              <button
                className="idbfs-gh-auth__btn"
                disabled={busy || !tokenInput}
                onClick={() => void handleLogin()}
              >
                sign in
              </button>
              {error && <div className="idbfs-gh-auth__error">{error}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
