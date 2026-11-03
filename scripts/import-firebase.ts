// Firebase snapshot -> data/maps.csv, data/items.csv, data/placements.csv, data/tilesets.csv.
// Pure function of the snapshot and data/tile-extents.json: same input, byte-identical output.
//
// Carries over what the old viewer could show, and nothing else (docs/data-model.md, Import).

import { readFileSync, writeFileSync } from "node:fs";
import Papa from "papaparse";
import { MAP_COLUMNS, ITEM_COLUMNS, PLACEMENT_COLUMNS, TILESET_COLUMNS, TILE_COLUMNS, type MapRow, type ItemRow, type PlacementRow, type TilesetRow } from "../lib/rows";
import { polygonCenter, wrapPolygonLongitudes } from "../lib/geometry";

const SNAPSHOT = "data/firebase-snapshot-2026-11-03";
const TILE_HOST = "https://cartography.veniceprojectcenter.org/maps";
const IMPORTED_BY = "firebase-import";
const IMPORTED_AT = "2026-11-03T00:00:00Z";

// The old viewer's minZoom for every map (MapManager.switchMap); tiles below it exist but were never shown.
const LEGACY_MIN_ZOOM = 2;
// Colour the old viewer drew a layer in when the layer list had no entry for it (LayerManager.enableLayer).
const LEGACY_FALLBACK_COLOR = "#3388ff";

type FbMap = { id: string; name: string; year: string | number; tiles: string; parent?: string; createdBy?: string; bounds?: unknown };
type FbLayer = { id: string; name: string; color: string; parent?: string; createdBy?: string };
type FbFeature = { properties: Record<string, unknown> };
type FbPolygon = { type: "Polygon"; coordinates: number[][][] };
type Extent = { max_zoom: number; bounds: [[number, number], [number, number]] };

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(`${SNAPSHOT}/${name}`, "utf8")) as T;
}

// The old popup rewrote every link this way before showing it; it is now the stored link.
// Each replace hits the first occurrence only, exactly as String.replace did there.
function resolve_link(link: string): string {
  return link.replace("venipedia.org", "wiki.cityknowledge.org").replace("www.", "").replace("http://", "https://");
}

function layer_id_for(type: string): string {
  return type === "" ? "canals" : type;
}

function tile_dir_for(map: FbMap): string {
  const last = map.tiles.replace(/\/+$/, "").split("/").pop();
  if (!last) throw new Error(`map ${map.id}: cannot read a tile folder from "${map.tiles}"`);
  return last;
}

// The tiles each old map already had, on the old host, as that map's first tile set.
function legacy_tileset_id(mapId: string): string {
  return `${mapId}-legacy`;
}

function build_tilesets(maps: MapRow[]): TilesetRow[] {
  return maps.map((m) => ({
    tileset_id: m.tileset_id,
    map_id: m.map_id,
    map_name: m.name,
    upload_state: "complete" as const,
    // Never uploaded through the app, so never counted.
    tile_count: "",
    uploaded_count: "",
    ...Object.fromEntries(TILE_COLUMNS.map((c) => [c, m[c]])) as Pick<MapRow, (typeof TILE_COLUMNS)[number]>,
    ...audit(m.created_by),
  }));
}

function audit(by: string | undefined) {
  return { status: "active" as const, created_by: by ?? IMPORTED_BY, created_at: IMPORTED_AT, updated_by: IMPORTED_BY, updated_at: IMPORTED_AT };
}

function build_maps(fbMaps: Record<string, FbMap>, extents: Record<string, Extent>): MapRow[] {
  return Object.entries(fbMaps).map(([mapId, m]) => {
    const dir = tile_dir_for(m);
    const extent = extents[dir];
    if (!extent) throw new Error(`map ${mapId}: no measured extent for tile folder ${dir}`);
    return {
      map_id: mapId,
      name: m.name,
      year: String(m.year),
      parent: m.parent ?? "",
      description: "",
      author: "",
      source: "",
      collection: "",
      scale: "",
      tileset_id: legacy_tileset_id(mapId),
      tiles_url: `${TILE_HOST}/${dir}/{z}/{x}/{-y}.png`,
      tile_scheme: "tms",
      crs: "legacy-mercator",
      min_zoom: String(LEGACY_MIN_ZOOM),
      max_zoom: String(extent.max_zoom),
      bounds: JSON.stringify(extent.bounds),
      image_width: "",
      image_height: "",
      source_image_url: "",
      metadata_json: "",
      ...audit(m.createdBy),
    };
  }).sort((a, b) => Number(a.year) - Number(b.year) || a.map_id.localeCompare(b.map_id));
}

function main() {
  const fbMaps = readJson<Record<string, FbMap>>("fb_maps.json");
  const fbLayers = readJson<Record<string, FbLayer>>("fb_layers.json");
  const fbFeatures = readJson<Record<string, FbFeature>>("fb_features.json");
  const extents = JSON.parse(readFileSync("data/tile-extents.json", "utf8")) as Record<string, Extent>;

  const maps = build_maps(fbMaps, extents);
  const mapById = new Map(maps.map((m) => [m.map_id, m]));

  const layerByType = new Map(Object.values(fbLayers).map((l) => [l.id, l]));
  const polygonsByMap = new Map<string, Record<string, FbPolygon>>();
  for (const m of maps) polygonsByMap.set(m.map_id, readJson<Record<string, FbPolygon>>(`fb_geom_${m.map_id}.json`) ?? {});

  // An item is kept if search could find it (name or code) or a layer toggle could draw it.
  const counts = { items: 0, itemsDropped: 0, placements: 0, orphans: 0, placementsDropped: 0, linksRewritten: 0, unlistedLayer: 0 };
  const items: ItemRow[] = [];
  const itemById = new Map<string, ItemRow>();

  for (const [itemId, f] of Object.entries(fbFeatures)) {
    const p = f.properties ?? {};
    const type = typeof p.type === "string" ? p.type : undefined;
    const name = String(p.name ?? "").trim();
    const code = String(p.code ?? "").trim();
    const layer = type === undefined ? undefined : layerByType.get(type);
    const drawable = layer !== undefined && maps.some((m) => polygonsByMap.get(m.map_id)![itemId]);
    if (type === undefined || !(name || code || drawable)) {
      counts.itemsDropped++;
      continue;
    }
    if (!layer) counts.unlistedLayer++;
    const rawLink = String(p.link ?? "");
    const link = rawLink ? resolve_link(rawLink) : "";
    if (link !== rawLink) counts.linksRewritten++;
    const metadata: Record<string, unknown> = {};
    if (p.number !== undefined) metadata.number = p.number;
    if (p.numero !== undefined) metadata.numero = p.numero;

    const row: ItemRow = {
      item_id: itemId,
      code,
      name,
      link,
      layer_id: layer_id_for(type),
      layer_name: layer?.name ?? type,
      layer_color: layer?.color ?? LEGACY_FALLBACK_COLOR,
      layer_parent: layer?.parent ?? "",
      map_ids: "",
      metadata_json: Object.keys(metadata).length ? JSON.stringify(metadata) : "",
      ...audit(undefined),
    };
    items.push(row);
    itemById.set(itemId, row);
    counts.items++;
  }

  const placements: PlacementRow[] = [];
  for (const m of maps) {
    const polygons = polygonsByMap.get(m.map_id)!;
    for (const [itemId, polygon] of Object.entries(polygons)) {
      const item = itemById.get(itemId);
      if (!item) {
        if (fbFeatures[itemId]) counts.placementsDropped++;
        else counts.orphans++;
        continue;
      }
      const geometry = wrapPolygonLongitudes(polygon);
      const [lng, lat] = polygonCenter(geometry);
      placements.push({
        placement_id: `${itemId}@${m.map_id}`,
        item_id: itemId,
        map_id: m.map_id,
        item_name: item.name,
        item_code: item.code,
        item_link: item.link,
        layer_id: item.layer_id,
        layer_name: item.layer_name,
        layer_color: item.layer_color,
        map_name: m.name,
        map_year: m.year,
        geometry: JSON.stringify(geometry),
        center_lat: String(lat),
        center_lng: String(lng),
        ...audit(undefined),
      });
      counts.placements++;
    }
  }

  for (const item of items) {
    const onMaps = placements.filter((p) => p.item_id === item.item_id).map((p) => mapById.get(p.map_id)!);
    item.map_ids = onMaps.sort((a, b) => Number(a.year) - Number(b.year)).map((m) => m.map_id).join("|");
  }
  items.sort((a, b) => a.item_id.localeCompare(b.item_id));
  placements.sort((a, b) => a.map_id.localeCompare(b.map_id) || a.item_id.localeCompare(b.item_id));

  writeCsv("data/maps.csv", MAP_COLUMNS, maps);
  writeCsv("data/items.csv", ITEM_COLUMNS, items);
  writeCsv("data/placements.csv", PLACEMENT_COLUMNS, placements);
  writeCsv("data/tilesets.csv", TILESET_COLUMNS, build_tilesets(maps));

  console.log(counts);
  // The totals docs/data-model.md promises; anything else means the snapshot or the rules changed.
  const expected = { items: 1228, itemsDropped: 9, placements: 2106, orphans: 2044, placementsDropped: 25 };
  for (const [k, v] of Object.entries(expected)) {
    if (counts[k as keyof typeof counts] !== v) throw new Error(`${k}: expected ${v}, got ${counts[k as keyof typeof counts]}`);
  }
  console.log(`happily imported ${maps.length} maps, ${items.length} items, ${placements.length} placements`);
}

function writeCsv<T extends object>(path: string, columns: readonly string[], rows: T[]) {
  writeFileSync(path, Papa.unparse({ fields: [...columns], data: rows.map((r) => columns.map((c) => (r as Record<string, string>)[c])) }, { newline: "\n" }) + "\n");
}

main();
