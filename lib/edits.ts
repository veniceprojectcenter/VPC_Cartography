// Every admin change as a pure function: dataset in, rows to write out.
// Redundant columns are rewritten here and only here, so a copy never drifts from its source.

import { TILE_COLUMNS, type ItemRow, type Layer, type MapRow, type PlacementRow, type TilesetRow } from "./rows";
import type { Dataset, Write } from "./store-client";
import { polygonCenter, type Polygon } from "./geometry";
import { is_tiled } from "./catalog";

function now() {
  return new Date().toISOString();
}

function created(by: string) {
  const at = now();
  return { status: "active" as const, created_by: by, created_at: at, updated_by: by, updated_at: at };
}

function touched<T extends object>(row: T, by: string, at = now()): T {
  return { ...row, updated_by: by, updated_at: at };
}

function map_ids_for(itemId: string, placements: PlacementRow[], maps: MapRow[]): string {
  const year = new Map(maps.map((m) => [m.map_id, Number(m.year)]));
  return placements
    .filter((p) => p.item_id === itemId && p.status === "active")
    .map((p) => p.map_id)
    .sort((a, b) => (year.get(a) ?? 0) - (year.get(b) ?? 0))
    .join("|");
}

function with_map_ids(item: ItemRow, placements: PlacementRow[], maps: MapRow[], by: string): ItemRow {
  const map_ids = map_ids_for(item.item_id, placements, maps);
  return map_ids === item.map_ids ? item : touched({ ...item, map_ids }, by);
}

function upsert<T>(rows: T[], next: T[], key: keyof T): T[] {
  const byKey = new Map(next.map((r) => [r[key], r]));
  const merged = rows.map((r) => byKey.get(r[key]) ?? r);
  const known = new Set(rows.map((r) => r[key]));
  return [...merged, ...next.filter((r) => !known.has(r[key]))];
}

// Several changes as one: each step is built on the rows the one before it left, so redundant
// columns (an item's map_ids) come out right however the steps overlap.
export function in_sequence(data: Dataset, steps: ((d: Dataset) => Write[])[]): Write[] {
  const out: Write[] = [];
  let d = data;
  for (const step of steps) {
    const writes = step(d);
    d = apply_writes(d, writes);
    out.push(...writes);
  }
  return out;
}

// Applies writes to the in-memory dataset; used for the optimistic update.
export function apply_writes(data: Dataset, writes: Write[]): Dataset {
  let { maps, items, placements, tilesets } = data;
  for (const w of writes) {
    if (w.table === "maps") maps = upsert(maps, w.rows as MapRow[], "map_id");
    if (w.table === "items") items = upsert(items, w.rows as ItemRow[], "item_id");
    if (w.table === "placements") placements = upsert(placements, w.rows as PlacementRow[], "placement_id");
    if (w.table === "tilesets") tilesets = upsert(tilesets, w.rows as TilesetRow[], "tileset_id");
  }
  return { maps, items, placements, tilesets };
}

function placement_row(item: ItemRow, map: MapRow, geometry: Polygon, base: Partial<PlacementRow>, by: string): PlacementRow {
  const [lng, lat] = polygonCenter(geometry);
  return {
    ...created(by),
    ...base,
    placement_id: `${item.item_id}@${map.map_id}`,
    item_id: item.item_id,
    map_id: map.map_id,
    item_name: item.name,
    item_code: item.code,
    item_link: item.link,
    layer_id: item.layer_id,
    layer_name: item.layer_name,
    layer_color: item.layer_color,
    map_name: map.name,
    map_year: map.year,
    geometry: JSON.stringify(geometry),
    center_lat: String(lat),
    center_lng: String(lng),
    status: "active",
    updated_by: by,
    updated_at: now(),
  };
}

// F13: a drawn shape on this map, for an item that exists. Replaces its shape here if it had one.
export function place_existing_item(data: Dataset, item: ItemRow, map: MapRow, geometry: Polygon, by: string): Write[] {
  const prior = data.placements.find((p) => p.placement_id === `${item.item_id}@${map.map_id}`);
  const placement = placement_row(item, map, geometry, prior ?? {}, by);
  const placements = upsert(data.placements, [placement], "placement_id");
  return [
    { table: "placements", rows: [placement] },
    { table: "items", rows: [with_map_ids(item, placements, data.maps, by)] },
  ];
}

export type ItemFields = { name: string; code: string; link: string };

// F13: a drawn shape that is a new item. A new layer comes into being with its first item.
export function create_item(data: Dataset, fields: ItemFields, layer: Layer, map: MapRow, geometry: Polygon, by: string): Write[] {
  const base: ItemRow = {
    ...created(by),
    item_id: crypto.randomUUID(),
    code: fields.code.trim(),
    name: fields.name.trim(),
    link: fields.link.trim(),
    ...layer,
    map_ids: map.map_id,
    metadata_json: "",
  };
  return [
    { table: "items", rows: [base] },
    { table: "placements", rows: [placement_row(base, map, geometry, {}, by)] },
  ];
}

// F14: edit an item's details or layer. Every placement of it gets the new copies.
export function update_item(data: Dataset, item: ItemRow, fields: ItemFields, layer: Layer, by: string): Write[] {
  const next = touched({ ...item, name: fields.name.trim(), code: fields.code.trim(), link: fields.link.trim(), ...layer }, by);
  const placements = data.placements
    .filter((p) => p.item_id === item.item_id)
    .map((p) => touched({ ...p, item_name: next.name, item_code: next.code, item_link: next.link, layer_id: next.layer_id, layer_name: next.layer_name, layer_color: next.layer_color }, by));
  return [
    { table: "items", rows: [next] },
    { table: "placements", rows: placements },
  ];
}

// F15: the edited shape replaces the stored one.
export function update_shape(data: Dataset, placement: PlacementRow, geometry: Polygon, by: string): Write[] {
  const [lng, lat] = polygonCenter(geometry);
  return [{ table: "placements", rows: [touched({ ...placement, geometry: JSON.stringify(geometry), center_lat: String(lat), center_lng: String(lng) }, by)] }];
}

// F16, split in two: off this map only, or the item everywhere. Both are status changes.
export function delete_placement(data: Dataset, placement: PlacementRow, by: string): Write[] {
  const gone = touched({ ...placement, status: "deleted" as const }, by);
  const placements = upsert(data.placements, [gone], "placement_id");
  const item = data.items.find((i) => i.item_id === placement.item_id);
  return [
    { table: "placements", rows: [gone] },
    ...(item ? [{ table: "items" as const, rows: [with_map_ids(item, placements, data.maps, by)] }] : []),
  ];
}

// The item and the shapes it still had share one timestamp, which is how restore_item tells them
// apart from shapes that were removed from a map earlier, on purpose.
export function delete_item(data: Dataset, item: ItemRow, by: string): Write[] {
  const at = now();
  const placements = data.placements
    .filter((p) => p.item_id === item.item_id && p.status === "active")
    .map((p) => touched({ ...p, status: "deleted" as const }, by, at));
  return [
    { table: "items", rows: [touched({ ...item, status: "deleted" as const, map_ids: "" }, by, at)] },
    { table: "placements", rows: placements },
  ];
}

// Undoes delete_item: the item, and the shapes deleted with it. Shapes removed before that stay removed.
export function restore_item(data: Dataset, item: ItemRow, by: string): Write[] {
  const placements = data.placements
    .filter((p) => p.item_id === item.item_id && p.status === "deleted" && p.updated_at === item.updated_at)
    .map((p) => touched({ ...p, status: "active" as const }, by));
  const all = upsert(data.placements, placements, "placement_id");
  const back = touched({ ...item, status: "active" as const }, by);
  return [
    { table: "items", rows: [with_map_ids(back, all, data.maps, by)] },
    { table: "placements", rows: placements },
  ];
}

// Undoes delete_placement: one shape back on its map. Its item must be active.
export function restore_placement(data: Dataset, placement: PlacementRow, by: string): Write[] {
  const item = data.items.find((i) => i.item_id === placement.item_id);
  if (!item || item.status !== "active") throw new Error("Restore the item first; this shape belongs to a deleted item.");
  const back = touched({ ...placement, status: "active" as const }, by);
  const placements = upsert(data.placements, [back], "placement_id");
  return [
    { table: "placements", rows: [back] },
    { table: "items", rows: [with_map_ids(item, placements, data.maps, by)] },
  ];
}

// Why this shape cannot move to that item, or null. One shape per item per map (docs/data-model.md).
export function reassign_blocker(data: Dataset, placement: PlacementRow, target: ItemRow): string | null {
  if (target.item_id === placement.item_id) return "That is the item it already belongs to.";
  if (target.status !== "active") return `${target.name || "That item"} is deleted.`;
  const there = data.placements.find((p) => p.placement_id === `${target.item_id}@${placement.map_id}` && p.status === "active");
  return there ? `${target.name || "That item"} already has a shape on ${placement.map_name}. An item has one shape per map.` : null;
}

// The same outline, on the same map, now belonging to another item. The old row is marked deleted,
// not removed, so the move can be undone by moving it back.
export function reassign_placement(data: Dataset, placement: PlacementRow, target: ItemRow, by: string): Write[] {
  const blocker = reassign_blocker(data, placement, target);
  if (blocker) throw new Error(blocker);
  const map = data.maps.find((m) => m.map_id === placement.map_id)!;
  const prior = data.placements.find((p) => p.placement_id === `${target.item_id}@${map.map_id}`);
  const moved = placement_row(target, map, JSON.parse(placement.geometry) as Polygon, prior ?? {}, by);
  const gone = touched({ ...placement, status: "deleted" as const }, by);
  const placements = upsert(data.placements, [moved, gone], "placement_id");
  const owners = [placement.item_id, target.item_id].map((id) => data.items.find((i) => i.item_id === id)!).filter(Boolean);
  return [
    { table: "placements", rows: [gone, moved] },
    { table: "items", rows: owners.map((i) => with_map_ids(i, placements, data.maps, by)) },
  ];
}

export function layer_of(item: ItemRow): Layer {
  return { layer_id: item.layer_id, layer_name: item.layer_name, layer_color: item.layer_color, layer_parent: item.layer_parent };
}

// Reclassify: the item changes layer, on every map it is drawn on. Nothing is redrawn.
export function move_item_to_layer(data: Dataset, item: ItemRow, layer: Layer, by: string): Write[] {
  return update_item(data, item, { name: item.name, code: item.code, link: item.link }, layer, by);
}

// The same outline as a new item in another layer, on the map the shape is on; the source is
// left as it is. A copy is its own item from then on (own id, own layer), so the two never drift.
export function copy_to_layer(data: Dataset, placement: PlacementRow, layer: Layer, by: string): Write[] {
  const source = data.items.find((i) => i.item_id === placement.item_id);
  const map = data.maps.find((m) => m.map_id === placement.map_id);
  if (!source || !map) throw new Error("The shape's item or map is gone.");
  if (layer.layer_id === source.layer_id) throw new Error(`${source.name || "This item"} is already in ${layer.layer_name}.`);
  const writes = create_item(data, { name: source.name, code: source.code, link: source.link }, layer, map, JSON.parse(placement.geometry) as Polygon, by);
  const [item] = writes[0].rows as ItemRow[];
  item.metadata_json = source.metadata_json;
  return writes;
}

// The copy, then the original off this map: this map's shape alone changes layer, the item's
// other maps stay where they are.
export function move_shape_to_layer(data: Dataset, placement: PlacementRow, layer: Layer, by: string): Write[] {
  return in_sequence(data, [
    (d) => copy_to_layer(d, placement, layer, by),
    (d) => delete_placement(d, d.placements.find((p) => p.placement_id === placement.placement_id)!, by),
  ]);
}

// F18: rename, recolour or regroup a layer: every item and placement of it is rewritten.
export function update_layer(data: Dataset, layerId: string, next: Omit<Layer, "layer_id">, by: string): Write[] {
  const items = data.items.filter((i) => i.layer_id === layerId).map((i) => touched({ ...i, ...next }, by));
  const placements = data.placements
    .filter((p) => p.layer_id === layerId)
    .map((p) => touched({ ...p, layer_name: next.layer_name, layer_color: next.layer_color }, by));
  return [
    { table: "items", rows: items },
    { table: "placements", rows: placements },
  ];
}

// ---------- maps and tile sets ----------
// A map shows one tile set (maps.tileset_id) and carries a copy of its tile columns. Changing the
// tiles never edits a set: it makes a new one and points the map at it, so the old one is still
// there to go back to. Only a complete set is ever pointed at.

export type MapInfo = Pick<MapRow, "map_id" | "name" | "year" | "parent" | "description" | "author" | "source" | "collection" | "scale">;
export type TileFields = Pick<TilesetRow, (typeof TILE_COLUMNS)[number]>;
export type MapFields = MapInfo & Pick<MapRow, "tiles_url" | "tile_scheme" | "min_zoom" | "max_zoom" | "bounds">;

// Sortable and unique enough per map: the moment it was made.
export function new_tileset_id(mapId: string): string {
  return `${mapId}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").toLowerCase()}`;
}

function tile_fields_of(row: TileFields): TileFields {
  return Object.fromEntries(TILE_COLUMNS.map((c) => [c, row[c]])) as TileFields;
}

// Where polygons sit relative to the tiles. Two sets with the same frame show the same shapes in
// the same places; with a different one, every polygon drawn on this map would land elsewhere.
function frame(t: TileFields): string {
  return t.crs === "pixel" ? `pixel ${t.image_width}x${t.image_height}` : `${t.crs} ${t.bounds}`;
}

// Why this set cannot go live on this map, or null if it can.
export function publish_blocker(data: Dataset, map: MapRow | undefined, tileset: TilesetRow): string | null {
  if (tileset.upload_state !== "complete") {
    return `Only ${tileset.uploaded_count || 0} of ${tileset.tile_count} tiles are stored. Finish the upload first.`;
  }
  if (!map) return null;
  const shapes = data.placements.filter((p) => p.map_id === map.map_id && p.status === "active").length;
  if (shapes && frame(tileset) !== frame(map)) {
    return `${shapes} shapes are drawn on this map's current tiles. These tiles have a different size or frame, so every shape would land in the wrong place.`;
  }
  return null;
}

function map_with_tiles(map: MapRow, tileset: TilesetRow, by: string): MapRow {
  return touched({ ...map, tileset_id: tileset.tileset_id, ...tile_fields_of(tileset) }, by);
}

function renamed_placements(data: Dataset, row: MapRow, by: string): PlacementRow[] {
  return data.placements
    .filter((p) => p.map_id === row.map_id && (p.map_name !== row.name || p.map_year !== row.year))
    .map((p) => touched({ ...p, map_name: row.name, map_year: row.year }, by));
}

function tileset_row(mapId: string, mapName: string, tiles: TileFields, state: Pick<TilesetRow, "upload_state" | "tile_count" | "uploaded_count">, by: string): TilesetRow {
  return { tileset_id: new_tileset_id(mapId), map_id: mapId, map_name: mapName, ...state, ...tile_fields_of(tiles), ...created(by) };
}

// F17 from tiles that already exist somewhere: a new map, or an edit. If the tile fields changed,
// that is a new tile set (complete: the tiles are already there) and the map moves to it.
export function save_map(data: Dataset, fields: MapFields, by: string): Write[] {
  const prior = data.maps.find((m) => m.map_id === fields.map_id);
  const tiles: TileFields = {
    ...(prior ? tile_fields_of(prior) : { crs: "legacy-mercator", image_width: "", image_height: "", source_image_url: "" }),
    tiles_url: fields.tiles_url, tile_scheme: fields.tile_scheme, min_zoom: fields.min_zoom, max_zoom: fields.max_zoom, bounds: fields.bounds,
  } as TileFields;
  const changedTiles = !prior || TILE_COLUMNS.some((c) => tiles[c] !== prior[c]);
  const tileset = changedTiles ? tileset_row(fields.map_id, fields.name, tiles, { upload_state: "complete", tile_count: "", uploaded_count: "" }, by) : null;
  const info = { ...(prior ?? { ...created(by), metadata_json: "", tileset_id: "" }), ...fields } as MapRow;
  const row = tileset ? map_with_tiles(info, tileset, by) : touched(info, by);
  return [
    { table: "maps", rows: [row] },
    { table: "tilesets", rows: tileset ? [tileset] : [] },
    { table: "placements", rows: prior ? renamed_placements(data, row, by) : [] },
  ];
}

// An upload begins: the set exists, marked uploading, before its first tile is sent. If the
// upload stops, this row is what says so.
export function start_tileset(mapId: string, mapName: string, tiles: TileFields, tileCount: number, by: string): TilesetRow {
  return tileset_row(mapId, mapName, tiles, { upload_state: "uploading", tile_count: String(tileCount), uploaded_count: "0" }, by);
}

export function tileset_progress(tileset: TilesetRow, uploaded: number, by: string): Write[] {
  return [{ table: "tilesets", rows: [touched({ ...tileset, uploaded_count: String(uploaded) }, by)] }];
}

// After storage listed every tile (lib/tile-upload.ts). Then, and only then, can it be published.
export function complete_tileset(tileset: TilesetRow, by: string): TilesetRow {
  return touched({ ...tileset, upload_state: "complete", uploaded_count: tileset.tile_count }, by);
}

// Point a map at a set: publishing a new upload, or rolling back to an earlier one.
// A new map (info given, no row yet) is created on its first set.
export function publish_tileset(data: Dataset, tileset: TilesetRow, by: string, info?: MapInfo): Write[] {
  const map = data.maps.find((m) => m.map_id === tileset.map_id);
  const blocker = publish_blocker(data, map, tileset);
  if (blocker) throw new Error(blocker);
  const base = map ?? ({ ...created(by), metadata_json: "", ...info } as MapRow);
  const row = map_with_tiles(info ? { ...base, ...info } : base, tileset, by);
  return [
    { table: "maps", rows: [row] },
    { table: "tilesets", rows: [tileset] },
    { table: "placements", rows: map ? renamed_placements(data, row, by) : [] },
  ];
}

// ---------- catalog ----------
// A catalog map is tiled to explore it, then added to the maps list or left where it is. Both
// are status changes on the same row, so the tiles are never made twice.


export function import_catalog(entries: MapRow[]): Write[] {
  return [{ table: "maps", rows: entries }];
}

// Why this map cannot be added to the maps list, or null.
export function promote_blocker(map: MapRow): string | null {
  if (map.status !== "catalog") return `${map.name} is already in the maps list.`;
  return is_tiled(map) ? null : `${map.name} has no tiles yet. Tile it first, so there is something to show.`;
}

export function promote_map(map: MapRow, by: string): Write[] {
  const blocker = promote_blocker(map);
  if (blocker) throw new Error(blocker);
  return [{ table: "maps", rows: [touched({ ...map, status: "active" as const }, by)] }];
}

// Undoes promote_map.
export function return_to_catalog(map: MapRow, by: string): Write[] {
  return [{ table: "maps", rows: [touched({ ...map, status: "catalog" as const }, by)] }];
}
