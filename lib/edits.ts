// Every admin change as a pure function: dataset in, rows to write out.
// Redundant columns are rewritten here and only here, so a copy never drifts from its source.

import type { ItemRow, Layer, MapRow, PlacementRow } from "./rows";
import type { Dataset, Write } from "./store-client";
import { polygonCenter, type Polygon } from "./geometry";

function now() {
  return new Date().toISOString();
}

function created(by: string) {
  const at = now();
  return { status: "active" as const, created_by: by, created_at: at, updated_by: by, updated_at: at };
}

function touched<T extends object>(row: T, by: string): T {
  return { ...row, updated_by: by, updated_at: now() };
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

// Applies writes to the in-memory dataset; used for the optimistic update.
export function apply_writes(data: Dataset, writes: Write[]): Dataset {
  let { maps, items, placements } = data;
  for (const w of writes) {
    if (w.table === "maps") maps = upsert(maps, w.rows as MapRow[], "map_id");
    if (w.table === "items") items = upsert(items, w.rows as ItemRow[], "item_id");
    if (w.table === "placements") placements = upsert(placements, w.rows as PlacementRow[], "placement_id");
  }
  return { maps, items, placements };
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

export function delete_item(data: Dataset, item: ItemRow, by: string): Write[] {
  const placements = data.placements
    .filter((p) => p.item_id === item.item_id && p.status === "active")
    .map((p) => touched({ ...p, status: "deleted" as const }, by));
  return [
    { table: "items", rows: [touched({ ...item, status: "deleted" as const, map_ids: "" }, by)] },
    { table: "placements", rows: placements },
  ];
}

export function restore_item(data: Dataset, item: ItemRow, by: string): Write[] {
  const placements = data.placements
    .filter((p) => p.item_id === item.item_id && p.status === "deleted")
    .map((p) => touched({ ...p, status: "active" as const }, by));
  const all = upsert(data.placements, placements, "placement_id");
  const back = touched({ ...item, status: "active" as const }, by);
  return [
    { table: "items", rows: [with_map_ids(back, all, data.maps, by)] },
    { table: "placements", rows: placements },
  ];
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

export type MapFields = Pick<MapRow, "map_id" | "name" | "year" | "parent" | "description" | "author" | "source" | "collection" | "scale" | "tiles_url" | "tile_scheme" | "min_zoom" | "max_zoom" | "bounds">;

// F17: a map from existing tiles. (Uploading an image to tile it comes later.)
export function save_map(data: Dataset, fields: MapFields, by: string): Write[] {
  const prior = data.maps.find((m) => m.map_id === fields.map_id);
  const row: MapRow = prior
    ? touched({ ...prior, ...fields }, by)
    : { ...created(by), ...fields, crs: "legacy-mercator", image_width: "", image_height: "", source_image_url: "", metadata_json: "" };
  if (!prior) return [{ table: "maps", rows: [row] }];
  const placements = data.placements.filter((p) => p.map_id === row.map_id && (p.map_name !== row.name || p.map_year !== row.year)).map((p) => touched({ ...p, map_name: row.name, map_year: row.year }, by));
  return [
    { table: "maps", rows: [row] },
    { table: "placements", rows: placements },
  ];
}
