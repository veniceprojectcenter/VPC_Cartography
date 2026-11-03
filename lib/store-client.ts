// Browser side of the row store: the local CSV files or Firestore, by lib/backend.ts.

import { BACKEND } from "./backend";
import type { ItemRow, MapRow, PlacementRow, Table, TilesetRow } from "./rows";

export type Dataset = { maps: MapRow[]; items: ItemRow[]; placements: PlacementRow[]; tilesets: TilesetRow[] };
export type Write = { table: Table; rows: (MapRow | ItemRow | PlacementRow | TilesetRow)[] };

// `admin`: also read deleted rows and tile sets. Visitors get active rows only.
export async function load_dataset(admin = false): Promise<Dataset> {
  if (BACKEND === "firebase") {
    const { read_collection } = await import("./firestore-store");
    const [maps, items, placements, tilesets] = await Promise.all([
      read_collection("maps", admin),
      read_collection("items", admin),
      read_collection("placements", admin),
      admin ? read_collection("tilesets", true) : Promise.resolve([]),
    ]);
    return { maps, items, placements, tilesets } as unknown as Dataset;
  }
  const res = await fetch("/api/rows", { cache: "no-store" });
  if (!res.ok) throw new Error(`could not read data (${res.status})`);
  return res.json();
}

export async function save_rows(writes: Write[]): Promise<void> {
  const nonEmpty = writes.filter((w) => w.rows.length);
  if (!nonEmpty.length) return;
  if (BACKEND === "firebase") {
    const { write_rows } = await import("./firestore-store");
    for (const w of nonEmpty) await write_rows(w.table, w.rows as unknown as Record<string, string>[]);
    return;
  }
  const res = await fetch("/api/rows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writes: nonEmpty }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `save failed (${res.status})`);
  }
}

export function stamp<T extends { updated_by: string; updated_at: string }>(row: T, by: string): T {
  return { ...row, updated_by: by, updated_at: new Date().toISOString() };
}
