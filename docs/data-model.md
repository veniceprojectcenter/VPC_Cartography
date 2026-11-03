# Data model

Flat rows, CSV-shaped. Three kinds: maps, items, placements. Redundancy is accepted on purpose: a row reads on its own, without looking anything up.

The rows live in Firestore — one collection per kind, one document per row, the document id is the row id, and the fields are exactly the columns below. No nesting, no subcollections. The same rows round-trip to `data/maps.csv`, `data/items.csv`, `data/placements.csv` (Papa Parse, UTF-8, RFC 4180, header row); the CSVs are the import output, the seed for the emulator, and what the admin export button produces.

## What deleting means

The app never removes a row. Deleting sets `status=deleted` plus `updated_by`/`updated_at`; restoring sets it back. The Firebase snapshot the import ran from stays in `data/firebase-snapshot-2026-11-03/`, untouched — anything the import leaves out is still there.

Common columns on every row:

| Column | Meaning |
|---|---|
| `status` | `active` or `deleted` |
| `created_by`, `created_at` | email; ISO 8601 UTC |
| `updated_by`, `updated_at` | email; ISO 8601 UTC |

## `maps` — one row per historical map

| Column | Example | Notes |
|---|---|---|
| `map_id` | `debarbari` | Stable. Firebase key for imported maps |
| `name` | `Jacopo de'Barbari` | |
| `year` | `1500` | Integer |
| `parent` | | Groups maps in the picker |
| `description` | | |
| `author`, `source`, `collection`, `scale` | | The old info-bar pill keys |
| `tiles_url` | `https://…s3…/debarbari/{z}/{x}/{y}.png` | Local `/tiles/…` path until S3 |
| `tile_scheme` | `tms` | `tms` (y flipped, gdal2tiles) or `xyz` |
| `crs` | `legacy-mercator` | `legacy-mercator` for the gdal2tiles maps; `pixel` for maps tiled by the new uploader |
| `min_zoom`, `max_zoom` | `2`, `8` | Measured from the tile tree at import |
| `bounds` | `[[-85,-180],[-46,73]]` | JSON, as Firebase had it |
| `image_width`, `image_height` | | `pixel` maps only |
| `source_image_url` | | Original upload, if kept |
| `metadata_json` | | Any other key the map had |

## `items` — one row per thing that exists in Venice

The layer lives here. There is no layers file: an item belongs to exactly one layer, and the layer's name, colour and parent are columns on the item.

| Column | Example | Notes |
|---|---|---|
| `item_id` | `53` | Firebase key for imported items |
| `code` | | The GIS code |
| `name` | `Demolished Church of the Templari` | |
| `link` | `https://wiki.cityknowledge.org/…` | Already rewritten; see Import |
| `layer_id` | `demolished-church` | |
| `layer_name` | `Churches - Demolished` | |
| `layer_color` | `#ff8c82` | |
| `layer_parent` | | Groups layers in the picker |
| `map_ids` | `1525\|1635\|debarbari` | redundant: maps with an active placement |
| `metadata_json` | `{"number":12}` | Extra properties (`number`, `numero`) |

**Layer rules.** The layer list is the distinct `layer_id`s across active items. A new layer comes into being with its first item: the editor's "new layer" fields sit in the new-item form. Renaming or recolouring a layer rewrites `layer_*` on every item and placement with that `layer_id`. Firestore commits that in batches; the write is idempotent, so a failed batch is retried, not rolled back. When the last item of a layer is deleted, the layer disappears from the picker and comes back on restore.

## `placements` — one row per polygon on one map

| Column | Example | Notes |
|---|---|---|
| `placement_id` | `53@debarbari` | `item_id@map_id`; one polygon per item per map |
| `item_id`, `map_id` | | |
| `item_name`, `item_code`, `item_link` | | redundant copies |
| `layer_id`, `layer_name`, `layer_color` | | redundant copies |
| `map_name`, `map_year` | | redundant copies |
| `geometry` | `{"type":"Polygon","coordinates":[[[-75.2,-80.3],…]]}` | GeoJSON string, lon/lat on the map's own `crs`; see Import for the longitude wrap |
| `center_lat`, `center_lng` | | Bounding-box centre of this polygon on this map |

The viewer draws a layer from placements alone — one query on `map_id` + `layer_id`, no join.

## Import

`scripts/import-firebase.ts` reads the snapshot and writes the three CSVs; `scripts/seed-firestore.ts` loads them into Firestore (emulator locally). The import is a pure function of its input: same snapshot, byte-identical CSVs. If the old Firebase is edited after the snapshot, take a new snapshot and re-run.

**What carries over: what the old viewer could show.** Anything no screen of `main` could reach is left in the snapshot.

| Kept | Count | Reached by |
|---|---|---|
| Items with a name or code, or with a polygon in a menu layer | 1,228 | search or layer toggle |
| Polygons whose item exists and has a layer | 2,105 | layer toggle |
| San Servolo's polygon on `bordone` (layer `lagoon-isles`, not in the menu) | 1 | search → open on map |

| Left in the snapshot | Count | Why nothing showed it |
|---|---|---|
| Polygons whose item record is gone | 2,044 | the viewer only fetches geometry for items it has |
| Records with nothing but a `maps` list (ids `10`, `69`, `194`, six push keys) | 9 | no name, no code, no layer |
| Their polygons | 25 | no layer to toggle |

Other import rules:

- **Links.** `venipedia.org` → `wiki.cityknowledge.org`, `www.` dropped, `http://` → `https://`, written into `link` (47 rows). The render-time rewrite is gone.
- **Canals.** The layer stored with id `""` becomes `canals`.
- **`lagoon-isles`.** Not in the old layers list; imported with `layer_name=lagoon-isles` and the colour the old viewer fell back to, `#3388ff`. The admin names it.
- **`map_ids`** is rebuilt from placements. The old `maps` array is dropped; where it listed a map with no polygon (53 cases), that map just led to an empty view.
- **Longitudes wrapped.** Leaflet 0.7 repeated the tiles but not the shapes, so some polygons were drawn on a copy of the map (longitudes seen from −797 to 462). Each is shifted by whole turns of 360° until its mean longitude is in [−180, 180): same tile, same pixel. Afterwards 2,105 of 2,106 centres fall inside their map's image; the one outside (San Giorgio Maggiore on `debarbari`) was drawn off the image and is kept for an admin to move.
- **Centres** are computed per placement from the polygon. The old single `center` and `zoom` per feature are dropped: one centre cannot be right on eight differently drawn maps.
- **`min_zoom`** is the old viewer's 2; **`max_zoom`** and **`bounds`** come from `data/tile-extents.json`, measured off the tile tree by `scripts/measure-tiles.ts` (replaces the `debarbari ? 8 : 7` hack, D3).
- **Tiles** point at `https://cartography.veniceprojectcenter.org/maps/<folder>/{z}/{x}/{-y}.png` until S3; `bordone` is folder `1528` (D20).

## Local trial store

Until Firestore is wired, `app/api/rows` reads and writes the three CSVs directly, in development only. Same rows, same columns, so the move is an adapter swap.

Import checks, printed as counts; the import fails if they don't reconcile with the tables above.
