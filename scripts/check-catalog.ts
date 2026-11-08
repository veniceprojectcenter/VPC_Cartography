// Checks the catalog rules: import reads the usual column names, never touches existing maps,
// recognises what it already imported, flags near-duplicates, and a map joins the list only once
// it has tiles. Run: npx tsx scripts/check-catalog.ts

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { catalog_import, is_tiled, read_catalog_file, similar_counts } from "../lib/catalog";
import { promote_blocker, promote_map } from "../lib/edits";
import type { MapRow } from "../lib/rows";

const maps = Papa.parse<MapRow>(readFileSync("data/maps.csv", "utf8"), { header: true, skipEmptyLines: true }).data;
const csv = [
  "Catalog ID,Title,Date,Cartographer,Collection,Image,Link",
  "A1,Pianta di Venezia,c. 1500,Barbari,Correr,https://example.org/a1.jpg,https://example.org/a1",
  "A2,Pianta di Venezia,1500,Barbari,Marciana,https://example.org/a2.jpg,",
  "A3,,1600,Nobody,,,",
  "A4,Jacopo de'Barbari,1500,,,,",
].join("\n");

let failed = 0;
const check = (what: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };

const first = catalog_import(read_catalog_file(csv, "list.csv"), maps, "t");
check("reads title, date, cartographer, image and link under their usual names", first.entries.length === 3 && first.entries[0].year === "1500" && first.entries[0].author === "Barbari" && JSON.parse(first.entries[0].metadata_json).catalog.image_url === "https://example.org/a1.jpg");
check("a row with no title is skipped with its line number", first.skipped.length === 1 && first.skipped[0].line === 4);
check("entries are catalog rows with no tiles", first.entries.every((e) => e.status === "catalog" && !is_tiled(e)));
check("ids are unique, also against the maps already there", new Set([...maps, ...first.entries].map((m) => m.map_id)).size === maps.length + first.entries.length && first.entries.every((e) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(e.map_id)));
check("the same title as an existing map gets its own id, the map is not touched", first.entries.some((e) => e.name === "Jacopo de'Barbari" && e.map_id !== "debarbari"));

const again = catalog_import(read_catalog_file(csv, "list.csv"), [...maps, ...first.entries], "t");
check("importing the same list again adds nothing", again.entries.length === 0 && again.already === 3);

const dup = similar_counts([...maps, ...first.entries]);
check("two entries with one title and year are flagged, and the list's own map with them", dup.size === 4 && dup.get(first.entries[0].map_id) === 1);

const json = read_catalog_file(JSON.stringify([{ title: "X", year: 1700 }]), "list.json");
check("JSON is read like CSV", catalog_import(json, maps, "t").entries[0].year === "1700");
let noName = false;
try { catalog_import([{ foo: "x" }], maps, "t"); } catch { noName = true; }
check("a file with no title column is refused", noName);

const untiled = first.entries[0];
check("an untiled catalog map cannot join the list", promote_blocker(untiled) !== null);
const tiled = { ...untiled, tiles_url: "https://s3/x/{z}/{x}/{y}.webp" };
const [w] = promote_map(tiled, "t");
check("a tiled one joins the list: same row, status active", (w.rows[0] as MapRow).status === "active" && (w.rows[0] as MapRow).map_id === tiled.map_id);
check("a map already in the list is refused", promote_blocker(maps[0]) !== null);

if (failed) process.exit(1);
console.log("happily catalogued");
