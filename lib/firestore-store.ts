// Firestore as the row store: one collection per table, one document per row, document id = the row key.

import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { firebase } from "./firebase-client";
import { TABLE_COLUMNS, TABLE_KEY, type Table } from "./rows";

// A batch holds at most 500 writes (Firestore limits).
const BATCH_LIMIT = 500;

// Visitors may only read active rows (firestore.rules), so their query has to say so; admins read all,
// deleted included, so they can restore. Tile sets are admin-only.
export async function read_collection(table: Table, admin: boolean): Promise<Record<string, string>[]> {
  const { db } = firebase();
  const ref = collection(db, table);
  const snap = await getDocs(admin ? ref : query(ref, where("status", "==", "active")));
  return snap.docs.map((d) => d.data() as Record<string, string>);
}

// Rows are written whole. A table's batches commit one after another; each write is a full row
// keyed by id, so re-sending after a failed batch is safe.
export async function write_rows(table: Table, rows: Record<string, string>[]): Promise<void> {
  const { db } = firebase();
  const columns = TABLE_COLUMNS[table];
  const key = TABLE_KEY[table];
  for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const row of rows.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, table, row[key]), Object.fromEntries(columns.map((c) => [c, row[c] ?? ""])));
    }
    await batch.commit();
  }
}
