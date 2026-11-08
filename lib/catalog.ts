// The catalog: maps from the prior team's list that are not in the maps list yet. A catalog entry
// is a maps row with status "catalog", so it carries tile sets, tiles and metadata like any map
// and joining the list is a status change, not a copy. Nothing here touches the network.

import Papa from "papaparse";
import type { MapRow } from "./rows";

export type CatalogMeta = { key: string; id: string; image_url: string; record_url: string };

// Column names a catalog file may use, compared lowercase with everything but letters and digits
// removed. The first column of a file that matches a field is the one read.
const ALIASES = {
  id: ["id", "catalogid", "identifier", "mapid", "number", "no"],
  name: ["name", "title", "mapname", "maptitle"],
  year: ["year", "date", "yearcreated", "published", "yearpublished"],
  author: ["author", "creator", "cartographer", "mapmaker", "engraver"],
  source: ["source"],
  collection: ["collection", "archive", "repository", "library"],
  scale: ["scale"],
  description: ["description", "notes", "note", "summary"],
  image_url: ["imageurl", "image", "imagelink", "fileurl", "file", "download", "iiif"],
  record_url: ["recordurl", "link", "catalogurl", "permalink", "page", "url", "record"],
} as const;
type Field = keyof typeof ALIASES;

const simplify = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

export function normalised_title(name: string): string {
  return name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function slug(name: string): string {
  return normalised_title(name).replace(/ /g, "-");
}

function year_of(text: string): string {
  return text.match(/-?\d{3,4}/)?.[0] ?? "";
}

// A catalog file as rows: a JSON array of objects, or CSV with a header row.
export function read_catalog_file(text: string, filename: string): Record<string, string>[] {
  if (/\.json$/i.test(filename)) {
    const json = JSON.parse(text) as unknown;
    if (!Array.isArray(json)) throw new Error("A JSON catalog is an array of objects, one per map.");
    return json.map((o) => Object.fromEntries(Object.entries(o as object).map(([k, v]) => [k, v == null ? "" : String(v)])));
  }
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (!parsed.meta.fields?.length) throw new Error("The file needs a header row naming the columns.");
  return parsed.data;
}

export function catalog_meta(map: MapRow): CatalogMeta | null {
  try {
    const meta = (JSON.parse(map.metadata_json || "{}") as { catalog?: CatalogMeta }).catalog;
    return meta ?? null;
  } catch {
    return null;
  }
}

export type CatalogImport = {
  entries: MapRow[];
  // Rows already imported earlier (same id, or same title, year and image), left as they are.
  already: number;
  // Rows that cannot become a map, with the file's line number (header is line 1).
  skipped: { line: number; reason: string }[];
};

// What importing these rows would add. Existing maps, in the list or in the catalog, are never changed.
export function catalog_import(rows: Record<string, string>[], existing: MapRow[], by: string): CatalogImport {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const column = Object.fromEntries((Object.keys(ALIASES) as Field[]).map((f) => [f, headers.find((h) => (ALIASES[f] as readonly string[]).includes(simplify(h)))]));
  if (!column.name) throw new Error(`No name column. Name one of: ${ALIASES.name.join(", ")}.`);

  // A removed entry (an undone import) can be imported again.
  const keys = new Set(existing.filter((m) => m.status !== "deleted").map((m) => catalog_meta(m)?.key).filter(Boolean));
  const ids = new Set(existing.map((m) => m.map_id));
  const at = new Date().toISOString();
  const out: CatalogImport = { entries: [], already: 0, skipped: [] };

  rows.forEach((row, i) => {
    const get = (f: Field) => (column[f] ? (row[column[f]!] ?? "").trim() : "");
    const name = get("name");
    if (!name) return void out.skipped.push({ line: i + 2, reason: "no name" });
    const year = year_of(get("year"));
    const meta: CatalogMeta = { id: get("id"), image_url: get("image_url"), record_url: get("record_url"), key: "" };
    meta.key = meta.id || `${normalised_title(name)}|${year}|${meta.image_url}`;
    if (keys.has(meta.key)) return void out.already++;
    keys.add(meta.key);

    // 48 leaves room for the timestamp a tile set id adds (lib/image-store.ts caps ids at 81).
    const base = slug(`${name} ${year}`).slice(0, 48).replace(/-$/, "") || "map";
    let map_id = base;
    for (let n = 2; ids.has(map_id); n++) map_id = `${base}-${n}`;
    ids.add(map_id);

    out.entries.push({
      map_id, name, year, parent: "", description: get("description"), author: get("author"), source: get("source"), collection: get("collection"), scale: get("scale"),
      tileset_id: "", tiles_url: "", tile_scheme: "", crs: "", min_zoom: "", max_zoom: "", bounds: "", image_width: "", image_height: "", source_image_url: "",
      metadata_json: JSON.stringify({ catalog: meta }),
      status: "catalog", created_by: by, created_at: at, updated_by: by, updated_at: at,
    });
  });
  return out;
}

// Entries that share a title and year with another map in the catalog or the list: many of the
// catalog's maps are the same sheet more than once, and these are the ones to compare first.
export function similar_counts(maps: MapRow[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const m of maps) {
    if (m.status === "deleted") continue;
    const key = `${normalised_title(m.name)}|${m.year}`;
    groups.set(key, [...(groups.get(key) ?? []), m.map_id]);
  }
  const out = new Map<string, number>();
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length - 1);
  return out;
}

// A catalog map is tiled once it has a tile set to show; tiles are kept, never made twice.
export function is_tiled(map: MapRow): boolean {
  return !!map.tiles_url;
}
