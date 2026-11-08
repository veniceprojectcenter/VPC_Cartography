"use client";

import { useState } from "react";
import type { Layer } from "@/lib/rows";

export const NEW_LAYER = "__new__";

export function slug(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// The choice of a layer: one that exists, or a new one named here. Local state, read back through
// `layer` (null while the choice is incomplete) and `error` (why).
export function useLayerChoice(layers: Layer[], initialId: string) {
  const [layerId, setLayerId] = useState(initialId);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#007aff");
  const [parent, setParent] = useState("");

  const newId = slug(name);
  const error = layerId !== NEW_LAYER ? ""
    : !name.trim() ? "Name the new layer."
    : !newId ? "Use letters or numbers in the layer name."
    : layers.some((l) => l.layer_id === newId) ? "A layer with that name exists — pick it from the list."
    : "";
  const layer: Layer | null = error ? null
    : layerId === NEW_LAYER ? { layer_id: newId, layer_name: name.trim(), layer_color: color, layer_parent: parent.trim() }
    : layers.find((l) => l.layer_id === layerId) ?? null;

  return { layerId, setLayerId, name, setName, color, setColor, parent, setParent, error, layer };
}

type Choice = ReturnType<typeof useLayerChoice>;

// `exclude`: a layer the choice must not offer (the one a move or copy starts from).
export function LayerChoice({ choice, layers, showError, exclude }: { choice: Choice; layers: Layer[]; showError: boolean; exclude?: string }) {
  return (
    <>
      <label>Layer
        <select value={choice.layerId} onChange={(e) => choice.setLayerId(e.target.value)}>
          {layers.filter((l) => l.layer_id !== exclude).map((l) => <option key={l.layer_id} value={l.layer_id}>{l.layer_name}</option>)}
          <option value={NEW_LAYER}>New layer…</option>
        </select>
      </label>
      {choice.layerId === NEW_LAYER && (
        <fieldset className="inline-group">
          <label>Layer name<input value={choice.name} onChange={(e) => choice.setName(e.target.value)} placeholder="e.g. Demolished Churches" /></label>
          <div className="layer-edit-row">
            <label className="narrow">Colour<input type="color" value={choice.color} onChange={(e) => choice.setColor(e.target.value)} /></label>
            <label>Group<input value={choice.parent} onChange={(e) => choice.setParent(e.target.value)} placeholder="Optional" /></label>
          </div>
          {showError && choice.error && <span className="error">{choice.error}</span>}
        </fieldset>
      )}
    </>
  );
}
