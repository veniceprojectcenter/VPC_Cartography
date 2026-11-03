import { read_table, upsert_rows } from "@/lib/csv-store";
import type { Table } from "@/lib/rows";

const TABLES: Table[] = ["maps", "items", "placements"];

export async function GET() {
  const [maps, items, placements] = await Promise.all(TABLES.map(read_table));
  return Response.json({ maps, items, placements });
}

// Local-first editing: the CSV files are the database only on a dev machine.
// The deployed build gets Firestore instead (docs/architecture.md).
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "Editing writes local CSV files and is only on in development." }, { status: 403 });
  }
  const body = (await request.json()) as { writes?: { table: Table; rows: Record<string, string>[] }[] };
  const writes = body.writes ?? [];
  if (!writes.length || writes.some((w) => !TABLES.includes(w.table) || !Array.isArray(w.rows))) {
    return Response.json({ error: "Expected { writes: [{ table, rows }] } for maps, items or placements." }, { status: 400 });
  }
  try {
    let saved = 0;
    for (const w of writes) saved += await upsert_rows(w.table, w.rows);
    return Response.json({ saved });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
