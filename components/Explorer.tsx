"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download, Info, PenLine, Scan, Share2, Map as MapIcon } from "lucide-react";
import type { MapMode, MapViewHandle } from "./MapView";
import Sidebar from "./Sidebar";
import SearchBox from "./SearchBox";
import Inspector from "./Inspector";
import ItemForm, { type ItemFormResult } from "./ItemForm";
import MapForm from "./MapForm";
import AboutSheet from "./AboutSheet";
import { Toasts, useToasts } from "./Toasts";
import { layers_from_items, type ItemRow, type MapRow } from "@/lib/rows";
import { load_dataset, save_rows, type Dataset, type Write } from "@/lib/store-client";
import { apply_writes, create_item, delete_item, delete_placement, place_existing_item, update_item, update_layer, update_shape, save_map, type MapFields } from "@/lib/edits";
import { build_share_url, read_view_from_url } from "@/lib/share";
import type { Polygon } from "@/lib/geometry";

// OpenLayers reads window on import; the map is a client-only island.
const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map-host map-loading">Loading the map…</div> });

const DEFAULT_MAP = "debarbari";
// Local CSV editing is a development-machine feature (docs/architecture.md).
const CAN_EDIT = process.env.NODE_ENV !== "production";
const EDITOR = "local-admin";

type Sheet = null | { kind: "new-shape"; geometry: Polygon } | { kind: "edit-item"; item: ItemRow } | { kind: "map"; map?: MapRow } | { kind: "about" };

export default function Explorer() {
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapId, setMapId] = useState<string | null>(null);
  const [layerIds, setLayerIds] = useState<string[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [mode, setMode] = useState<MapMode>("view");
  const [editMode, setEditMode] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const mapRef = useRef<MapViewHandle>(null);
  const pendingFocus = useRef<string | null>(null);
  const toasts = useToasts();

  // Load order is explicit (D8): rows, then the URL's view, then the map draws it.
  useEffect(() => {
    load_dataset()
      .then((d) => {
        const view = read_view_from_url(window.location.search, d.items);
        const map = d.maps.find((m) => m.map_id === view.mapId && m.status === "active") ?? d.maps.find((m) => m.map_id === DEFAULT_MAP) ?? d.maps[0];
        const item = view.itemId ? d.items.find((i) => i.item_id === view.itemId) : undefined;
        setData(d);
        setMapId(map.map_id);
        setLayerIds(item && !view.layerIds.includes(item.layer_id) ? [...view.layerIds, item.layer_id] : view.layerIds);
        if (item) {
          setSelectedItemId(item.item_id);
          pendingFocus.current = `${item.item_id}@${map.map_id}`;
        }
        if (window.matchMedia("(max-width: 720px)").matches) setSidebarOpen(false);
      })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const mapsById = useMemo(() => new Map((data?.maps ?? []).map((m) => [m.map_id, m])), [data]);
  const activeMaps = useMemo(() => (data?.maps ?? []).filter((m) => m.status === "active"), [data]);
  const layers = useMemo(() => layers_from_items(data?.items ?? []), [data]);
  const currentMap = mapId ? mapsById.get(mapId) ?? null : null;
  const selectedItem = useMemo(() => data?.items.find((i) => i.item_id === selectedItemId) ?? null, [data, selectedItemId]);
  const selectedPlacementId = selectedItem && mapId ? `${selectedItem.item_id}@${mapId}` : null;

  const visiblePlacements = useMemo(() => {
    if (!data || !mapId) return [];
    const on = new Set(layerIds);
    return data.placements.filter((p) => p.map_id === mapId && p.status === "active" && on.has(p.layer_id));
    // revision: a cancelled shape edit asks for fresh features rebuilt from the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mapId, layerIds, revision]);

  // Keep the address bar on the current view, so a copied URL is always a share link (F8, D10).
  useEffect(() => {
    if (!mapId) return;
    const url = build_share_url(window.location.origin, { mapId, layerIds, itemId: selectedItemId ?? undefined });
    window.history.replaceState(null, "", url);
  }, [mapId, layerIds, selectedItemId]);

  // A focus waits for its polygon to exist on the map.
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target || !visiblePlacements.some((p) => p.placement_id === target)) return;
    pendingFocus.current = null;
    requestAnimationFrame(() => mapRef.current?.focus_placement(target));
  }, [visiblePlacements]);

  const commit = useCallback(async (writes: Write[], success: string) => {
    if (!data) return false;
    const before = data;
    setSaving(true);
    setData(apply_writes(data, writes));
    try {
      await save_rows(writes.filter((w) => w.rows.length));
      toasts.push({ tone: "success", text: success });
      return true;
    } catch (e) {
      setData(before);
      toasts.push({ tone: "error", text: `Not saved — ${(e as Error).message}. Nothing changed.` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [data, toasts]);

  function open_item_on_map(item: ItemRow, targetMapId: string) {
    setSelectedItemId(item.item_id);
    setLayerIds((ids) => (ids.includes(item.layer_id) ? ids : [...ids, item.layer_id]));
    setMapId(targetMapId);
    pendingFocus.current = `${item.item_id}@${targetMapId}`;
    if (targetMapId === mapId && visiblePlacements.some((p) => p.placement_id === pendingFocus.current)) {
      const id = pendingFocus.current;
      pendingFocus.current = null;
      mapRef.current?.focus_placement(id);
    }
  }

  function toggle_layer(id: string) {
    setLayerIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function select_placement(placementId: string | null) {
    if (!placementId || !data) return setSelectedItemId(null);
    setSelectedItemId(data.placements.find((p) => p.placement_id === placementId)?.item_id ?? null);
  }

  async function share() {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toasts.push({ tone: "success", text: "Link to this view copied." });
    } catch {
      toasts.push({ tone: "error", text: "The browser would not let us copy. The address bar has the link." });
    }
  }

  function download(blob: Blob, name: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function export_view() {
    try {
      download(await mapRef.current!.export_view(), `${mapId}.png`);
    } catch (e) {
      toasts.push({ tone: "error", text: `Could not export: ${(e as Error).message}` });
    }
  }

  function cancel_mode() {
    if (mode === "edit") setRevision((r) => r + 1);
    setMode("view");
  }

  async function finish_shape_edit() {
    const geometry = mapRef.current?.edited_geometry();
    const placement = data?.placements.find((p) => p.placement_id === selectedPlacementId);
    if (!geometry || !placement || !data) return cancel_mode();
    const ok = await commit(update_shape(data, placement, geometry, EDITOR), "Shape saved.");
    if (!ok) setRevision((r) => r + 1);
    setMode("view");
  }

  async function submit_new_shape(result: ItemFormResult, geometry: Polygon) {
    if (!data || !currentMap) return;
    const writes = result.kind === "existing"
      ? place_existing_item(data, result.item, currentMap, geometry, EDITOR)
      : create_item(data, result.fields, result.layer, currentMap, geometry, EDITOR);
    const itemId = result.kind === "existing" ? result.item.item_id : (writes[0].rows[0] as ItemRow).item_id;
    const layerId = result.kind === "existing" ? result.item.layer_id : result.layer.layer_id;
    if (await commit(writes, result.kind === "existing" ? `Shape added to ${result.item.name || "the item"}.` : `${result.fields.name} created.`)) {
      setSheet(null);
      setLayerIds((ids) => (ids.includes(layerId) ? ids : [...ids, layerId]));
      setSelectedItemId(itemId);
    }
  }

  if (loadError) return <div className="fatal">Could not read the data: {loadError}</div>;
  if (!data || !currentMap) return <div className="fatal quiet">Loading maps and places…</div>;

  // Sidebar width + its two gutters (globals.css --sidebar-w, --gap); on a phone it covers the map, so no inset.
  const sidebarInset = sidebarOpen && typeof window !== "undefined" && window.innerWidth > 720 ? 324 : 0;
  const placementHere = selectedItem ? data.placements.find((p) => p.placement_id === selectedPlacementId && p.status === "active") ?? null : null;
  const busy = mode !== "view";

  return (
    <div className="explorer" data-sidebar={sidebarOpen ? "open" : "closed"}>
      <MapView
        ref={mapRef}
        map={currentMap}
        placements={visiblePlacements}
        selectedId={selectedPlacementId}
        mode={mode}
        editingId={mode === "edit" ? selectedPlacementId : null}
        insetLeft={sidebarInset}
        onSelect={select_placement}
        onDrawn={(geometry) => { setMode("view"); setSheet({ kind: "new-shape", geometry }); }}
        onBox={(blob) => { setMode("view"); download(blob, `${mapId}-selection.png`); }}
        onCancelMode={cancel_mode}
      />

      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((o) => !o)}
        maps={activeMaps}
        currentMapId={currentMap.map_id}
        onPickMap={(id) => { setMapId(id); if (mode !== "view") cancel_mode(); }}
        layers={layers}
        enabledLayerIds={layerIds}
        onToggleLayer={toggle_layer}
        editMode={editMode}
        saving={saving}
        onEditLayer={(layer, next) => commit(update_layer(data, layer.layer_id, next, EDITOR), `${next.layer_name} updated.`)}
        onNewMap={() => setSheet({ kind: "map" })}
        onEditMap={(m) => setSheet({ kind: "map", map: m })}
      />

      <header className="topbar glass">
        <SearchBox items={data.items} mapsById={mapsById} currentMapId={currentMap.map_id} onOpen={open_item_on_map} />
        <div className="map-title">
          <div className="map-title-name">{currentMap.name} <span className="map-title-year">{currentMap.year}</span></div>
          {currentMap.description && <div className="map-title-desc">{currentMap.description}</div>}
          <MapMeta map={currentMap} />
        </div>
        <nav className="actions" aria-label="Map actions">
          <IconButton label="Copy a link to this view" onClick={share}><Share2 /></IconButton>
          <IconButton label="Download what is visible" onClick={export_view} disabled={busy}><Download /></IconButton>
          <IconButton label="Download a selection — drag a box" onClick={() => setMode(mode === "box" ? "view" : "box")} active={mode === "box"} disabled={busy && mode !== "box"}><Scan /></IconButton>
          <IconButton label="About this project" onClick={() => setSheet({ kind: "about" })}><Info /></IconButton>
          {CAN_EDIT && (
            <button type="button" className={`edit-toggle ${editMode ? "on" : ""}`} aria-pressed={editMode} onClick={() => { setEditMode((e) => !e); if (mode !== "view" && mode !== "box") cancel_mode(); }}>
              <PenLine /> {editMode ? "Editing" : "Edit"}
            </button>
          )}
        </nav>
      </header>

      {editMode && mode === "view" && (
        <div className="editbar glass">
          <button type="button" className="primary" onClick={() => { setSelectedItemId(null); setMode("draw"); }}>Draw a shape</button>
          <span className="hint">Click a shape to edit it.</span>
        </div>
      )}
      {mode === "draw" && (
        <div className="editbar glass">
          <span className="hint"><b>Drawing.</b> Click to add points, click the first point to close. Backspace takes back a point.</span>
          <button type="button" onClick={() => mapRef.current?.undo()}>Undo point</button>
          <button type="button" onClick={cancel_mode}>Cancel</button>
        </div>
      )}
      {mode === "edit" && (
        <div className="editbar glass">
          <span className="hint"><b>Editing shape.</b> Drag points; click an edge to add one; shift-click deletes; alt-drag moves it all. Snaps to neighbours.</span>
          <button type="button" onClick={() => mapRef.current?.undo()}>Undo</button>
          <button type="button" onClick={cancel_mode} disabled={saving}>Cancel</button>
          <button type="button" className="primary" onClick={finish_shape_edit} disabled={saving}>{saving ? "Saving…" : "Save shape"}</button>
        </div>
      )}
      {mode === "box" && (
        <div className="editbar glass">
          <span className="hint"><b>Drag a box</b> over the part of the map to download.</span>
          <button type="button" onClick={cancel_mode}>Cancel</button>
        </div>
      )}

      {selectedItem && mode === "view" && (
        <Inspector
          item={selectedItem}
          currentMap={currentMap}
          mapsById={mapsById}
          onThisMap={!!placementHere}
          editMode={editMode}
          saving={saving}
          onClose={() => setSelectedItemId(null)}
          onOpenOn={(id) => open_item_on_map(selectedItem, id)}
          onEditDetails={() => setSheet({ kind: "edit-item", item: selectedItem })}
          onEditShape={() => setMode("edit")}
          onDrawHere={() => setMode("draw")}
          onRemoveHere={() => placementHere && commit(delete_placement(data, placementHere, EDITOR), `Removed from ${currentMap.name}.`)}
          onDeleteItem={async () => { if (await commit(delete_item(data, selectedItem, EDITOR), `${selectedItem.name || "Item"} deleted. It can be restored.`)) setSelectedItemId(null); }}
        />
      )}

      {sheet?.kind === "new-shape" && (
        <ItemForm
          title="Save this shape"
          items={data.items}
          layers={layers}
          currentMap={currentMap}
          preselectedItem={selectedItem}
          defaultLayerId={layerIds[layerIds.length - 1]}
          saving={saving}
          onCancel={() => setSheet(null)}
          onSubmit={(result) => submit_new_shape(result, sheet.geometry)}
        />
      )}
      {sheet?.kind === "edit-item" && (
        <ItemForm
          title="Edit details"
          items={data.items}
          layers={layers}
          currentMap={currentMap}
          editing={sheet.item}
          saving={saving}
          onCancel={() => setSheet(null)}
          onSubmit={async (result) => {
            if (result.kind !== "new") return;
            if (await commit(update_item(data, sheet.item, result.fields, result.layer, EDITOR), "Details saved.")) {
              setSheet(null);
              setLayerIds((ids) => (ids.includes(result.layer.layer_id) ? ids : [...ids, result.layer.layer_id]));
            }
          }}
        />
      )}
      {sheet?.kind === "map" && (
        <MapForm
          map={sheet.map}
          takenIds={new Set(data.maps.map((m) => m.map_id))}
          saving={saving}
          onCancel={() => setSheet(null)}
          onSubmit={async (fields: MapFields) => {
            if (await commit(save_map(data, fields, EDITOR), `${fields.name} saved.`)) {
              setSheet(null);
              setMapId(fields.map_id);
            }
          }}
        />
      )}
      {sheet?.kind === "about" && <AboutSheet onClose={() => setSheet(null)} />}

      {!sidebarOpen && (
        <button type="button" className="sidebar-reopen glass" onClick={() => setSidebarOpen(true)} aria-label="Show maps and layers"><MapIcon /></button>
      )}
      <Toasts toasts={toasts.list} onDismiss={toasts.dismiss} />
    </div>
  );
}

const META_KEYS = ["author", "source", "collection", "scale"] as const;

function MapMeta({ map }: { map: MapRow }) {
  const pairs = META_KEYS.filter((k) => map[k]);
  if (!pairs.length) return null;
  return (
    <dl className="map-meta">
      {pairs.map((k) => (
        <div key={k}><dt>{k}</dt><dd>{map[k]}</dd></div>
      ))}
    </dl>
  );
}

function IconButton({ label, onClick, children, disabled, active }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className={`icon-button ${active ? "active" : ""}`} onClick={onClick} disabled={disabled} aria-label={label} title={disabled ? "Finish what you are doing on the map first" : label} aria-pressed={active}>
      {children}
    </button>
  );
}
