"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

// A modal sheet on the native <dialog>: focus trap, Escape and the backdrop come with it.
export default function Sheet({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} className={`sheet ${wide ? "wide" : ""}`} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-button small" onClick={onClose} aria-label="Close"><X /></button>
      </header>
      <div className="sheet-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}
