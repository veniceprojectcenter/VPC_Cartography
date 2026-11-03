import { cookies } from "next/headers";
import { SESSION_COOKIE, email_from_session } from "@/lib/auth-local";
import { BACKEND } from "@/lib/backend";
import { read_table, upsert_rows } from "@/lib/csv-store";
import { TABLES, type Table } from "@/lib/rows";

// The CSV store only exists on the csv backend; on Firebase the rows are in Firestore.
const NOT_HERE = () => Response.json({ error: "This app reads its rows from Firestore." }, { status: 404 });

export async function GET() {
  if (BACKEND !== "csv") return NOT_HERE();
  const [maps, items, placements, tilesets] = await Promise.all(TABLES.map(read_table));
  return Response.json({ maps, items, placements, tilesets });
}

// Local-first editing: the CSV files are the database only on a dev machine.
// The deployed build gets Firestore instead (docs/architecture.md).
export async function POST(request: Request) {
  if (BACKEND !== "csv") return NOT_HERE();
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Editing writes local CSV files and is only on in development." }, { status: 403 });
  }
  const jar = await cookies();
  if (!email_from_session(jar.get(SESSION_COOKIE)?.value)) {
    return Response.json({ error: "you are signed out — sign in again" }, { status: 401 });
  }
  const body = (await request.json()) as { writes?: { table: Table; rows: Record<string, string>[] }[] };
  const writes = body.writes ?? [];
  if (!writes.length || writes.some((w) => !TABLES.includes(w.table) || !Array.isArray(w.rows))) {
    return Response.json({ error: "Expected { writes: [{ table, rows }] } for maps, items, placements or tilesets." }, { status: 400 });
  }
  try {
    let saved = 0;
    for (const w of writes) saved += await upsert_rows(w.table, w.rows);
    return Response.json({ saved });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
