// Browser side of the local CSV store.

import type { ItemRow, MapRow, PlacementRow, Table } from "./rows";

export type Dataset = { maps: MapRow[]; items: ItemRow[]; placements: PlacementRow[] };
export type Write = { table: Table; rows: (MapRow | ItemRow | PlacementRow)[] };

export async function load_dataset(): Promise<Dataset> {
  const res = await fetch("/api/rows", { cache: "no-store" });
  if (!res.ok) throw new Error(`could not read data (${res.status})`);
  return res.json();
}

export async function save_rows(writes: Write[]): Promise<void> {
  const res = await fetch("/api/rows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `save failed (${res.status})`);
  }
}

export function stamp<T extends { updated_by: string; updated_at: string }>(row: T, by: string): T {
  return { ...row, updated_by: by, updated_at: new Date().toISOString() };
}
