# Release

The live site is **cartography2.veniceprojectcenter.org**: the app on Vercel, rows and sign-in on Firebase, tiles on S3. This page records what exists and how each piece was made, so it can be checked or rebuilt.

None of the site's settings is a secret. They are committed in `.env.production`: the Firebase web config, which every browser receives anyway; the bucket name, which is in every tile URL; and the role ARN. The host holds no Firebase key and no AWS key.

## What exists

| Piece | Where | Name |
|---|---|---|
| Firebase project | veniceprojectcenter@gmail.com | `vpc-cartography` (`.firebaserc`) |
| Firestore | `eur3` (Europe) | `(default)` |
| Sign-in | Firebase Auth | Email/Password only (`firebase.json`, `auth`) |
| Bucket | AWS 197392266651, `eu-north-1` | `cartography-maps` |
| Upload role | AWS IAM | `cartography-vercel` |
| Host | Vercel, team `veniceprojectcenters-projects` | project `cartography-v2` |

The old app's Vercel project is a different one and is not touched.

## 1. Firebase

Made with the Firebase CLI, signed in as the VPC account:

```bash
firebase projects:create vpc-cartography --display-name "VPC Cartography"
firebase firestore:databases:create "(default)" --location eur3
firebase apps:create web Cartography
firebase deploy --only firestore:rules,auth
```

`apps:sdkconfig` prints the web config that is in `.env.production`.

**Loading the rows and granting admins** needs a service-account key, only on the machine that runs the scripts. Create it in the console: Project settings → Service accounts → Generate new private key. Keep it outside this folder; it never goes in git or on the host. The host only checks sign-ins, and that needs nothing but the project id.

Loading is create-only: rows that already exist are skipped, so running it twice is harmless and never undoes an edit.

```bash
FIREBASE_PROJECT_ID=vpc-cartography GOOGLE_APPLICATION_CREDENTIALS=<key.json> npx tsx scripts/seed-firestore.ts --live
```

Admins: create each account in **Authentication → Users**, then:

```bash
FIREBASE_PROJECT_ID=vpc-cartography GOOGLE_APPLICATION_CREDENTIALS=<key.json> npx tsx scripts/grant-admin.ts someone@example.org --live
```

## 2. S3

The bucket `cartography-maps`, in `eu-north-1`, is set up like this:

- **Public reads** on `tilesets/*` and `maps/*` only, because the viewer loads tiles directly. Public ACLs stay blocked, so the bucket policy is the only thing that makes anything public.
- **CORS.** GET from any origin, because tiles are read with `crossOrigin` so the PNG export works. PUT only from `https://cartography2.veniceprojectcenter.org`, with the headers `Content-Type` and `Cache-Control`. A new site address has to be added here before uploads from it work.
- **No stored keys.** Vercel gives each function a short-lived OIDC token naming its team, project and environment. An IAM OIDC provider for `https://oidc.vercel.com/veniceprojectcenters-projects` trusts those tokens. The role `cartography-vercel` accepts only `cartography-v2`'s production and preview tokens, and allows only `s3:PutObject` on `tilesets/*` and `s3:ListBucket` on the `tilesets/` prefix. So the site cannot read, overwrite or delete anything else, which matches the rule that the app never removes data. `lib/image-store.ts` swaps the token for the role's credentials when `AWS_ROLE_ARN` is set.

## 3. Move the old tiles off the old host

The eight maps still read their tiles from cartography.veniceprojectcenter.org. To move them:

```bash
aws s3 sync maps/ s3://cartography-maps/maps/ --cache-control "public, max-age=31536000, immutable"
```

Then, signed in, open each map's sheet (Maps → pencil) and change its tile URL to `https://cartography-maps.s3.eu-north-1.amazonaws.com/maps/<folder>/{z}/{x}/{-y}.png`. Bordone's folder is `1528`. The frame doesn't change, so the shapes stay put. The old URL stays in the map's tile history, so you can switch back from the same sheet.

## 4. Host

The app needs a Node server for one route, `/api/tiles`, which signs uploads, so it can't be a static export. `.env.production` carries every setting. Leave `GOOGLE_APPLICATION_CREDENTIALS`, the `AWS_*` keys, `NEXT_PUBLIC_FIREBASE_EMULATORS` and the `*_EMULATOR_HOST` lines unset on Vercel.

`/api/rows`, `/api/session` and `/api/local-tiles` belong to the local trial and refuse to run in production.

## Before switching the domain

- **Read cost.** Each visit reads every active row, about 3,342 Firestore documents. The free allowance covers about 15 visits a day; beyond that, about $0.002 a visit (`docs/data-model.md`, Where the rows live).
- **The old app.** It stays on `main`, untouched, and the snapshot it was imported from is in `data/firebase-snapshot-2026-11-03/`. Edits made in the old app after that date are not in the new one; take a new snapshot and re-import first if there are any.
