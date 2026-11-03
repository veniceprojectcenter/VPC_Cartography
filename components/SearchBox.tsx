"use client";

import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { ItemRow, MapRow } from "@/lib/rows";
import { search_items } from "@/lib/search";

type Props = {
  items: ItemRow[];
  mapsById: Map<string, MapRow>;
  currentMapId: string;
  onOpen: (item: ItemRow, mapId: string) => void;
};

// F7: name or code, fuzzy; each hit lists the maps it is on, current map first in emphasis.
export default function SearchBox({ items, mapsById, currentMapId, onOpen }: Props) {
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const deferred = useDeferredValue(term);
  const hits = useMemo(() => search_items(deferred, items, mapsById), [deferred, items, mapsById]);
  const box = useRef<HTMLDivElement>(null);

  function pick(item: ItemRow, mapId: string) {
    setTerm(item.name);
    setOpen(false);
    onOpen(item, mapId);
  }

  return (
    <div className="search" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <Search className="search-icon" aria-hidden />
      <input
        type="search"
        value={term}
        placeholder="Search places or codes"
        aria-label="Search places or codes"
        onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setTerm(""); setOpen(false); }
          if (e.key === "Enter" && hits[0]) {
            const here = hits[0].maps.find((m) => m.map_id === currentMapId) ?? hits[0].maps[0];
            if (here) pick(hits[0].item, here.map_id);
          }
        }}
      />
      {open && deferred.trim() && (
        <div className="search-results glass-solid" role="listbox">
          {hits.length === 0 && <div className="empty">Nothing called “{deferred.trim()}”.</div>}
          {hits.map(({ item, maps }) => {
            const here = maps.some((m) => m.map_id === currentMapId);
            return (
              <div key={item.item_id} className={`hit ${here ? "" : "elsewhere"}`} role="option" aria-selected={false}>
                <div className="hit-head">
                  <span className="hit-name">{item.name || "Untitled"}</span>
                  {item.code && <span className="code">{item.code}</span>}
                </div>
                <div className="hit-sub">{item.layer_name}{here ? "" : " · not on this map"}</div>
                {maps.length ? (
                  <div className="chips">
                    {maps.map((m) => (
                      <button key={m.map_id} type="button" className={`chip ${m.map_id === currentMapId ? "current" : ""}`} onClick={() => pick(item, m.map_id)}>
                        {m.year} · {m.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="hit-sub">Not drawn on any map yet.</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
