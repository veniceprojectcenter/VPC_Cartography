// Checks the rule that keeps shapes on their map: a tile set only goes live if it is complete and,
// when the map has shapes, in the same frame as the map's current tiles. Run: npx tsx scripts/check-tileset-guard.ts

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { complete_tileset, publish_blocker, publish_tileset, save_map, start_tileset } from "../lib/edits";
import { TABLES } from "../lib/rows";
import type { Dataset } from "../lib/store-client";

const data = Object.fromEntries(TABLES.map((t) => [t, Papa.parse(readFileSync(`data/${t}.csv`, "utf8"), { header: true, skipEmptyLines: true }).data])) as unknown as Dataset;
const map = data.maps.find((m) => m.map_id === "debarbari")!;
const legacy = data.tilesets.find((t) => t.tileset_id === map.tileset_id)!;
const pixel = { tiles_url: "x/{z}/{x}/{y}.webp", tile_scheme: "xyz", crs: "pixel", min_zoom: "0", max_zoom: "8", bounds: "[[0,0],[20000,46000]]", image_width: "46000", image_height: "20000", source_image_url: "" };

const cases: [string, string | null, boolean][] = [
  ["the current legacy set", publish_blocker(data, map, legacy), true],
  ["a half-uploaded set", publish_blocker(data, map, start_tileset(map.map_id, map.name, { ...legacy }, 100, "t")), false],
  ["a complete set in another frame, map has shapes", publish_blocker(data, map, complete_tileset(start_tileset(map.map_id, map.name, pixel, 100, "t"), "t")), false],
  ["a complete set in the same frame (new tile URL)", publish_blocker(data, map, complete_tileset(start_tileset(map.map_id, map.name, { ...legacy, tiles_url: "https://s3/x/{z}/{x}/{-y}.png" }, 100, "t"), "t")), true],
];
let failed = 0;
for (const [what, blocker, allowed] of cases) {
  const ok = (blocker === null) === allowed;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${blocker ?? "allowed"}`);
}
let threw = false;
try { publish_tileset(data, start_tileset(map.map_id, map.name, pixel, 1, "t"), "t"); } catch { threw = true; }
console.log(`${threw ? "ok  " : "FAIL"} publish_tileset refuses a half-uploaded set`);
const edit = save_map(data, { ...map, tiles_url: "https://example.org/{z}/{x}/{-y}.png" }, "t");
const newSet = edit.find((w) => w.table === "tilesets")!.rows[0] as { tileset_id: string };
const newMap = edit.find((w) => w.table === "maps")!.rows[0] as { tileset_id: string };
const keeps = newSet && newMap.tileset_id === newSet.tileset_id && newSet.tileset_id !== legacy.tileset_id;
console.log(`${keeps ? "ok  " : "FAIL"} changing the tile URL makes a new set and keeps the old one`);
if (failed || !threw || !keeps) process.exit(1);
console.log("happily guarded");
