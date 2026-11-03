// The local database: three CSV files in data/. Server-only.
// One process, one writer: writes are chained so two saves never interleave on the same file.

import { readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import Papa from "papaparse";
import { TABLE_COLUMNS, TABLE_KEY, type Table } from "./rows";

const DATA_DIR = join(process.cwd(), "data");

let writeChain: Promise<unknown> = Promise.resolve();

export async function read_table(table: Table): Promise<Record<string, string>[]> {
  const text = await readFile(join(DATA_DIR, `${table}.csv`), "utf8");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`${table}.csv: ${parsed.errors[0].message} (row ${parsed.errors[0].row})`);
  return parsed.data;
}

// Upsert by key. Rows are never removed here; deleting is a status change made by the caller.
export function upsert_rows(table: Table, incoming: Record<string, string>[]): Promise<number> {
  const run = writeChain.then(async () => {
    const columns = TABLE_COLUMNS[table];
    const key = TABLE_KEY[table];
    const rows = await read_table(table);
    const index = new Map(rows.map((r, i) => [r[key], i]));
    for (const row of incoming) {
      if (!row[key]) throw new Error(`${table}: a row has no ${key}`);
      const clean = Object.fromEntries(columns.map((c) => [c, row[c] ?? ""]));
      const at = index.get(row[key]);
      if (at === undefined) {
        index.set(row[key], rows.length);
        rows.push(clean);
      } else {
        rows[at] = clean;
      }
    }
    const text = Papa.unparse({ fields: [...columns], data: rows.map((r) => columns.map((c) => r[c] ?? "")) }, { newline: "\n" }) + "\n";
    // Write beside, then rename: a crash mid-write leaves the old file whole.
    const path = join(DATA_DIR, `${table}.csv`);
    await writeFile(`${path}.tmp`, text);
    await rename(`${path}.tmp`, path);
    return incoming.length;
  });
  writeChain = run.catch(() => undefined);
  return run;
}
