// Row shapes for the three flat tables. Every value is a string, as it is in the CSV.
// Column order here is the column order on disk.

export const AUDIT_COLUMNS = ["status", "created_by", "created_at", "updated_by", "updated_at"] as const;

export const MAP_COLUMNS = [
  "map_id", "name", "year", "parent", "description", "author", "source", "collection", "scale",
  "tiles_url", "tile_scheme", "crs", "min_zoom", "max_zoom", "bounds",
  "image_width", "image_height", "source_image_url", "metadata_json",
  ...AUDIT_COLUMNS,
] as const;

export const ITEM_COLUMNS = [
  "item_id", "code", "name", "link",
  "layer_id", "layer_name", "layer_color", "layer_parent",
  "map_ids", "metadata_json",
  ...AUDIT_COLUMNS,
] as const;

export const PLACEMENT_COLUMNS = [
  "placement_id", "item_id", "map_id",
  "item_name", "item_code", "item_link",
  "layer_id", "layer_name", "layer_color",
  "map_name", "map_year",
  "geometry", "center_lat", "center_lng",
  ...AUDIT_COLUMNS,
] as const;

export type Status = "active" | "deleted";
type Row<C extends readonly string[]> = { [K in C[number]]: K extends "status" ? Status : string };

export type MapRow = Row<typeof MAP_COLUMNS>;
export type ItemRow = Row<typeof ITEM_COLUMNS>;
export type PlacementRow = Row<typeof PLACEMENT_COLUMNS>;

export type Table = "maps" | "items" | "placements";
export const TABLE_COLUMNS: Record<Table, readonly string[]> = {
  maps: MAP_COLUMNS,
  items: ITEM_COLUMNS,
  placements: PLACEMENT_COLUMNS,
};
export const TABLE_KEY: Record<Table, string> = {
  maps: "map_id",
  items: "item_id",
  placements: "placement_id",
};

export type Layer = { layer_id: string; layer_name: string; layer_color: string; layer_parent: string };

// The layer list is the distinct layers across active items (docs/data-model.md, Layer rules).
export function layers_from_items(items: ItemRow[]): Layer[] {
  const byId = new Map<string, Layer>();
  for (const i of items) {
    if (i.status !== "active" || byId.has(i.layer_id)) continue;
    byId.set(i.layer_id, { layer_id: i.layer_id, layer_name: i.layer_name, layer_color: i.layer_color, layer_parent: i.layer_parent });
  }
  return [...byId.values()].sort((a, b) => a.layer_name.localeCompare(b.layer_name));
}
