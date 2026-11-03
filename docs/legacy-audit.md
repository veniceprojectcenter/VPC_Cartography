# Legacy audit

What the `main` app does, what must survive the rewrite, and what is broken. Read against `main` @ `21bcf6e7`.

## Functionality to retain

Every row is a feature of the old app. The rewrite is not done until each one works.

| # | Feature | Old site |
|---|---|---|
| F1 | Pan/zoom a historical map from TMS tiles, minimap, "view all" button | `MapManager.switchMap`, `initMap` |
| F2 | Map picker, grouped by `parent`, sorted by year, active map highlighted | `MapManager.initMenu` |
| F3 | Map info bar: title (year), description, metadata pills | `main.js updateMapInfoBar` |
| F4 | Layer picker, grouped by `parent`, sorted by name, toggle on/off, multiple at once | `LayerManager.initMenu`, `toggleLayer` |
| F5 | Polygons drawn in the layer colour; click → popup with name, link, code | `LayerManager.enableLayer` |
| F6 | Popup lists the other maps the feature appears on, sorted by year; click jumps there and reselects it | `.show_other_map` handler |
| F7 | Search by name or code, fuzzy (Levenshtein ≥ 0.8), 12 results, per-map chips, unavailable-on-current marked | `buildSearchMatches` |
| F8 | Deep links `?map=&layer=a\|b&feature=` and a share button that copies the current view | `UrlMap`, `buildShareUrl` |
| F9 | Download the visible map as PNG | `Downloader.getData` |
| F10 | Download a dragged rectangle as PNG | `RectDrawer`, `downloadSection` |
| F11 | Info modal | `#info-modal` |
| F12 | Admin login / logout | `FirebaseAuth-modern` |
| F13 | Admin: draw a polygon; attach it to an existing feature on this map, or create a new feature (name, layer, code, link) | `PolyDrawer.submitFeature` |
| F14 | Admin: edit feature data (name, layer, code, link) | `LayerManager.editFeature` |
| F15 | Admin: edit polygon vertices; shift-click deletes a vertex; backspace undoes the last drawn point | `PolyDrawer` patches |
| F16 | Admin: delete a feature | `LayerManager.deletePoly` |
| F17 | Admin: create a map (name, id, year, tile URL) | `MapManager.addNewMap` |
| F18 | Admin: create a layer (name, id, colour, parent); edit name/colour; delete | `LayerManager.addNewLayer`, `saveEditedLayer`, `deleteLayer` |
| F19 | Venipedia links rewritten to `wiki.cityknowledge.org` over https | `enableLayer` popup |

## Defects

Found by reading the code and by profiling the Firebase snapshot in `data/firebase-snapshot-2026-11-03/`.

| # | Defect | Evidence | Rewrite answer |
|---|---|---|---|
| D1 | Deleting a feature removes the record and only the current map's polygon. Polygons on other maps stay behind with no owner. | 2,044 of 4,175 polygons have no feature record | Soft delete everywhere, item and its placements together. Orphans are not imported (nothing showed them); they remain in the snapshot |
| D2 | `maps` array on a feature disagrees with where polygons actually are | 195 polygons on maps the feature does not list; 53 listed maps with no polygon | Placement rows are the only truth; `map_ids` is derived from them |
| D3 | `maxZoom` hardcoded: `debarbari ? 8 : 7` | `MapManager.js` "HACK" | `max_zoom` is a column, measured from the tile tree at import |
| D4 | Map/layer create validation is `!(a\|\|b\|\|c)` — only rejects when *all* fields are empty, fails silently on duplicates | `addNewMap`, `addNewLayer` | Per-field validation, errors stated in the form |
| D5 | A layer with id `""` exists (Canals); 140 features point at it | `fb_layers.json` | Given id `canals` |
| D6 | Layer ids go straight into jQuery selectors (`'#'+id+'-layer'`) | `setLayerButtonState` | No DOM ids derived from data |
| D7 | Popups are built by string concatenation of names and links | `enableLayer` | Rendered as components; nothing is injected as HTML |
| D8 | URL layers enabled after a `setTimeout(…, 1250)` race | `main.js` | Load order is explicit: data, then map, then layers, then selection |
| D9 | `?feature=` looks up by name; names repeat | 58 duplicate name+layer pairs | Share links carry the item id; old name links still resolve, first match |
| D10 | Share URL drops the selected feature | `buildShareUrl` | Includes map, layers, item, and view |
| D11 | `discardFeature` references `DATA`, `fb`, `selectedData` — none exist in scope | `PolyDrawer.js` | Removed; cancel discards the sketch |
| D12 | Clone copies the record but not the geometry; UI for it is commented out | `clonePoly` | Replaced by "copy polygon to another map" and "move to another layer" |
| D13 | "Is something selected" is guessed by counting `map._layers` before and after closing the popup | `startPolyMode` "HACK ALERT" | Selection is explicit state |
| D14 | Edit-polygon button gets a duplicate `id` and a new listener per popup | `enableLayer` | Editor mode is a single component |
| D15 | Existing-feature attach writes geometry and map list as two independent writes; the first has no error path | `submitFeature` case A | One placement row per write |
| D16 | `center` is sometimes `[lat,lng]`, sometimes `{lat,lng}`; dblclick zoom "doesn't work" | snapshot; `// XXX Doesn't work?` | Normalised at import; raw kept |
| D17 | One feature has `maps` as an object, not an array | snapshot | Normalised at import |
| D18 | PNG download draws tiles only, no polygons; uses deprecated `initMouseEvent` | `Downloader` | Export from the map renderer, polygons included |
| D19 | Two Firebase SDKs (legacy + v9), two Firebase projects, two analytics tags | `index.html`, `main.js` | One current SDK, one new project |
| D20 | Map `bordone` serves tiles from `maps/1528`; map `1750` has a relative tile path | `fb_maps.json` | Tile location is a column; import resolves it |
| D21 | Sign-up is `alert("Not working yet")` | `showLoginForm` | Not offered |
| D22 | Venipedia link fix is done on every render | `enableLayer` | Applied once at import and saved as the link; the render rule is removed |

## Data oddities

- 9 records with nothing but a `maps` list; one has a stray key `"3": "1696"`. Not imported (see data-model, Import).
- 56 features with an embedded `geometry` beside the one in `geometries/`. Only `geometries/` was ever drawn; that is what is imported.
- Extra properties `number` (139) and `numero` (1) go to `metadata_json`; one record's stray top-level `name`/`link` is a typo copy of its real name and is dropped.
- Layer colours stored as names (`brown`, `purple`) or hex. Data, not UI palette — kept as given.

Everything not imported is still in `data/firebase-snapshot-2026-11-03/`.
