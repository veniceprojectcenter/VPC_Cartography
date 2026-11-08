"use client";

import { useMemo, useState } from "react";
import { ExternalLink, FileUp } from "lucide-react";
import Sheet from "./Sheet";
import type { MapRow } from "@/lib/rows";
import { catalog_meta, is_tiled, similar_counts } from "@/lib/catalog";

// The prior team's maps, to look at before deciding which belong in the list. Tiling one is a
// step you take on purpose, from here; most of them never need it.

type Props = {
  // Catalog maps, and the list's maps (only to flag entries that look like one already there).
  catalog: MapRow[];
  listed: MapRow[];
  saving: boolean;
  onExplore: (map: MapRow) => void;
  onPromote: (map: MapRow) => void;
  onImport: () => void;
  onClose: () => void;
};

type Shown = "all" | "untiled" | "tiled";
const PAGE = 100;

// A full page load: the uploader is served cross-origin isolated, the viewer is not.
function open_uploader(map: MapRow) {
  window.location.assign(new URL(`/upload?map=${encodeURIComponent(map.map_id)}`, window.location.href));
}

export default function CatalogSheet(p: Props) {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<Shown>("all");
  const [limit, setLimit] = useState(PAGE);
  const similar = useMemo(() => similar_counts([...p.catalog, ...p.listed]), [p.catalog, p.listed]);
  const tiledCount = useMemo(() => p.catalog.filter(is_tiled).length, [p.catalog]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.catalog
      .filter((m) => (shown === "all" || (shown === "tiled") === is_tiled(m)) && (!q || [m.name, m.year, m.author, m.collection].some((v) => v.toLowerCase().includes(q))))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.year.localeCompare(b.year));
  }, [p.catalog, query, shown]);

  return (
    <Sheet title="Catalog" onClose={p.onClose} wide>
      <div className="table-tools">
        <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Find by title, year, author or collection" aria-label="Find in the catalog" autoFocus />
        <div className="segmented" role="tablist" aria-label="Which maps">
          {(["all", "untiled", "tiled"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={shown === s} className={shown === s ? "on" : ""} onClick={() => { setShown(s); setLimit(PAGE); }}>
              {s === "all" ? "All" : s === "untiled" ? "Not tiled" : `Tiled${tiledCount ? ` (${tiledCount})` : ""}`}
            </button>
          ))}
        </div>
        <button type="button" onClick={p.onImport}><FileUp /> Import a list</button>
      </div>
      <p className="note table-count">
        {p.catalog.length === 0
          ? "The catalog is empty. Import the list of maps from the prior team (CSV or JSON)."
          : rows.length === 0 ? "No maps match."
          : `${rows.length.toLocaleString()} of ${p.catalog.length.toLocaleString()} ${p.catalog.length === 1 ? "map" : "maps"}${rows.length > limit ? `, showing the first ${limit}` : ""}. Tiling is per map and kept for good; nothing here tiles by itself.`}
      </p>

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="items">
            <thead>
              <tr><th>Map</th><th>Year</th><th>State</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((m) => {
                const meta = catalog_meta(m);
                const tiled = is_tiled(m);
                const like = similar.get(m.map_id);
                return (
                  <tr key={m.map_id}>
                    <td>
                      <div className="cell-name">
                        {meta?.record_url ? <a href={meta.record_url} target="_blank" rel="noreferrer">{m.name} <ExternalLink /></a> : m.name}
                      </div>
                      <span className="code">{[m.author, m.collection].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="year">{m.year || "—"}</td>
                    <td>
                      <span className="note">{tiled ? "Tiled" : "Not tiled"}</span>
                      {like ? <span className="note"> · same title and year as {like} other{like === 1 ? "" : "s"}</span> : null}
                    </td>
                    <td className="row-actions">
                      {tiled ? (
                        <>
                          <button type="button" onClick={() => p.onExplore(m)}>Explore</button>
                          <button type="button" className="primary" disabled={p.saving} onClick={() => p.onPromote(m)}>Add to maps list</button>
                        </>
                      ) : (
                        <button type="button" className="primary" onClick={() => open_uploader(m)}>Tile to explore</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > limit && <button type="button" className="add-row" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
    </Sheet>
  );
}
