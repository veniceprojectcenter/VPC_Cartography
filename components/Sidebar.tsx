"use client";

import { useState } from "react";
import { Check, ChevronLeft, Pencil, Plus } from "lucide-react";
import type { Layer, MapRow } from "@/lib/rows";

type Props = {
  open: boolean;
  onToggle: () => void;
  maps: MapRow[];
  currentMapId: string;
  onPickMap: (id: string) => void;
  layers: Layer[];
  enabledLayerIds: string[];
  onToggleLayer: (id: string) => void;
  editMode: boolean;
  saving: boolean;
  onEditLayer: (layer: Layer, next: Omit<Layer, "layer_id">) => Promise<boolean>;
  onNewMap: () => void;
  onEditMap: (map: MapRow) => void;
};

// F2 and F4 as one side panel: maps grouped by parent, by year; layers grouped by parent, by name.
export default function Sidebar(p: Props) {
  const mapGroups = group(p.maps, (m) => m.parent, (a, b) => Number(a.year) - Number(b.year));
  const layerGroups = group(p.layers, (l) => l.layer_parent, (a, b) => a.layer_name.localeCompare(b.layer_name));
  const on = new Set(p.enabledLayerIds);

  return (
    <aside className="sidebar glass" aria-hidden={!p.open} inert={!p.open}>
      <div className="sidebar-head">
        <span className="brand">Venetian Historical Map Explorer</span>
        <button type="button" className="icon-button small" onClick={p.onToggle} aria-label="Hide maps and layers"><ChevronLeft /></button>
      </div>

      <section>
        <h2>Maps</h2>
        {mapGroups.map(([parent, maps]) => (
          <div key={parent} className="group">
            {parent && <h3>{parent}</h3>}
            <ul className="list">
              {maps.map((m) => (
                <li key={m.map_id} className="row-with-tool">
                  <button type="button" className={`list-row ${m.map_id === p.currentMapId ? "current" : ""}`} onClick={() => p.onPickMap(m.map_id)} aria-current={m.map_id === p.currentMapId}>
                    <span className="year">{m.year}</span>
                    <span className="label">{m.name}</span>
                  </button>
                  {p.editMode && <button type="button" className="row-tool" onClick={() => p.onEditMap(m)} aria-label={`Edit ${m.name}`}><Pencil /></button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {p.editMode && <button type="button" className="add-row" onClick={p.onNewMap}><Plus /> New map</button>}
      </section>

      <section>
        <h2>Layers <span className="count">{p.enabledLayerIds.length ? `${p.enabledLayerIds.length} on` : ""}</span></h2>
        {layerGroups.map(([parent, layers]) => (
          <div key={parent} className="group">
            {parent && <h3>{parent}</h3>}
            <ul className="list">
              {layers.map((l) => (
                <LayerRow key={l.layer_id} layer={l} on={on.has(l.layer_id)} onToggle={() => p.onToggleLayer(l.layer_id)} editMode={p.editMode} saving={p.saving} onSave={(next) => p.onEditLayer(l, next)} />
              ))}
            </ul>
          </div>
        ))}
        {p.editMode && <p className="footnote">A new layer is made with its first item: draw a shape and pick “New layer”.</p>}
      </section>
    </aside>
  );
}

function LayerRow({ layer, on, onToggle, editMode, saving, onSave }: { layer: Layer; on: boolean; onToggle: () => void; editMode: boolean; saving: boolean; onSave: (next: Omit<Layer, "layer_id">) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.layer_name);
  const [color, setColor] = useState(layer.layer_color);
  const [parent, setParent] = useState(layer.layer_parent);

  if (editing) {
    return (
      <li className="layer-edit">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Layer name" />
        <div className="layer-edit-row">
          <input type="color" value={to_hex(color)} onChange={(e) => setColor(e.target.value)} aria-label="Layer colour" />
          <input value={parent} onChange={(e) => setParent(e.target.value)} placeholder="Group (optional)" aria-label="Layer group" />
        </div>
        <div className="layer-edit-row end">
          <button type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
          <button type="button" className="primary" disabled={saving || !name.trim()} onClick={async () => { if (await onSave({ layer_name: name.trim(), layer_color: color, layer_parent: parent.trim() })) setEditing(false); }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </li>
    );
  }
  return (
    <li className="row-with-tool">
      <button type="button" className={`list-row layer ${on ? "on" : ""}`} onClick={onToggle} aria-pressed={on}>
        <span className="swatch" style={{ background: layer.layer_color }} />
        <span className="label">{layer.layer_name}</span>
        <span className="check">{on && <Check />}</span>
      </button>
      {editMode && <button type="button" className="row-tool" onClick={() => setEditing(true)} aria-label={`Edit ${layer.layer_name}`}><Pencil /></button>}
    </li>
  );
}

function group<T>(rows: T[], by: (r: T) => string, sort: (a: T, b: T) => number): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const k = by(r) || "";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  // Ungrouped rows first, as the old menus put them at the top level.
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))).map(([k, v]) => [k, v.sort(sort)]);
}

// Layer colours are stored as given (names like "brown" or hex); the colour input needs hex.
function to_hex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.fillStyle = color;
  return ctx.fillStyle;
}
