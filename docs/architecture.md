# Architecture

Disposition: **keep**. Production bar, full spec and sweep (ali-skills 02 §2).

## Shape

All client side, static where it can be. There is no method here to protect — it is rendering, editing and image tiling, which is commodity work and belongs in the browser (ali-skills 08 §2).

```
Next.js (App Router)
├── viewer        map + layers + search + share + export     (public)
├── editor        draw/edit polygons, items, layers, maps     (admin)
├── uploader      image → tile pyramid, in a Web Worker       (admin)
├── rows          Firestore: maps, items, placements          (public read, admin write)
├── auth          Firebase Auth, email + password             (admins only, no sign-up)
└── images        tile sets and their source images
                  ├── local: dev-only route handlers sign PUT URLs and serve uploads/ on disk
                  └── s3:    route handler checks the admin, returns presigned PUT URLs
```

A new Firebase project, not either of the two the old app used. Locally everything runs on the Firebase Emulator Suite (Auth + Firestore), seeded from `data/*.csv`; nothing touches a real project until it is pointed at one. Security rules: anyone reads rows with `status=active`; writes need a signed-in user with an `admin` custom claim. S3 holds images only.

The one server-side piece is presigning S3 uploads, because AWS credentials cannot ship to the browser. It is a single Next route handler and holds no state.

Orchestrator per screen, recipe functions per step, named for their output (ali-skills 03 §1–2).

## Map renderer: OpenLayers

Leaflet 1.x and Leaflet.draw are what the old app runs on; Leaflet.draw is effectively unmaintained, and the old code had to monkey-patch its internals for vertex deletion and backspace undo (`PolyDrawer.js`). OpenLayers is actively released and has the editing pieces as first-class interactions: `Draw`, `Modify` (with a delete-vertex condition), `Snap`, `Select`, `Translate`, plus custom projections for image-space maps. It is the largest of the three in bundle size; the viewer lazy-loads the editing interactions.

Retained behaviour, mapped: F15 shift-click vertex delete → `Modify` `deleteCondition`; backspace undo → `Draw.removeLastPoint()`.

Added admin control: snap to neighbouring polygons, undo/redo stack per edit session, move a whole polygon, copy a polygon from another map as a starting shape, reassign a polygon to another item, item table with inline edit, bulk layer rename/recolour, restore deleted.

**To verify first:** imported polygons are stored in the old Leaflet frame (lng shifted by +360 on a Mercator TMS). The first build step overlays every imported polygon on its tiles; the buildings must line up exactly as on `main` before anything else is built.

## Uploader: client-side tiling

`/upload`. Image in, tile pyramid out, in a Web Worker so the page stays live, then straight to storage.

**Library.** wasm-vips 0.0.19 does the decoding and resizing. Its build has no `dzsave` (checked: `Image.prototype.dzsave` is undefined), the case the spec named as its fallback. So the pyramid is cut by `public/tiler/pyramid.js`, about a hundred lines, with vips still doing the pixel work. Canvas would not do: de'Barbari at full zoom is about 46,000 × 20,000 px, past every browser's canvas limit.

**Memory.** wasm-vips can use at most 2 GB, and that image decoded whole is about 2.8 GB. So nothing is held whole:

- The file sits in the emscripten file system (JS memory, outside the wasm heap).
- It is read once, top to bottom, in 256-row strips; vips decodes only those rows.
- Each strip is cut into tiles, halved, and handed to the next level down. That level cuts its own tiles once it has 256 rows, and so on.

One pass makes every level. Measured in Node on a 46,080 × 20,000 test JPEG of 479 MB: 19,037 tiles, exactly the planned count, in 106 s, with memory flat at about 1.7 GB. Tiles are 256 px WebP. Edge tiles are padded with transparency, never stretched.

**Isolation.** Threads need `SharedArrayBuffer`, which needs a cross-origin-isolated page. `next.config.ts` sends COOP/COEP on `/upload` and on the worker's files only; the viewer is untouched.

**No half-uploaded tiles.** Each upload is its own tile set in its own folder; a map only ever points at a complete one; a stopped upload resumes with the same file. The rules are in `docs/data-model.md` (`tilesets`). Checked in the browser: stopped at 246 of 2,017 tiles, the map kept its old tiles, the resume sent only the rest, and an earlier set was shown again from the map's sheet.

Uploaded maps get `crs=pixel`: coordinates are image pixels, no fake geography. The viewer gives each such map its own OpenLayers projection and tile grid (`components/MapView.tsx`, `map_frame`).

Two admin paths, as today: upload an image, or give links to existing tiles. Either way the map's history of tile sets is in its sheet.

## Tiles

Never in git. The 2.5 GB tree from `main` stays on disk in `maps/` (git-ignored on this branch). Until release the maps read their tiles from cartography.veniceprojectcenter.org. Moving them to S3 is a copy of that folder plus a tile URL change per map in its sheet. Because the frame is the same, the guard allows it, and the old URL stays as an earlier tile set (`docs/release.md`).

## Auth

Firebase Auth, email and password, admins only. Accounts are created in the Firebase console and given the `admin` claim by `scripts/grant-admin.ts`; the app offers no sign-up. A signed-in account without the claim is treated as signed out. Locally, the Auth emulator holds a test admin made by the same script.

The image route checks the caller itself: a Firebase ID token verified with the Admin SDK, or, on the CSV trial, the local admin's signed cookie (`lib/server-auth.ts`).

Checked on the emulator. Visitors read active rows but not tile sets, deleted rows or an unfiltered list, and cannot write. Admins write rows only with their own id as key and a known status. Nobody can delete a row, admins included.

## UI

Ported function, new finish, per ali-skills 11: Apple system colours (blue, white, red, yellow) on neutrals; glass for the toolbar and side sheet because the map is a real backdrop behind them; a side panel for maps and layers instead of nested dropdowns; every action with a visible pending/success/failure state. Concept is approved as a mockup before components are built (11 §10).

## Build order

1. Import Firebase snapshot → CSV, with reconciled counts; seed the Firestore emulator. **Done.**
2. Viewer baseline on OpenLayers; overlay check against `main`. **Done.**
3. Remaining viewer features F2–F11. **Done.**
4. Auth and security rules; editor F13–F18 plus the added controls. **Done.** The added controls:
   - **Undo** on every delete, restore and move, from its toast.
   - **Shape editing** has undo and redo (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y).
   - **Item table** (Edit → Items): find by name or code across every layer and map, sort, edit in place, delete, restore, and put back a shape removed from one map.
   - **Move a shape** to another item, or to a new item made from it. An item has one shape per map, so a target already drawn there is refused, with the reason.
   - **Start a shape from the item's outline on another map.** It is placed in the middle of the view at a third of its size, keeping the outline's proportions, then opened for reshaping.
   - **Move and copy to another layer** (Inspector). Move changes the item's layer on every map, or only this map's shape (it becomes a new item); copy leaves the original and makes a second item with the same outline. Both undoable. An item belongs to one layer, so "copy to a layer" is a second item, not one item in two layers.
   - **Minimap** (`components/MiniMap.ts`): the whole map at one fixed resolution with a box on the viewed part; click or drag to move. `ol/control/OverviewMap` re-fits itself to the main view, which is why it showed a fragment.
5. Uploader. **Done.**
   - **Catalog.** Maps from the prior team's list are `maps` rows with `status=catalog`: tile one to explore it, add it to the maps list if it is worth keeping (`docs/data-model.md`, Catalog).
6. S3 for images. **Done in code**, checked through the local store that speaks the same signed-URL contract; not yet run against a real bucket.
7. Release: `docs/release.md`.
