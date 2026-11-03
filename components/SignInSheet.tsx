"use client";

import { useState } from "react";
import Sheet from "./Sheet";
import { sign_in } from "@/lib/auth-client";

export default function SignInSheet({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const who = await sign_in(email, password);
      if (who) onSignedIn(who);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <Sheet
      title="Sign in"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" form="sign-in" className="primary" disabled={pending || !email.trim() || !password}>{pending ? "Signing in…" : "Sign in"}</button>
        </>
      }
    >
      <form id="sign-in" className="form" onSubmit={submit}>
        <p className="note">Admins sign in to draw and edit. Accounts are made by an admin; there is no sign-up.</p>
        <label>Email<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></label>
        <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
