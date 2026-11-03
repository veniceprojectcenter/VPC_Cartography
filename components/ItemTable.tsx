"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Pencil, RotateCcw, Trash2 } from "lucide-react";
import Sheet from "./Sheet";
import type { ItemRow, Layer, MapRow, PlacementRow } from "@/lib/rows";
import type { Dataset } from "@/lib/store-client";
import type { ItemFields } from "@/lib/edits";

// Every item in one table, for the work the map is slow at: finding by name or code across all
// layers and maps, fixing details in place, and bringing back what was deleted.

type Props = {
  data: Dataset;
  layers: Layer[];
  mapsById: Map<string, MapRow>;
  saving: boolean;
  onSave: (item: ItemRow, fields: ItemFields, layer: Layer) => Promise<boolean>;
  onDelete: (item: ItemRow) => void;
  onRestore: (item: ItemRow) => void;
  onRestorePlacement: (placement: PlacementRow) => void;
  onOpenOn: (item: ItemRow, mapId: string) => void;
  onClose: () => void;
};

type Sort = "name" | "layer" | "maps";
type Shown = "active" | "deleted" | "all";

// Rows drawn at once; the filter is how you get to the rest.
const PAGE = 100;

export default function ItemTable(p: Props) {
  const [query, setQuery] = useState("");
  const [layerId, setLayerId] = useState("");
  const [shown, setShown] = useState<Shown>("active");
  const [sort, setSort] = useState<Sort>("name");
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Deleted items keep their layer columns, so a layer with only deleted items is still filterable.
  const allLayers = useMemo(() => {
    const byId = new Map<string, string>();
    for (const i of p.data.items) if (!byId.has(i.layer_id)) byId.set(i.layer_id, i.layer_name);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [p.data.items]);

  const placementsByItem = useMemo(() => {
    const out = new Map<string, PlacementRow[]>();
    for (const pl of p.data.placements) out.set(pl.item_id, [...(out.get(pl.item_id) ?? []), pl]);
    return out;
  }, [p.data.placements]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const mapsOf = (i: ItemRow) => (placementsByItem.get(i.item_id) ?? []).filter((pl) => pl.status === "active").length;
    return p.data.items
      .filter((i) => (shown === "all" || i.status === shown) && (!layerId || i.layer_id === layerId) && (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q) || i.item_id.toLowerCase() === q))
      .sort((a, b) =>
        sort === "layer" ? a.layer_name.localeCompare(b.layer_name) || a.name.localeCompare(b.name, undefined, { numeric: true })
        : sort === "maps" ? mapsOf(b) - mapsOf(a) || a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [p.data.items, placementsByItem, query, layerId, shown, sort]);

  const deletedCount = useMemo(() => p.data.items.filter((i) => i.status === "deleted").length, [p.data.items]);

  return (
    <Sheet title="Items" onClose={p.onClose} wide>
      <div className="table-tools">
        <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(PAGE); }} placeholder="Find by name or code" aria-label="Find by name or code" autoFocus />
        <select value={layerId} onChange={(e) => { setLayerId(e.target.value); setLimit(PAGE); }} aria-label="Layer">
          <option value="">All layers</option>
          {allLayers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="segmented" role="tablist" aria-label="Which items">
          {(["active", "deleted", "all"] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={shown === s} className={shown === s ? "on" : ""} onClick={() => { setShown(s); setLimit(PAGE); }}>
              {s === "active" ? "In use" : s === "deleted" ? `Deleted${deletedCount ? ` (${deletedCount})` : ""}` : "All"}
            </button>
          ))}
        </div>
      </div>
      <p className="note table-count">{rows.length === 0 ? "No items match." : `${rows.length.toLocaleString()} ${rows.length === 1 ? "item" : "items"}${rows.length > limit ? `, showing the first ${limit}` : ""}.`}</p>

      <div className="table-scroll">
        <table className="items">
          <thead>
            <tr>
              <SortHead label="Name" by="name" sort={sort} onSort={setSort} />
              <SortHead label="Layer" by="layer" sort={sort} onSort={setSort} />
              <SortHead label="Maps" by="maps" sort={sort} onSort={setSort} />
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((item) =>
              editing === item.item_id ? (
                <EditRow key={item.item_id} item={item} layers={p.layers} saving={p.saving} onCancel={() => setEditing(null)}
                  onSave={async (fields, layer) => { if (await p.onSave(item, fields, layer)) setEditing(null); }} />
              ) : (
                <tr key={item.item_id} className={item.status === "deleted" ? "deleted" : ""}>
                  <td>
                    <div className="cell-name">
                      {item.link ? <a href={item.link} target="_blank" rel="noreferrer">{item.name || "Untitled"} <ExternalLink /></a> : item.name || "Untitled"}
                    </div>
                    {item.code && <span className="code">{item.code}</span>}
                  </td>
                  <td><span className="layer-tag"><span className="swatch" style={{ background: item.layer_color }} />{item.layer_name}</span></td>
                  <td>
                    <ul className="map-chips">
                      {(placementsByItem.get(item.item_id) ?? [])
                        .sort((a, b) => Number(a.map_year) - Number(b.map_year))
                        .map((pl) => {
                          const live = pl.status === "active";
                          // A shape removed from a map can come back only while its item is in use.
                          const restorable = !live && item.status === "active";
                          return (
                            <li key={pl.placement_id}>
                              <button type="button" className={`chip ${live ? "" : "removed"}`} disabled={p.saving || (!live && !restorable)}
                                title={live ? `Open on ${pl.map_name}` : restorable ? `Removed from ${pl.map_name}. Click to put it back.` : `Deleted with the item`}
                                onClick={() => (live ? p.onOpenOn(item, pl.map_id) : p.onRestorePlacement(pl))}>
                                {p.mapsById.get(pl.map_id)?.year ?? pl.map_year}{restorable && <RotateCcw />}
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  </td>
                  <td className="row-actions">
                    {item.status === "deleted" ? (
                      <button type="button" onClick={() => p.onRestore(item)} disabled={p.saving}><RotateCcw /> Restore</button>
                    ) : confirming === item.item_id ? (
                      <>
                        <button type="button" onClick={() => setConfirming(null)} disabled={p.saving}>Keep</button>
                        <button type="button" className="destructive" disabled={p.saving} onClick={() => { p.onDelete(item); setConfirming(null); }}>Delete</button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="icon-button small" onClick={() => setEditing(item.item_id)} aria-label={`Edit ${item.name}`}><Pencil /></button>
                        <button type="button" className="icon-button small danger" onClick={() => setConfirming(item.item_id)} aria-label={`Delete ${item.name}`}><Trash2 /></button>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="add-row" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
    </Sheet>
  );
}

function SortHead({ label, by, sort, onSort }: { label: string; by: Sort; sort: Sort; onSort: (s: Sort) => void }) {
  return (
    <th aria-sort={sort === by ? (by === "maps" ? "descending" : "ascending") : "none"}>
      <button type="button" className={`sort ${sort === by ? "on" : ""}`} onClick={() => onSort(by)}>{label}</button>
    </th>
  );
}

function EditRow({ item, layers, saving, onCancel, onSave }: { item: ItemRow; layers: Layer[]; saving: boolean; onCancel: () => void; onSave: (fields: ItemFields, layer: Layer) => void }) {
  const [name, setName] = useState(item.name);
  const [code, setCode] = useState(item.code);
  const [link, setLink] = useState(item.link);
  const [layerId, setLayerId] = useState(item.layer_id);
  const error = !name.trim() ? "A name is needed." : link.trim() && !/^https?:\/\//.test(link.trim()) ? "Links start with https://" : null;
  // The item's own layer stays pickable even if it is the last of its kind and so not in the list.
  const options = layers.some((l) => l.layer_id === item.layer_id) ? layers : [{ layer_id: item.layer_id, layer_name: item.layer_name, layer_color: item.layer_color, layer_parent: item.layer_parent }, ...layers];
  return (
    <tr className="editing">
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
        <input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" placeholder="Code" className="mono" />
      </td>
      <td>
        <select value={layerId} onChange={(e) => setLayerId(e.target.value)} aria-label="Layer">
          {options.map((l) => <option key={l.layer_id} value={l.layer_id}>{l.layer_name}</option>)}
        </select>
      </td>
      <td>
        <input value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link" placeholder="https://…" />
        {error && <span className="error">{error}</span>}
      </td>
      <td className="row-actions">
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="primary" disabled={saving || !!error} onClick={() => onSave({ name, code, link }, options.find((l) => l.layer_id === layerId)!)}>{saving ? "Saving…" : "Save"}</button>
      </td>
    </tr>
  );
}
