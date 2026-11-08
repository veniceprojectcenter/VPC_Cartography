"use client";

import { useState } from "react";
import type { ItemRow, Layer } from "@/lib/rows";
import Sheet from "./Sheet";
import { LayerChoice, useLayerChoice } from "./LayerChoice";

export type LayerMove = { layer: Layer; scope: "item" | "shape" };

type Props = {
  mode: "move" | "copy";
  item: ItemRow;
  mapName: string;
  // Maps the item is also drawn on besides this one; a move then has two scopes.
  otherMaps: number;
  layers: Layer[];
  saving: boolean;
  onCancel: () => void;
  onSubmit: (move: LayerMove) => void;
};

// Move or copy a shape into another layer. Move keeps one item and changes its layer; copy leaves
// the original and makes a second item, so a layer correction never needs the shape redrawn.
export default function LayerMoveSheet(p: Props) {
  const others = p.layers.filter((l) => l.layer_id !== p.item.layer_id);
  const choice = useLayerChoice(p.layers, others[0]?.layer_id ?? "__new__");
  const [scope, setScope] = useState<"item" | "shape">("item");
  const [tried, setTried] = useState(false);
  const verb = p.mode === "move" ? "Move" : "Copy";

  function submit() {
    setTried(true);
    if (choice.layer) p.onSubmit({ layer: choice.layer, scope });
  }

  return (
    <Sheet title={`${verb} ${p.item.name || "this shape"} to another layer`} onClose={p.onCancel}
      footer={<>
        <button type="button" onClick={p.onCancel} disabled={p.saving}>Cancel</button>
        <button type="button" className="primary" onClick={submit} disabled={p.saving}>{p.saving ? "Saving…" : `${verb} to layer`}</button>
      </>}>
      <div className="form">
        <p className="note">
          Now in <b>{p.item.layer_name}</b>.{" "}
          {p.mode === "copy" ? `The copy is a new item with the same name, code, link and outline on ${p.mapName}. The original stays.` : "The outline stays where it is."}
        </p>
        <LayerChoice choice={choice} layers={p.layers} showError={tried} exclude={p.item.layer_id} />
        {p.mode === "move" && p.otherMaps > 0 && (
          <div className="segmented" role="radiogroup" aria-label="What moves">
            <button type="button" role="radio" aria-checked={scope === "item"} className={scope === "item" ? "on" : ""} onClick={() => setScope("item")}>
              Whole item, {p.otherMaps + 1} maps
            </button>
            <button type="button" role="radio" aria-checked={scope === "shape"} className={scope === "shape" ? "on" : ""} onClick={() => setScope("shape")}>
              Only on {p.mapName}
            </button>
          </div>
        )}
        {p.mode === "move" && p.otherMaps > 0 && (
          <p className="note">
            {scope === "item"
              ? `Its shapes on all ${p.otherMaps + 1} maps change layer together.`
              : `Its shape here becomes a new item in the new layer. Its other ${p.otherMaps === 1 ? "map keeps" : "maps keep"} the old layer.`}
          </p>
        )}
      </div>
    </Sheet>
  );
}
