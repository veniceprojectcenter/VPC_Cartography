"use client";

import { useState } from "react";
import { Check, ChevronRight, Pencil, Plus, Search, X } from "lucide-react";
import type { Layer, MapRow } from "@/lib/rows";

// F2 and F4: the map picker and the layer picker, each its own side panel opened from the top bar.
// Lists can grow long, so both filter as you type and fold by group.

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="panel glass" aria-label={title} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className="panel-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button small" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X /></button>
      </div>
      {children}
    </aside>
  );
}

function FilterField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="panel-filter">
      <Search className="search-icon" aria-hidden />
      {/* Focus straight into the filter with a mouse; on a touch screen that would raise the keyboard over the list. */}
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} autoFocus={window.matchMedia("(hover: hover)").matches} />
    </div>
  );
}

// ---------- maps ----------

type MapsProps = {
  maps: MapRow[];
  currentMap: MapRow;
  onPick: (id: string) => void;
  onClose: () => void;
  editMode: boolean;
  onNewMap: () => void;
  onEditMap: (map: MapRow) => void;
};

const META_KEYS = ["author", "source", "collection", "scale"] as const;

export function MapsPanel(p: MapsProps) {
  const [query, setQuery] = useState("");
  const shown = p.maps.filter((m) => matches(query, m.name, m.year, m.parent, m.author));
  const groups = group(shown, (m) => m.parent, (a, b) => Number(a.year) - Number(b.year));
  const meta = META_KEYS.filter((k) => p.currentMap[k]);

  return (
    <PanelShell title="Maps" onClose={p.onClose}>
      <div className="current-map">
        <div className="current-map-name">{p.currentMap.name} <span className="year">{p.currentMap.year}</span></div>
        {p.currentMap.description && <p className="note">{p.currentMap.description}</p>}
        {meta.length > 0 && (
          <dl className="map-meta">
            {meta.map((k) => <div key={k}><dt>{k}</dt><dd>{p.currentMap[k]}</dd></div>)}
          </dl>
        )}
      </div>
      <FilterField value={query} onChange={setQuery} placeholder={`Filter ${p.maps.length} maps`} />
      <div className="panel-body">
        {groups.map(([parent, maps]) => (
          <Group key={parent} title={parent} forceOpen={!!query}>
            <ul className="list">
              {maps.map((m) => (
                <li key={m.map_id} className="row-with-tool">
                  <button type="button" className={`list-row ${m.map_id === p.currentMap.map_id ? "current" : ""}`} onClick={() => p.onPick(m.map_id)} aria-current={m.map_id === p.currentMap.map_id}>
                    <span className="year">{m.year}</span>
                    <span className="label">{m.name}</span>
                  </button>
                  {p.editMode && <button type="button" className="row-tool" onClick={() => p.onEditMap(m)} aria-label={`Edit ${m.name}`}><Pencil /></button>}
                </li>
              ))}
            </ul>
          </Group>
        ))}
        {!shown.length && <p className="empty">No map matches “{query}”.</p>}
        {p.editMode && <button type="button" className="add-row" onClick={p.onNewMap}><Plus /> New map</button>}
      </div>
    </PanelShell>
  );
}

// ---------- layers ----------

type LayersProps = {
  layers: Layer[];
  enabledLayerIds: string[];
  onSetLayers: (ids: string[]) => void;
  onClose: () => void;
  editMode: boolean;
  saving: boolean;
  onEditLayer: (layer: Layer, next: Omit<Layer, "layer_id">) => Promise<boolean>;
};

export function LayersPanel(p: LayersProps) {
  const [query, setQuery] = useState("");
  const on = new Set(p.enabledLayerIds);
  const shown = p.layers.filter((l) => matches(query, l.layer_name, l.layer_parent));
  const groups = group(shown, (l) => l.layer_parent, (a, b) => a.layer_name.localeCompare(b.layer_name));

  function set_many(ids: string[], value: boolean) {
    const next = new Set(on);
    for (const id of ids) {
      if (value) next.add(id);
      else next.delete(id);
    }
    // Keep the order layers were turned on in: the last one is the default for a new shape.
    p.onSetLayers([...p.enabledLayerIds.filter((id) => next.has(id)), ...ids.filter((id) => value && !on.has(id))]);
  }

  return (
    <PanelShell title="Layers" onClose={p.onClose}>
      <FilterField value={query} onChange={setQuery} placeholder={`Filter ${p.layers.length} layers`} />
      <div className="panel-summary">
        <span>{on.size ? `${on.size} of ${p.layers.length} on` : "None on"}</span>
        <button type="button" className="link-button" onClick={() => p.onSetLayers([])} disabled={!on.size}>Turn all off</button>
      </div>
      <div className="panel-body">
        {groups.map(([parent, layers]) => {
          const ids = layers.map((l) => l.layer_id);
          const allOn = ids.every((id) => on.has(id));
          const count = ids.filter((id) => on.has(id)).length;
          return (
            <Group
              key={parent}
              title={parent}
              forceOpen={!!query}
              badge={count ? `${count} on` : undefined}
              tool={<button type="button" className="link-button" onClick={() => set_many(ids, !allOn)}>{allOn ? "None" : "All"}</button>}
            >
              <ul className="list">
                {layers.map((l) => (
                  <LayerRow key={l.layer_id} layer={l} on={on.has(l.layer_id)} onToggle={() => set_many([l.layer_id], !on.has(l.layer_id))} editMode={p.editMode} saving={p.saving} onSave={(next) => p.onEditLayer(l, next)} />
                ))}
              </ul>
            </Group>
          );
        })}
        {!shown.length && <p className="empty">No layer matches “{query}”.</p>}
        {p.editMode && <p className="footnote">A new layer is made with its first item: draw a shape and pick “New layer”.</p>}
      </div>
    </PanelShell>
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

// ---------- shared ----------

// An ungrouped run of rows has no header; a named group folds. A filter opens every group.
function Group({ title, forceOpen, badge, tool, children }: { title: string; forceOpen: boolean; badge?: string; tool?: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  if (!title) return <div className="group">{children}</div>;
  const expanded = open || forceOpen;
  return (
    <div className="group">
      <div className="group-head">
        <button type="button" className="group-toggle" onClick={() => setOpen(!open)} aria-expanded={expanded} disabled={forceOpen}>
          <ChevronRight className={expanded ? "turned" : ""} />
          <span>{title}</span>
          {badge && <span className="badge">{badge}</span>}
        </button>
        {tool}
      </div>
      {expanded && children}
    </div>
  );
}

function matches(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
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
