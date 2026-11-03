import { cookies } from "next/headers";
import { SESSION_COOKIE, email_from_session, has_local_admin, session_for_credentials } from "@/lib/auth-local";

// Local sign-in for the CSV trial. The deployed build signs in with Firebase Auth instead.

const DEV_ONLY = { error: "Local sign-in is only on in development." };

export async function GET() {
  const jar = await cookies();
  return Response.json({ email: email_from_session(jar.get(SESSION_COOKIE)?.value) });
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return Response.json(DEV_ONLY, { status: 403 });
  if (!has_local_admin()) {
    return Response.json({ error: "No local admin is set. Copy .env.example to .env.local, fill it in and restart." }, { status: 503 });
  }
  const { email = "", password = "" } = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  const session = session_for_credentials(email, password);
  if (!session) return Response.json({ error: "That email and password do not match." }, { status: 401 });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session, { httpOnly: true, sameSite: "strict", path: "/" });
  return Response.json({ email: session.split("|")[0] });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return Response.json({ email: null });
}
