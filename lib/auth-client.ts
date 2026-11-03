// Browser side of sign-in: the local admin cookie, or Firebase Auth with the `admin` claim.

import { BACKEND } from "./backend";

async function session_request(method: "GET" | "POST" | "DELETE", body?: unknown): Promise<string | null> {
  const res = await fetch("/api/session", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { email?: string | null; error?: string };
  if (!res.ok) throw new Error(json.error ?? `sign-in failed (${res.status})`);
  return json.email ?? null;
}

async function firebase_auth() {
  const [{ firebase }, auth] = await Promise.all([import("./firebase-client"), import("firebase/auth")]);
  return { auth: firebase().auth, sdk: auth };
}

// Signed in AND an admin; anyone else counts as signed out.
export async function signed_in_email(): Promise<string | null> {
  if (BACKEND !== "firebase") return session_request("GET");
  const { auth } = await firebase_auth();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdTokenResult();
  return token.claims.admin === true ? user.email : null;
}

export async function sign_in(email: string, password: string): Promise<string | null> {
  if (BACKEND !== "firebase") return session_request("POST", { email, password });
  const { auth, sdk } = await firebase_auth();
  try {
    const { user } = await sdk.signInWithEmailAndPassword(auth, email.trim(), password);
    const token = await user.getIdTokenResult(true);
    if (token.claims.admin !== true) {
      await sdk.signOut(auth);
      throw new Error("This account is not an admin. Ask an admin to grant it.");
    }
    return user.email;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") throw new Error("That email and password do not match.");
    if (code === "auth/too-many-requests") throw new Error("Too many tries. Wait a minute and try again.");
    throw e;
  }
}

export async function sign_out(): Promise<null> {
  if (BACKEND !== "firebase") return session_request("DELETE") as Promise<null>;
  const { auth, sdk } = await firebase_auth();
  await sdk.signOut(auth);
  return null;
}

// What the image routes need to know who is asking: a Firebase ID token, or nothing (the cookie goes by itself).
export async function auth_headers(): Promise<Record<string, string>> {
  if (BACKEND !== "firebase") return {};
  const { auth } = await firebase_auth();
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
