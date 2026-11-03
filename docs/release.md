# Release

What it takes to go from the local trial to the live site. Everything here happens in your own Firebase and AWS accounts. The code is ready for it and has been run end to end against the Firebase emulator, not yet against a real project or bucket.

## 1. Firebase project

1. Create a new project in the Firebase console. Do not use either of the two the old app used.
2. **Authentication → Sign-in method:** turn on Email/Password. Leave everything else off; the app has no sign-up.
3. **Firestore Database:** create it in production mode, in a European region (Venice data, Italian host).
4. **Project settings → Your apps:** add a Web app. Its config goes into the `NEXT_PUBLIC_FIREBASE_*` variables (`.env.example`).
5. **Project settings → Service accounts:** generate a private key. That JSON file is what `GOOGLE_APPLICATION_CREDENTIALS` points at, on your machine for the scripts and on the host for the image route. It never goes in git.

Deploy the security rules (`firebase login` first):

```bash
firebase deploy --only firestore:rules --project <project-id>
```

Load the rows. This is create-only: rows that already exist are skipped, so running it twice is harmless and never undoes an edit.

```bash
FIREBASE_PROJECT_ID=<project-id> GOOGLE_APPLICATION_CREDENTIALS=<key.json> npx tsx scripts/seed-firestore.ts --live
```

Admins: create each account in **Authentication → Users**, then:

```bash
FIREBASE_PROJECT_ID=<project-id> GOOGLE_APPLICATION_CREDENTIALS=<key.json> npx tsx scripts/grant-admin.ts someone@example.org --live
```

## 2. S3 bucket

1. Create a bucket, for example in `eu-south-1` (Milan).
2. **Reads are public** (the viewer loads tiles directly). Turn off "Block public access" for bucket policies only, and allow `s3:GetObject` on `arn:aws:s3:::<bucket>/tilesets/*` and `arn:aws:s3:::<bucket>/maps/*`. Nothing else is public.
3. **CORS.** GET from any origin, because tiles are read with `crossOrigin` so the PNG export works. PUT from the site's origin, with the headers `Content-Type` and `Cache-Control`:

   ```json
   [
     { "AllowedMethods": ["GET"], "AllowedOrigins": ["*"], "AllowedHeaders": ["*"] },
     { "AllowedMethods": ["PUT"], "AllowedOrigins": ["https://<site>"], "AllowedHeaders": ["Content-Type", "Cache-Control"] }
   ]
   ```

4. **The app's own IAM user** needs only `s3:PutObject` on `tilesets/*` and `s3:ListBucket` limited to the prefix `tilesets/`. It cannot delete anything, which matches the rule that the app never removes data.
5. Set `IMAGE_STORE=s3`, `S3_BUCKET`, `S3_REGION`, the two `AWS_*` keys, and optionally `S3_PUBLIC_URL` for a CDN.

## 3. Move the old tiles off the old host

The eight maps still read their tiles from cartography.veniceprojectcenter.org. To move them:

```bash
aws s3 sync maps/ s3://<bucket>/maps/ --cache-control "public, max-age=31536000, immutable"
```

Then, signed in, open each map's sheet (Maps → pencil) and change its tile URL to `https://<bucket>.s3.<region>.amazonaws.com/maps/<folder>/{z}/{x}/{-y}.png`. Bordone's folder is `1528`. The frame doesn't change, so the shapes stay put. The old URL stays in the map's tile history, so you can switch back from the same sheet.

## 4. Host

The app needs a Node server for one route, `/api/tiles`, which signs uploads. So it can't be a static export. Vercel or Firebase App Hosting both work. On the host:

- **Set:** `NEXT_PUBLIC_BACKEND=firebase`, the `NEXT_PUBLIC_FIREBASE_*` config, `GOOGLE_APPLICATION_CREDENTIALS` or the host's own service-account mechanism, and the S3 variables.
- **Leave unset:** `NEXT_PUBLIC_FIREBASE_EMULATORS` and the `*_EMULATOR_HOST` lines.

`/api/rows`, `/api/session` and `/api/local-tiles` belong to the local trial and refuse to run in production.

## Before switching the domain

- **Read cost.** Each visit reads every active row, about 3,342 Firestore documents. The free allowance covers about 15 visits a day; beyond that, about $0.002 a visit (`docs/data-model.md`, Where the rows live).
- **The old app.** It stays on `main`, untouched, and the snapshot it was imported from is in `data/firebase-snapshot-2026-11-03/`. Edits made in the old app after that date are not in the new one; take a new snapshot and re-import first if there are any.
