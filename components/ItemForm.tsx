"use client";

import { useMemo, useState } from "react";
import type { ItemRow, Layer, MapRow } from "@/lib/rows";
import type { ItemFields } from "@/lib/edits";
import Sheet from "./Sheet";
import { LayerChoice, NEW_LAYER, useLayerChoice } from "./LayerChoice";

export type ItemFormResult = { kind: "existing"; item: ItemRow } | { kind: "new"; fields: ItemFields; layer: Layer };

type Props = {
  title: string;
  items: ItemRow[];
  layers: Layer[];
  currentMap: MapRow;
  editing?: ItemRow;
  preselectedItem?: ItemRow | null;
  defaultLayerId?: string;
  saving: boolean;
  // Moving a shape: why an existing item cannot take it (shown, and Save disabled), and the button words.
  existingBlocker?: (item: ItemRow) => string | null;
  submitLabels?: { existing: string; new: string };
  onCancel: () => void;
  onSubmit: (result: ItemFormResult) => void;
};

// F13 and F14. A drawn shape is attached to an existing item or makes a new one; editing reuses the new-item half.
export default function ItemForm(p: Props) {
  const startTab = p.editing ? "new" : p.preselectedItem ? "existing" : "existing";
  const [tab, setTab] = useState<"existing" | "new">(startTab);
  const firstLayer = p.editing?.layer_id ?? p.preselectedItem?.layer_id ?? p.defaultLayerId ?? p.layers[0]?.layer_id ?? NEW_LAYER;

  // Existing-item half.
  const [filterLayer, setFilterLayer] = useState(firstLayer === NEW_LAYER ? p.layers[0]?.layer_id ?? "" : firstLayer);
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState(p.preselectedItem?.item_id ?? "");

  // New-item half.
  const [name, setName] = useState(p.editing?.name ?? "");
  const [code, setCode] = useState(p.editing?.code ?? "");
  const [link, setLink] = useState(p.editing?.link ?? "");
  const choice = useLayerChoice(p.layers, firstLayer);
  const [tried, setTried] = useState(false);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.items
      .filter((i) => i.status === "active" && i.layer_id === filterLayer && (!q || i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [p.items, filterLayer, query]);
  const picked = p.items.find((i) => i.item_id === pickedId);
  const blocked = picked && p.existingBlocker ? p.existingBlocker(picked) : null;
  const replacesShape = !p.existingBlocker && picked?.map_ids.split("|").includes(p.currentMap.map_id);

  const errors = {
    name: !name.trim() ? "A name is needed." : "",
    link: link.trim() && !/^https?:\/\//.test(link.trim()) ? "Links start with https://" : "",
  };

  function submit() {
    if (tab === "existing") {
      if (picked) p.onSubmit({ kind: "existing", item: picked });
      return;
    }
    setTried(true);
    if (errors.name || !choice.layer || errors.link) return;
    p.onSubmit({ kind: "new", fields: { name, code, link }, layer: choice.layer });
  }

  const canSubmit = tab === "existing" ? !!picked && !blocked : true;

  return (
    <Sheet title={p.title} onClose={p.onCancel}
      footer={<>
        <button type="button" onClick={p.onCancel} disabled={p.saving}>Cancel</button>
        <button type="button" className="primary" onClick={submit} disabled={p.saving || !canSubmit} title={!canSubmit ? "Pick an item first" : undefined}>
          {p.saving ? "Saving…" : p.editing ? "Save details" : p.submitLabels ? p.submitLabels[tab] : tab === "existing" ? (replacesShape ? "Replace its shape" : "Add shape") : "Create item"}
        </button>
      </>}>
      {!p.editing && (
        <div className="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "existing"} className={tab === "existing" ? "on" : ""} onClick={() => setTab("existing")}>Existing item</button>
          <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>New item</button>
        </div>
      )}

      {tab === "existing" && !p.editing && (
        <div className="form">
          <label>Layer
            <select value={filterLayer} onChange={(e) => { setFilterLayer(e.target.value); setPickedId(""); }}>
              {p.layers.map((l) => <option key={l.layer_id} value={l.layer_id}>{l.layer_name}</option>)}
            </select>
          </label>
          <label>Find
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or code" />
          </label>
          <ul className="pick-list" role="listbox" aria-label="Items">
            {candidates.length === 0 && <li className="empty">No items in this layer match.</li>}
            {candidates.map((i) => {
              const onHere = i.map_ids.split("|").includes(p.currentMap.map_id);
              return (
                <li key={i.item_id}>
                  <button type="button" role="option" aria-selected={i.item_id === pickedId} className={i.item_id === pickedId ? "on" : ""} onClick={() => setPickedId(i.item_id)}>
                    <span>{i.name || "Untitled"}</span>
                    <span className="sub">{i.code}{onHere ? " · already on this map" : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {blocked && <p className="error" role="alert">{blocked}</p>}
          {replacesShape && <p className="note">{picked?.name} already has a shape on {p.currentMap.name}; saving replaces it.</p>}
        </div>
      )}

      {(tab === "new" || p.editing) && (
        <div className="form">
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name of this place" autoFocus />
            {tried && errors.name && <span className="error">{errors.name}</span>}
          </label>
          <LayerChoice choice={choice} layers={p.layers} showError={tried} />
          <label>Code
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="The code from your GIS layers" />
          </label>
          <label>Link
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://wiki.cityknowledge.org/…" inputMode="url" />
            {tried && errors.link && <span className="error">{errors.link}</span>}
          </label>
        </div>
      )}
    </Sheet>
  );
}
