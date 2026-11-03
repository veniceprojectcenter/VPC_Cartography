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

**Edit** (top right, dev only) lets you draw, reshape and delete shapes, and edit items, layers and maps. Saves go straight into the CSVs — `git diff data/` shows what you changed, `git checkout data/` takes it back. Deleting never removes a row; it sets `status=deleted`.

## Rebuilding the data

The CSVs are made from the Firebase snapshot in `data/firebase-snapshot-2026-11-03/`:

```
npx tsx scripts/import-firebase.ts
```

Same snapshot in, same bytes out. `scripts/measure-tiles.ts` re-measures zoom levels and image bounds, and needs the tile tree from `main` in `maps/`.

How the rows are laid out: `docs/data-model.md`. Where this is going (Firestore, Firebase Auth, S3, in-browser tiling): `docs/architecture.md`.
