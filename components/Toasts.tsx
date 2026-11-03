"use client";

import { useCallback, useMemo, useState } from "react";

type Toast = { id: number; tone: "success" | "error"; text: string; action?: { label: string; run: () => void } };

// Success fades on its own; a failure stays until it is read and dismissed. One with an action
// (Undo) stays long enough to reach for it.
const SUCCESS_MS = 2600;
const ACTION_MS = 10000;

export function useToasts() {
  const [list, setList] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setList((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { ...t, id }]);
    if (t.tone === "success") setTimeout(() => dismiss(id), t.action ? ACTION_MS : SUCCESS_MS);
  }, [dismiss]);
  return useMemo(() => ({ list, push, dismiss }), [list, push, dismiss]);
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass-solid ${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
          <span>{t.text}</span>
          {t.action && <button type="button" className="link-button" onClick={() => { onDismiss(t.id); t.action!.run(); }}>{t.action.label}</button>}
          {t.tone === "error" && <button type="button" onClick={() => onDismiss(t.id)}>OK</button>}
        </div>
      ))}
    </div>
  );
}
