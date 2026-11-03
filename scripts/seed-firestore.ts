// data/*.csv -> Firestore, one collection per table, document id = row key.
//
// Create-only: a document that already exists is left as it is and counted as skipped, so running
// this again never undoes an edit made in the app. Against a real project it needs --live and
// GOOGLE_APPLICATION_CREDENTIALS; without --live it refuses to run anywhere but the emulator.
//
//   npm run seed                                   (emulator, project demo-cartography)
//   FIREBASE_PROJECT_ID=… npx tsx scripts/seed-firestore.ts --live

import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { TABLES, TABLE_COLUMNS, TABLE_KEY } from "../lib/rows";
import { admin_db, use_emulator } from "../lib/firebase-admin";

async function main() {
  const live = process.argv.includes("--live");
  if (!live) use_emulator();
  const db = admin_db();
  const writer = db.bulkWriter();
  // 6 = ALREADY_EXISTS: someone's row, keep it, don't retry.
  writer.onWriteError((e) => e.code !== 6 && e.failedAttempts < 3);
  // Each write settles to null or its error, so nothing is left as an unhandled rejection.
  const pending: { table: string; result: Promise<{ code?: number } | null> }[] = [];

  for (const table of TABLES) {
    const parsed = Papa.parse<Record<string, string>>(readFileSync(`data/${table}.csv`, "utf8"), { header: true, skipEmptyLines: true });
    if (parsed.errors.length) throw new Error(`${table}.csv: ${parsed.errors[0].message}`);
    const columns = TABLE_COLUMNS[table];
    const key = TABLE_KEY[table];
    for (const row of parsed.data) {
      const data = Object.fromEntries(columns.map((c) => [c, row[c] ?? ""]));
      pending.push({ table, result: writer.create(db.collection(table).doc(row[key]), data).then(() => null, (e) => e) });
    }
  }
  await writer.close();

  const counts: Record<string, { created: number; skipped: number }> = {};
  for (const { table, result } of pending) {
    const error = await result;
    const tally = (counts[table] ??= { created: 0, skipped: 0 });
    if (!error) tally.created++;
    else if (error.code === 6) tally.skipped++;
    else throw error;
  }
  console.table(counts);
  console.log(`happily seeded ${live ? "the live project" : "the emulator"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
