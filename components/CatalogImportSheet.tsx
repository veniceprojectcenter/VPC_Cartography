"use client";

import { useMemo, useState } from "react";
import { FileUp } from "lucide-react";
import Sheet from "./Sheet";
import type { MapRow } from "@/lib/rows";
import { catalog_import, read_catalog_file } from "@/lib/catalog";

type Props = {
  existing: MapRow[];
  by: string;
  saving: boolean;
  onImport: (entries: MapRow[]) => void;
  onClose: () => void;
};

// Reads a catalog file here in the browser and shows what importing it would add, before anything
// is written. Importing again is harmless: rows already in the catalog are recognised and left.
export default function CatalogImportSheet(p: Props) {
  const [file, setFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const plan = useMemo(() => {
    if (!file) return null;
    try {
      return catalog_import(file.rows, p.existing, p.by);
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [file, p.existing, p.by]);

  async function choose(f: File | undefined) {
    if (!f) return;
    setProblem(null);
    try {
      setFile({ name: f.name, rows: read_catalog_file(await f.text(), f.name) });
    } catch (e) {
      setFile(null);
      setProblem(`Could not read ${f.name}: ${(e as Error).message}`);
    }
  }

  const ready = plan && "entries" in plan ? plan : null;

  return (
    <Sheet title="Import a catalog list" onClose={p.onClose}
      footer={<>
        <button type="button" onClick={p.onClose} disabled={p.saving}>Cancel</button>
        <button type="button" className="primary" disabled={p.saving || !ready?.entries.length} title={!ready?.entries.length ? "Choose a file with maps to add" : undefined} onClick={() => ready && p.onImport(ready.entries)}>
          {p.saving ? "Saving…" : ready?.entries.length ? `Add ${ready.entries.length.toLocaleString()} to the catalog` : "Add to the catalog"}
        </button>
      </>}>
      <div className="form">
        <p className="note">A CSV with a header row, or a JSON array. Read: title or name, year or date, author, collection, scale, description, an image link and a link to the record. Only the title is needed. Maps already in the list or catalog are never changed.</p>
        <label className="drop">
          <FileUp />
          <span>{file?.name ?? "Choose a .csv or .json file"}</span>
          <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        {problem && <p className="error" role="alert">{problem}</p>}
        {plan && "error" in plan && <p className="error" role="alert">{plan.error}</p>}
        {ready && (
          <dl className="plan">
            <div><dt>New</dt><dd>{ready.entries.length.toLocaleString()}</dd></div>
            <div><dt>Already there</dt><dd>{ready.already.toLocaleString()}</dd></div>
            <div><dt>Skipped</dt><dd>{ready.skipped.length.toLocaleString()}</dd></div>
          </dl>
        )}
        {ready && ready.skipped.length > 0 && (
          <p className="note">Skipped: {ready.skipped.slice(0, 5).map((s) => `line ${s.line} (${s.reason})`).join(", ")}{ready.skipped.length > 5 ? `, and ${ready.skipped.length - 5} more` : ""}.</p>
        )}
      </div>
    </Sheet>
  );
}
