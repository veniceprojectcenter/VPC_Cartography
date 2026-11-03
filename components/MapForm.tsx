"use client";

import { useState } from "react";
import type { MapRow } from "@/lib/rows";
import type { MapFields } from "@/lib/edits";
import Sheet from "./Sheet";

type Props = { map?: MapRow; takenIds: Set<string>; saving: boolean; onCancel: () => void; onSubmit: (fields: MapFields) => void };

// F17, from tiles that already exist somewhere. Uploading an image to tile it is a later step.
export default function MapForm({ map, takenIds, saving, onCancel, onSubmit }: Props) {
  const [f, setF] = useState<MapFields>({
    map_id: map?.map_id ?? "",
    name: map?.name ?? "",
    year: map?.year ?? "",
    parent: map?.parent ?? "",
    description: map?.description ?? "",
    author: map?.author ?? "",
    source: map?.source ?? "",
    collection: map?.collection ?? "",
    scale: map?.scale ?? "",
    tiles_url: map?.tiles_url ?? "",
    tile_scheme: map?.tile_scheme ?? "tms",
    min_zoom: map?.min_zoom ?? "2",
    max_zoom: map?.max_zoom ?? "",
    bounds: map?.bounds ?? "[[-85.0511287798066,-180],[85.0511287798066,180]]",
  });
  const [tried, setTried] = useState(false);
  const set = (k: keyof MapFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const errors: Partial<Record<keyof MapFields, string>> = {};
  if (!f.name.trim()) errors.name = "A name is needed.";
  if (!/^[a-z0-9-]+$/.test(f.map_id)) errors.map_id = "Lowercase letters, numbers and dashes.";
  else if (!map && takenIds.has(f.map_id)) errors.map_id = "That id is taken.";
  if (!/^-?\d+$/.test(f.year.trim())) errors.year = "A year, as a number.";
  if (!/\{z\}.*\{x\}.*\{-?y\}/.test(f.tiles_url)) errors.tiles_url = "Needs {z}, {x} and {y} (or {-y} for TMS).";
  if (!/^\d+$/.test(f.max_zoom)) errors.max_zoom = "The deepest zoom level of the tiles.";
  try {
    const b = JSON.parse(f.bounds);
    if (!(Array.isArray(b) && b.length === 2 && b.flat().length === 4 && b.flat().every(Number.isFinite))) errors.bounds = "[[south, west], [north, east]]";
  } catch {
    errors.bounds = "[[south, west], [north, east]]";
  }
  const ok = Object.keys(errors).length === 0;
  const err = (k: keyof MapFields) => tried && errors[k] ? <span className="error">{errors[k]}</span> : null;

  return (
    <Sheet title={map ? `Edit ${map.name}` : "New map"} onClose={onCancel}
      footer={<>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="button" className="primary" disabled={saving} onClick={() => { setTried(true); if (ok) onSubmit({ ...f, name: f.name.trim(), year: f.year.trim() }); }}>
          {saving ? "Saving…" : map ? "Save map" : "Create map"}
        </button>
      </>}>
      <div className="form">
        <label>Name<input value={f.name} onChange={set("name")} placeholder="Jacopo de'Barbari" />{err("name")}</label>
        <div className="layer-edit-row">
          <label>Id<input value={f.map_id} onChange={set("map_id")} disabled={!!map} placeholder="debarbari" />{err("map_id")}</label>
          <label className="narrow">Year<input value={f.year} onChange={set("year")} inputMode="numeric" placeholder="1500" />{err("year")}</label>
        </div>
        <label>Group<input value={f.parent} onChange={set("parent")} placeholder="Optional" /></label>
        <label>Description<textarea value={f.description} onChange={set("description")} rows={2} /></label>
        <div className="layer-edit-row">
          <label>Author<input value={f.author} onChange={set("author")} /></label>
          <label>Source<input value={f.source} onChange={set("source")} /></label>
        </div>
        <div className="layer-edit-row">
          <label>Collection<input value={f.collection} onChange={set("collection")} /></label>
          <label>Scale<input value={f.scale} onChange={set("scale")} /></label>
        </div>
        <label>Tiles URL<input value={f.tiles_url} onChange={set("tiles_url")} placeholder="https://…/maps/debarbari/{z}/{x}/{-y}.png" />{err("tiles_url")}</label>
        <div className="layer-edit-row">
          <label>Scheme<select value={f.tile_scheme} onChange={set("tile_scheme")}><option value="tms">TMS (gdal2tiles)</option><option value="xyz">XYZ</option></select></label>
          <label className="narrow">Min zoom<input value={f.min_zoom} onChange={set("min_zoom")} inputMode="numeric" /></label>
          <label className="narrow">Max zoom<input value={f.max_zoom} onChange={set("max_zoom")} inputMode="numeric" />{err("max_zoom")}</label>
        </div>
        <label>Bounds<input value={f.bounds} onChange={set("bounds")} className="mono" />{err("bounds")}</label>
      </div>
    </Sheet>
  );
}
