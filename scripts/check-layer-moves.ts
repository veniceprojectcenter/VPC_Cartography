// Checks reclassifying: a move changes the item's layer everywhere, a copy leaves the original and
// makes a second item, and a one-map move splits the shape off. Run: npx tsx scripts/check-layer-moves.ts

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { apply_writes, copy_to_layer, delete_item, layer_of, move_item_to_layer, move_shape_to_layer } from "../lib/edits";
import { TABLES, type ItemRow, type PlacementRow } from "../lib/rows";
import type { Dataset } from "../lib/store-client";

const data = Object.fromEntries(TABLES.map((t) => [t, Papa.parse(readFileSync(`data/${t}.csv`, "utf8"), { header: true, skipEmptyLines: true }).data])) as unknown as Dataset;
const item = data.items.find((i) => i.status === "active" && i.map_ids.split("|").length > 1)!;
const here = data.placements.find((p) => p.item_id === item.item_id && p.status === "active")!;
const target = data.items.find((i) => i.layer_id !== item.layer_id && i.status === "active")!;
const layer = layer_of(target);
const active = (d: Dataset, id: string) => d.placements.filter((p) => p.item_id === id && p.status === "active");

let failed = 0;
const check = (what: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? "ok  " : "FAIL"} ${what}`); };

const moved = apply_writes(data, move_item_to_layer(data, item, layer, "t"));
check("move: the item and every shape of it change layer",
  moved.items.find((i) => i.item_id === item.item_id)!.layer_id === layer.layer_id
  && active(moved, item.item_id).length === active(data, item.item_id).length
  && active(moved, item.item_id).every((p) => p.layer_id === layer.layer_id));

const copied = apply_writes(data, copy_to_layer(data, here, layer, "t"));
const copy = copied.items.find((i) => !data.items.some((o) => o.item_id === i.item_id)) as ItemRow;
const copyShape = copied.placements.find((p) => p.item_id === copy.item_id) as PlacementRow;
check("copy: the original is untouched", JSON.stringify(copied.items.find((i) => i.item_id === item.item_id)) === JSON.stringify(item)
  && copied.placements.find((p) => p.placement_id === here.placement_id)!.status === "active");
check("copy: a new item in the new layer with the same outline on this map", copy.layer_id === layer.layer_id && copy.name === item.name && copyShape.map_id === here.map_id && copyShape.geometry === here.geometry && copy.map_ids === here.map_id);
check("copy: undone by deleting the copy", apply_writes(copied, delete_item(copied, copy, "t")).items.find((i) => i.item_id === copy.item_id)!.status === "deleted");

let refused = false;
try { copy_to_layer(data, here, layer_of(item), "t"); } catch { refused = true; }
check("copy: refuses the layer it is already in", refused);

const split = apply_writes(data, move_shape_to_layer(data, here, layer, "t"));
check("one-map move: the shape leaves this map's item, its other maps keep the old layer",
  split.placements.find((p) => p.placement_id === here.placement_id)!.status === "deleted"
  && split.items.find((i) => i.item_id === item.item_id)!.layer_id === item.layer_id
  && !split.items.find((i) => i.item_id === item.item_id)!.map_ids.split("|").includes(here.map_id)
  && split.items.some((i) => i.layer_id === layer.layer_id && i.map_ids === here.map_id && !data.items.some((o) => o.item_id === i.item_id)));

if (failed) process.exit(1);
console.log("happily reclassified");
