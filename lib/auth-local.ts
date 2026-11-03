// Server-only.
import { createHmac, timingSafeEqual } from "node:crypto";

// Stand-in for Firebase Auth on a dev machine: one admin, read from .env.local.
// The session cookie is the email plus an HMAC of it keyed by the password, so it
// survives a dev-server restart and dies when the password changes.

export const SESSION_COOKIE = "cartography_session";

type Admin = { email: string; password: string };

function local_admin(): Admin | null {
  const email = process.env.LOCAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.LOCAL_ADMIN_PASSWORD;
  return email && password ? { email, password } : null;
}

export function has_local_admin(): boolean {
  return local_admin() !== null;
}

function signature(email: string, password: string): string {
  return createHmac("sha256", password).update(email).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// The cookie value for a correct email and password; null for anything else.
export function session_for_credentials(email: string, password: string): string | null {
  const admin = local_admin();
  if (!admin || !same(email.trim().toLowerCase(), admin.email) || !same(password, admin.password)) return null;
  return `${admin.email}|${signature(admin.email, admin.password)}`;
}

// The signed-in email a cookie value proves, or null.
export function email_from_session(value: string | undefined): string | null {
  const admin = local_admin();
  if (!admin || !value) return null;
  const [email, sig] = value.split("|");
  return email === admin.email && sig && same(sig, signature(admin.email, admin.password)) ? email : null;
}
