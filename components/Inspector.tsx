"use client";

import { useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { ItemRow, MapRow } from "@/lib/rows";

type Props = {
  item: ItemRow;
  currentMap: MapRow;
  mapsById: Map<string, MapRow>;
  onThisMap: boolean;
  editMode: boolean;
  saving: boolean;
  onClose: () => void;
  onOpenOn: (mapId: string) => void;
  onEditDetails: () => void;
  onEditShape: () => void;
  onDrawHere: () => void;
  onRemoveHere: () => void;
  onDeleteItem: () => void;
};

// F5 + F6: what the old popup said, as a card that stays put while the map moves.
export default function Inspector(p: Props) {
  const [confirming, setConfirming] = useState<null | "here" | "item">(null);
  const others = p.item.map_ids.split("|").filter((id) => id && id !== p.currentMap.map_id).map((id) => p.mapsById.get(id)).filter((m): m is MapRow => !!m);

  return (
    <section className="inspector glass" aria-label={p.item.name}>
      <header>
        <div>
          <div className="layer-tag"><span className="swatch" style={{ background: p.item.layer_color }} />{p.item.layer_name}</div>
          <h2>{p.item.link ? <a href={p.item.link} target="_blank" rel="noreferrer">{p.item.name || "Untitled"} <ExternalLink /></a> : p.item.name || "Untitled"}</h2>
          {p.item.code && <div className="code">{p.item.code}</div>}
        </div>
        <button type="button" className="icon-button small" onClick={p.onClose} aria-label="Close"><X /></button>
      </header>

      {!p.onThisMap && <p className="note">Not drawn on {p.currentMap.name}.</p>}

      {others.length > 0 && (
        <div className="elsewhere">
          <h3>Also on {others.length} other {others.length === 1 ? "map" : "maps"}</h3>
          <ul>
            {others.map((m) => (
              <li key={m.map_id}><button type="button" className="chip" onClick={() => p.onOpenOn(m.map_id)}>{m.year} · {m.name}</button></li>
            ))}
          </ul>
        </div>
      )}

      {p.editMode && (
        <footer className="admin">
          {confirming ? (
            <div className="confirm">
              <span>{confirming === "here" ? `Remove this shape from ${p.currentMap.name}?` : `Delete ${p.item.name || "this item"} from every map?`} It can be restored.</span>
              <button type="button" onClick={() => setConfirming(null)} disabled={p.saving}>Keep</button>
              <button type="button" className="destructive" disabled={p.saving} onClick={() => { (confirming === "here" ? p.onRemoveHere : p.onDeleteItem)(); setConfirming(null); }}>
                {p.saving ? "Saving…" : confirming === "here" ? "Remove" : "Delete"}
              </button>
            </div>
          ) : (
            <>
              <button type="button" onClick={p.onEditDetails}>Edit details</button>
              {p.onThisMap ? <button type="button" onClick={p.onEditShape}>Edit shape</button> : <button type="button" className="primary" onClick={p.onDrawHere}>Draw it on this map</button>}
              {p.onThisMap && <button type="button" className="destructive-quiet" onClick={() => setConfirming("here")}>Remove from map</button>}
              <button type="button" className="destructive-quiet" onClick={() => setConfirming("item")}>Delete item</button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}
