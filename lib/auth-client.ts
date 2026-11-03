// Browser side of sign-in. Same three calls the Firebase Auth adapter will expose.

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

export const signed_in_email = () => session_request("GET");
export const sign_in = (email: string, password: string) => session_request("POST", { email, password });
export const sign_out = () => session_request("DELETE");
