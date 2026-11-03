import { admin_email } from "@/lib/server-auth";
import { OBJECT_NAME, TILESET_ID, list_names, public_base, sign_puts } from "@/lib/image-store";

// Admins only. Two actions on one tile set:
//   { action: "sign", tileset_id, names: [...] }  -> { puts: [{ key, url, headers }] }
//   { action: "list", tileset_id }                -> { names: [...], base }
// Names are z/x/y.webp or source.<ext>; the store puts them under tilesets/<tileset_id>/.

// One request signs one batch; the uploader asks again for the next.
const MAX_NAMES = 1000;

export async function POST(request: Request) {
  if (!(await admin_email(request))) return Response.json({ error: "you are signed out — sign in again" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; tileset_id?: string; names?: unknown };
  const id = body.tileset_id ?? "";
  if (!TILESET_ID.test(id)) return Response.json({ error: "tileset_id: lowercase letters, numbers and dashes" }, { status: 400 });
  try {
    if (body.action === "list") return Response.json({ names: await list_names(id), base: await public_base(id) });
    if (body.action === "sign") {
      const names = body.names;
      if (!Array.isArray(names) || !names.length || names.length > MAX_NAMES || !names.every((n) => typeof n === "string" && OBJECT_NAME.test(n))) {
        return Response.json({ error: `names: 1 to ${MAX_NAMES} of z/x/y.webp or source.<ext>` }, { status: 400 });
      }
      return Response.json({ puts: await sign_puts(id, names, new URL(request.url).origin) });
    }
    return Response.json({ error: "action: sign or list" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
