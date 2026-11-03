// Server-only. Who an image-route request comes from, on either backend: the signed-in admin's email, or null.

import { cookies } from "next/headers";
import { BACKEND } from "./backend";
import { SESSION_COOKIE, email_from_session } from "./auth-local";

export async function admin_email(request: Request): Promise<string | null> {
  if (BACKEND !== "firebase") {
    const jar = await cookies();
    return email_from_session(jar.get(SESSION_COOKIE)?.value);
  }
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return null;
  const { admin_auth } = await import("./firebase-admin");
  try {
    const claims = await admin_auth().verifyIdToken(token);
    return claims.admin === true ? claims.email ?? claims.uid : null;
  } catch {
    return null;
  }
}
