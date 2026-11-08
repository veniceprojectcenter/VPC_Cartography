Venetian Historical Map Explorer
================================

An explorable, annotated atlas of Venice as it was drawn between 1500 and 1847, from the Venice Project Center.

This branch is the rewrite: Next.js and OpenLayers, flat CSV rows instead of the old Firebase tree. The original app is on `main`.

## Run it locally

Needs Node 20+.

```
npm install
npm run dev
```

Open http://localhost:3000. Tiles come from cartography.veniceprojectcenter.org; the data is `data/*.csv`.

The top bar holds the two pickers: the map (its name, opens the list of maps) and **Layers** (what is drawn on it). Each opens its own panel with a filter, so long lists stay usable.

**Sign in** (top right) to edit. Locally there is one admin, set in `.env.local` — copy `.env.example`, fill in an email and password, restart. Signed in, **Edit** lets you draw, reshape and delete shapes, and edit items, layers and maps; the door icon signs out. **Items** (in the edit bar) is the whole list as a table: find, fix details in place, delete, and restore. A selected shape can also be moved or copied to another layer (a copy leaves the original), moved to another item, or started from the item's outline on another map. Deletes and moves can be undone from the message that confirms them. Saves go straight into the CSVs — `git diff data/` shows what you changed, `git checkout data/` takes it back. Deleting never removes a row; it sets `status=deleted`.

**New map from an image** (Maps panel, signed in) opens `/upload`. The image is cut into tiles in the browser and uploaded, locally into `uploads/`. A map only switches to new tiles once every tile is stored. A stopped upload can be resumed with the same file, and the map's sheet lists every tile set it has had, so you can go back to an earlier one.

**Catalog** (Maps panel, signed in) holds the prior team's maps that are not in the list yet. Import their list (CSV or JSON), tile one map to explore it, and add it to the maps list only if it is worth keeping; its tiles are kept and never made twice. Nothing tiles in bulk.

## Run it on Firebase, locally

The same app on Firestore and Firebase Auth, using the emulator (Java 11+ and `firebase-tools`). Nothing reaches a real project: the project id is `demo-cartography`.

```
npm run emulators
npm run seed
npm run grant-admin -- you@example.org --password <password>
```

Then add the Firebase lines from `.env.example` to `.env.local` (`NEXT_PUBLIC_BACKEND=firebase`, project `demo-cartography`, emulators on) and restart `npm run dev`. The emulator keeps its data in `.emulator-data/` between runs.

Going live: `docs/release.md`.

## Rebuilding the data

The CSVs are made from the Firebase snapshot in `data/firebase-snapshot-2026-11-03/`:

```
npx tsx scripts/import-firebase.ts
```

Same snapshot in, same bytes out. `scripts/measure-tiles.ts` re-measures zoom levels and image bounds, and needs the tile tree from `main` in `maps/`. `npm run check` tests the rules that keep a half-uploaded or mismatched tile set from going live, how a layer move or copy changes the rows, and how the catalog imports and promotes.

How the rows are laid out: `docs/data-model.md`. How it fits together: `docs/architecture.md`.
