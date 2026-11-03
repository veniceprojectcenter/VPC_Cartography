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
└── images        tiles and source images
                  ├── local: dev-only route handler writes into maps/ on disk
                  └── s3:    route handler checks the Firebase ID token, returns presigned PUT URLs
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

Image in, XYZ pyramid out, in a Web Worker so the page stays live. Library first: wasm-vips (`dzsave`, Google layout), which streams instead of decoding the whole image — the de'Barbari source is far past the browser's canvas size limit. Needs `SharedArrayBuffer`, so the uploader route sets COOP/COEP headers.

**To verify first:** that the wasm-vips build exposes `dzsave` to an in-memory target. If it does not, the fallback is region decoding with `createImageBitmap` + `OffscreenCanvas` across workers, and the gate for hand-rolling is named in the PR (ali-skills 03 §4).

Uploaded maps get `crs=pixel`: coordinates are image pixels, no fake geography.

Two admin paths, as today: upload an image and let it tile, or paste a URL to existing tiles.

## Tiles

Never in git. The 2.5 GB tree from `main` stays on disk in `maps/` (git-ignored on this branch) and is served locally under `/tiles/`. Moving to S3 is a copy of that folder plus a `tiles_url` change per map row.

## Auth

Firebase Auth, email and password, admins only. Accounts are created in the Firebase console and given the `admin` claim by `scripts/grant-admin.ts`; the app offers no sign-up. Locally, the Auth emulator holds a test admin seeded by the same script.

## UI

Ported function, new finish, per ali-skills 11: Apple system colours (blue, white, red, yellow) on neutrals; glass for the toolbar and side sheet because the map is a real backdrop behind them; a side panel for maps and layers instead of nested dropdowns; every action with a visible pending/success/failure state. Concept is approved as a mockup before components are built (11 §10).

## Build order

1. Import Firebase snapshot → CSV, with reconciled counts; seed the Firestore emulator.
2. Viewer baseline on OpenLayers; overlay check against `main`.
3. Remaining viewer features F2–F11.
4. Auth and security rules; editor F13–F18 plus the added controls.
5. Uploader.
6. S3 for images.
