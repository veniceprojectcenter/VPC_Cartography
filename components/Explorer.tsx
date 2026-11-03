"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, Download, Info, Layers as LayersIcon, LogIn, LogOut, Map as MapIcon, PenLine, Scan, Share2, Table as TableIcon } from "lucide-react";
import type { MapMode, MapViewHandle } from "./MapView";
import { LayersPanel, MapsPanel } from "./Panels";
import SignInSheet from "./SignInSheet";
import SearchBox from "./SearchBox";
import Inspector from "./Inspector";
import ItemTable from "./ItemTable";
import ItemForm, { type ItemFormResult } from "./ItemForm";
import MapForm from "./MapForm";
import AboutSheet from "./AboutSheet";
import { Toasts, useToasts } from "./Toasts";
import { layers_from_items, type ItemRow, type MapRow, type PlacementRow } from "@/lib/rows";
import { load_dataset, save_rows, type Dataset, type Write } from "@/lib/store-client";
import { apply_writes, publish_blocker, publish_tileset, create_item, delete_item, delete_placement, in_sequence, place_existing_item, reassign_blocker, reassign_placement, restore_item, restore_placement, update_item, update_layer, update_shape, save_map, type MapFields } from "@/lib/edits";
import { signed_in_email, sign_out } from "@/lib/auth-client";
import { build_share_url, read_view_from_url } from "@/lib/share";
import type { Polygon } from "@/lib/geometry";

// OpenLayers reads window on import; the map is a client-only island.
const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map-host map-loading">Loading the map…</div> });

const DEFAULT_MAP = "debarbari";
// Panel width + its two gutters (globals.css --panel-w, --gap): a fit or focus keeps clear of an open panel.
const PANEL_INSET = 344;

type Sheet = null | { kind: "new-shape"; geometry: Polygon } | { kind: "edit-item"; item: ItemRow } | { kind: "map"; map?: MapRow } | { kind: "about" } | { kind: "sign-in" } | { kind: "items" } | { kind: "move-shape"; placement: PlacementRow };
type Panel = null | "maps" | "layers";

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
  const [panel, setPanel] = useState<Panel>(null);
  // The signed-in admin's email; it is also the editor recorded on every row they change.
  const [user, setUser] = useState<string | null>(null);
  const mapRef = useRef<MapViewHandle>(null);
  const pendingFocus = useRef<string | null>(null);
  const toasts = useToasts();

  // Load order is explicit (D8): rows, then the URL's view, then the map draws it.
  useEffect(() => {
    // Who is signed in decides what is read: admins also get deleted rows and tile sets.
    signed_in_email()
      .catch(() => null)
      .then((email) => {
        setUser(email);
        return load_dataset(!!email);
      })
      .then((d) => {
        const view = read_view_from_url(window.location.search, d.items);
        const map = d.maps.find((m) => m.map_id === view.mapId && m.status === "active") ?? d.maps.find((m) => m.map_id === DEFAULT_MAP) ?? d.maps[0];
        const item = view.itemId ? d.items.find((i) => i.item_id === view.itemId) : undefined;
        setData(d);
        setMapId(map.map_id);
        // A shared link can name a layer that no longer exists; it would count as "on" with nothing to draw.
        const known = new Set(layers_from_items(d.items).map((l) => l.layer_id));
        const ids = view.layerIds.filter((id) => known.has(id));
        setLayerIds(item && !ids.includes(item.layer_id) ? [...ids, item.layer_id] : ids);
        if (item) {
          setSelectedItemId(item.item_id);
          pendingFocus.current = `${item.item_id}@${map.map_id}`;
        }
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

  // The dataset as it is now; an Undo pressed seconds later must start from the rows as they are then.
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Applies at once, saves, and puts it back if the save fails. `undo` builds the reverse from the
  // rows as they are when Undo is pressed; the toast offers it.
  const commit = useCallback(async function run(writes: Write[], success: string, undo?: (d: Dataset) => Write[]): Promise<boolean> {
    const current = dataRef.current;
    if (!current) return false;
    setSaving(true);
    const next = apply_writes(current, writes);
    dataRef.current = next;
    setData(next);
    try {
      await save_rows(writes.filter((w) => w.rows.length));
      toasts.push({
        tone: "success",
        text: success,
        action: undo && { label: "Undo", run: () => {
          try {
            run(undo(dataRef.current!), "Undone.");
          } catch (e) {
            toasts.push({ tone: "error", text: `Could not undo: ${(e as Error).message}` });
          }
        } },
      });
      return true;
    } catch (e) {
      dataRef.current = current;
      setData(current);
      toasts.push({ tone: "error", text: `Not saved — ${(e as Error).message}. Nothing changed.` });
      return false;
    } finally {
      setSaving(false);
    }
  }, [toasts]);

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

  function toggle_panel(next: Panel) {
    setPanel((current) => (current === next ? null : next));
  }

  async function leave() {
    try {
      await sign_out();
      setUser(null);
      setEditMode(false);
      if (mode === "draw" || mode === "edit") cancel_mode();
      toasts.push({ tone: "success", text: "Signed out." });
    } catch (e) {
      toasts.push({ tone: "error", text: `Could not sign out: ${(e as Error).message}` });
    }
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
    const ok = await commit(update_shape(data, placement, geometry, user!), "Shape saved.");
    if (!ok) setRevision((r) => r + 1);
    setMode("view");
  }

  async function submit_new_shape(result: ItemFormResult, geometry: Polygon) {
    if (!data || !currentMap) return;
    const writes = result.kind === "existing"
      ? place_existing_item(data, result.item, currentMap, geometry, user!)
      : create_item(data, result.fields, result.layer, currentMap, geometry, user!);
    const itemId = result.kind === "existing" ? result.item.item_id : (writes[0].rows[0] as ItemRow).item_id;
    const layerId = result.kind === "existing" ? result.item.layer_id : result.layer.layer_id;
    if (await commit(writes, result.kind === "existing" ? `Shape added to ${result.item.name || "the item"}.` : `${result.fields.name} created.`)) {
      setSheet(null);
      setLayerIds((ids) => (ids.includes(layerId) ? ids : [...ids, layerId]));
      setSelectedItemId(itemId);
    }
  }

  // A pure edit that refuses (throws) shows why, instead of failing silently.
  function guarded(run: () => unknown) {
    try {
      run();
    } catch (e) {
      toasts.push({ tone: "error", text: (e as Error).message });
    }
  }

  // Reassign one shape: to an item that exists, or to a new one made from it. Undo puts it back.
  async function move_shape(placement: PlacementRow, result: ItemFormResult) {
    if (!data || !currentMap) return;
    const from = placement.placement_id;
    let to = "";
    let writes: Write[];
    try {
      if (result.kind === "existing") {
        writes = reassign_placement(data, placement, result.item, user!);
        to = `${result.item.item_id}@${placement.map_id}`;
      } else {
        const geometry = JSON.parse(placement.geometry) as Polygon;
        writes = in_sequence(data, [
          (d) => create_item(d, result.fields, result.layer, currentMap, geometry, user!),
          (d) => delete_placement(d, d.placements.find((p) => p.placement_id === from)!, user!),
        ]);
        to = (writes.find((w) => w.table === "placements")!.rows[0] as PlacementRow).placement_id;
      }
    } catch (e) {
      toasts.push({ tone: "error", text: (e as Error).message });
      return;
    }
    const target = to.split("@")[0];
    const name = result.kind === "existing" ? result.item.name : result.fields.name.trim();
    const undo = (d: Dataset) => in_sequence(d, [
      (x) => delete_placement(x, x.placements.find((p) => p.placement_id === to)!, user!),
      ...(result.kind === "new" ? [(x: Dataset) => delete_item(x, x.items.find((i) => i.item_id === target)!, user!)] : []),
      (x) => restore_placement(x, x.placements.find((p) => p.placement_id === from)!, user!),
    ]);
    if (await commit(writes, `Shape moved to ${name || "the item"}.`, undo)) {
      setSheet(null);
      const layer = data.items.find((i) => i.item_id === target)?.layer_id ?? (result.kind === "new" ? result.layer.layer_id : "");
      setLayerIds((ids) => (!layer || ids.includes(layer) ? ids : [...ids, layer]));
      setSelectedItemId(target);
    }
  }

  // Start this item's shape here from its outline on another map, then go straight to reshaping it.
  async function copy_shape_from(item: ItemRow, fromMapId: string) {
    const source = data?.placements.find((p) => p.placement_id === `${item.item_id}@${fromMapId}` && p.status === "active");
    const fromMap = mapsById.get(fromMapId);
    if (!data || !currentMap || !source || !fromMap || !mapRef.current) return;
    const geometry = mapRef.current.fit_copy(JSON.parse(source.geometry) as Polygon, fromMap);
    const id = `${item.item_id}@${currentMap.map_id}`;
    const ok = await commit(place_existing_item(data, item, currentMap, geometry, user!), `Copied from ${fromMap.name}. Move and reshape it, then save.`,
      (d) => delete_placement(d, d.placements.find((p) => p.placement_id === id)!, user!));
    if (ok) {
      setLayerIds((ids) => (ids.includes(item.layer_id) ? ids : [...ids, item.layer_id]));
      setMode("edit");
    }
  }

  if (loadError) return <div className="fatal">Could not read the data: {loadError}</div>;
  if (!data || !currentMap) return <div className="fatal quiet">Loading maps and places…</div>;

  // On a phone the panel covers the map, so there is nothing to keep clear of.
  const panelInset = panel && typeof window !== "undefined" && window.innerWidth > 720 ? PANEL_INSET : 0;
  const canEdit = editMode && !!user;
  const placementHere = selectedItem ? data.placements.find((p) => p.placement_id === selectedPlacementId && p.status === "active") ?? null : null;
  const busy = mode !== "view";

  return (
    <div className="explorer">
      <MapView
        ref={mapRef}
        map={currentMap}
        placements={visiblePlacements}
        selectedId={selectedPlacementId}
        mode={mode}
        editingId={mode === "edit" ? selectedPlacementId : null}
        insetLeft={panelInset}
        onSelect={select_placement}
        onDrawn={(geometry) => { setMode("view"); setSheet({ kind: "new-shape", geometry }); }}
        onBox={(blob) => { setMode("view"); download(blob, `${mapId}-selection.png`); }}
        onCancelMode={cancel_mode}
      />

      <header className="topbar glass">
        <button type="button" className={`picker ${panel === "maps" ? "on" : ""}`} onClick={() => toggle_panel("maps")} aria-expanded={panel === "maps"} aria-label={`Maps — showing ${currentMap.name}, ${currentMap.year}`}>
          <MapIcon />
          <span className="picker-label">{currentMap.name}</span>
          <span className="picker-year">{currentMap.year}</span>
          <ChevronDown className="picker-chevron" />
        </button>
        <button type="button" className={`picker ${panel === "layers" ? "on" : ""}`} onClick={() => toggle_panel("layers")} aria-expanded={panel === "layers"}>
          <LayersIcon />
          <span className="picker-label">Layers</span>
          {layerIds.length > 0 && <span className="badge">{layerIds.length}</span>}
          <ChevronDown className="picker-chevron" />
        </button>
        <SearchBox items={data.items} mapsById={mapsById} currentMapId={currentMap.map_id} onOpen={open_item_on_map} />
        <nav className="actions" aria-label="Map actions">
          <IconButton label="Copy a link to this view" onClick={share}><Share2 /></IconButton>
          <IconButton label="Download what is visible" onClick={export_view} disabled={busy}><Download /></IconButton>
          <IconButton label="Download a selection — drag a box" onClick={() => setMode(mode === "box" ? "view" : "box")} active={mode === "box"} disabled={busy && mode !== "box"}><Scan /></IconButton>
          <IconButton label="About this project" onClick={() => setSheet({ kind: "about" })}><Info /></IconButton>
          <span className="divider" aria-hidden />
          {user ? (
            <>
              <button type="button" className={`text-button edit-toggle ${editMode ? "on" : ""}`} aria-pressed={editMode} onClick={() => { setEditMode((e) => !e); if (mode !== "view" && mode !== "box") cancel_mode(); }}>
                <PenLine /> <span>{editMode ? "Editing" : "Edit"}</span>
              </button>
              <IconButton label={`Sign out ${user}`} onClick={leave} disabled={saving}><LogOut /></IconButton>
            </>
          ) : (
            <button type="button" className="text-button" onClick={() => setSheet({ kind: "sign-in" })}>
              <LogIn /> <span>Sign in</span>
            </button>
          )}
        </nav>
      </header>

      {panel === "maps" && (
        <MapsPanel
          maps={activeMaps}
          currentMap={currentMap}
          onPick={(id) => { setMapId(id); setPanel(null); if (mode !== "view") cancel_mode(); }}
          onClose={() => setPanel(null)}
          editMode={canEdit}
          onNewMap={() => setSheet({ kind: "map" })}
          onEditMap={(m) => setSheet({ kind: "map", map: m })}
        />
      )}
      {panel === "layers" && (
        <LayersPanel
          layers={layers}
          enabledLayerIds={layerIds}
          onSetLayers={setLayerIds}
          onClose={() => setPanel(null)}
          editMode={canEdit}
          saving={saving}
          onEditLayer={(layer, next) => commit(update_layer(data, layer.layer_id, next, user!), `${next.layer_name} updated.`)}
        />
      )}

      {canEdit && mode === "view" && (
        <div className="editbar glass">
          <button type="button" className="primary" onClick={() => { setSelectedItemId(null); setMode("draw"); }}>Draw a shape</button>
          <button type="button" onClick={() => setSheet({ kind: "items" })}><TableIcon /> Items</button>
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
          <button type="button" onClick={() => mapRef.current?.redo()}>Redo</button>
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
          editMode={canEdit}
          saving={saving}
          onClose={() => setSelectedItemId(null)}
          onOpenOn={(id) => open_item_on_map(selectedItem, id)}
          onEditDetails={() => setSheet({ kind: "edit-item", item: selectedItem })}
          onEditShape={() => setMode("edit")}
          onMoveShape={() => placementHere && setSheet({ kind: "move-shape", placement: placementHere })}
          onCopyFrom={(fromId) => copy_shape_from(selectedItem, fromId)}
          onDrawHere={() => setMode("draw")}
          onRemoveHere={() => placementHere && commit(delete_placement(data, placementHere, user!), `Removed from ${currentMap.name}.`,
            (d) => restore_placement(d, d.placements.find((p) => p.placement_id === placementHere.placement_id)!, user!))}
          onDeleteItem={async () => {
            const id = selectedItem.item_id;
            if (await commit(delete_item(data, selectedItem, user!), `${selectedItem.name || "Item"} deleted.`, (d) => restore_item(d, d.items.find((i) => i.item_id === id)!, user!))) setSelectedItemId(null);
          }}
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
            if (await commit(update_item(data, sheet.item, result.fields, result.layer, user!), "Details saved.")) {
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
          tilesets={data.tilesets
            .filter((t) => t.map_id === sheet.map?.map_id && t.status === "active")
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((t) => ({ tileset: t, blocker: publish_blocker(data, sheet.map, t) }))}
          onPublish={async (t) => {
            if (await commit(publish_tileset(data, t, user!), `${sheet.map?.name} now shows the tiles from ${t.created_at.slice(0, 16).replace("T", " ")}.`)) setSheet(null);
          }}
          onCancel={() => setSheet(null)}
          onSubmit={async (fields: MapFields) => {
            if (await commit(save_map(data, fields, user!), `${fields.name} saved.`)) {
              setSheet(null);
              setMapId(fields.map_id);
            }
          }}
        />
      )}
      {sheet?.kind === "about" && <AboutSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === "items" && (
        <ItemTable
          data={data}
          layers={layers}
          mapsById={mapsById}
          saving={saving}
          onClose={() => setSheet(null)}
          onSave={(item, fields, layer) => commit(update_item(data, item, fields, layer, user!), `${fields.name.trim()} saved.`)}
          onDelete={(item) => commit(delete_item(data, item, user!), `${item.name || "Item"} deleted.`, (d) => restore_item(d, d.items.find((i) => i.item_id === item.item_id)!, user!))}
          onRestore={(item) => commit(restore_item(data, item, user!), `${item.name || "Item"} restored.`, (d) => delete_item(d, d.items.find((i) => i.item_id === item.item_id)!, user!))}
          onRestorePlacement={(pl) => guarded(() => commit(restore_placement(data, pl, user!), `${pl.item_name || "Shape"} is back on ${pl.map_name}.`,
            (d) => delete_placement(d, d.placements.find((x) => x.placement_id === pl.placement_id)!, user!)))}
          onOpenOn={(item, id) => { setSheet(null); open_item_on_map(item, id); }}
        />
      )}
      {sheet?.kind === "move-shape" && (
        <ItemForm
          title={`Move this shape on ${currentMap.name}`}
          items={data.items}
          layers={layers}
          currentMap={currentMap}
          defaultLayerId={sheet.placement.layer_id}
          saving={saving}
          existingBlocker={(target) => reassign_blocker(data, sheet.placement, target)}
          submitLabels={{ existing: "Move it here", new: "Move to new item" }}
          onCancel={() => setSheet(null)}
          onSubmit={(result) => move_shape(sheet.placement, result)}
        />
      )}

      {sheet?.kind === "sign-in" && (
        <SignInSheet onClose={() => setSheet(null)} onSignedIn={(email) => {
          setUser(email);
          setSheet(null);
          toasts.push({ tone: "success", text: `Signed in as ${email}.` });
          // Admins see deleted rows (to restore) and tile sets; reload with those.
          load_dataset(true).then(setData).catch((e: Error) => toasts.push({ tone: "error", text: `Could not load admin data: ${e.message}` }));
        }} />
      )}
      <Toasts toasts={toasts.list} onDismiss={toasts.dismiss} />
    </div>
  );
}

function IconButton({ label, onClick, children, disabled, active }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" className={`icon-button ${active ? "active" : ""}`} onClick={onClick} disabled={disabled} aria-label={label} title={disabled ? "Finish what you are doing on the map first" : label} aria-pressed={active}>
      {children}
    </button>
  );
}
