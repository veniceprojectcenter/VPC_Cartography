"use client";

import "ol/ol.css";
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import XYZ from "ol/source/XYZ";
import VectorSource from "ol/source/Vector";
import Collection from "ol/Collection";
import GeoJSON from "ol/format/GeoJSON";
import type Feature from "ol/Feature";
import type { Geometry } from "ol/geom";
import { Fill, Stroke, Style } from "ol/style";
import { asArray } from "ol/color";
import { Projection, transformExtent, type ProjectionLike } from "ol/proj";
import TileGrid from "ol/tilegrid/TileGrid";
import { OverviewMap, ZoomToExtent, defaults as defaultControls } from "ol/control";
import { DragBox, Draw, Modify, Snap, Translate } from "ol/interaction";
import { altKeyOnly, always, shiftKeyOnly, singleClick } from "ol/events/condition";
import type { MapRow, PlacementRow } from "@/lib/rows";
import type { Polygon } from "@/lib/geometry";

export type MapMode = "view" | "draw" | "edit" | "box";

export type MapViewHandle = {
  focus_placement: (placementId: string) => void;
  undo: () => void;
  edited_geometry: () => Polygon | null;
  export_view: () => Promise<Blob>;
};

type Props = {
  ref?: Ref<MapViewHandle>;
  map: MapRow;
  placements: PlacementRow[];
  selectedId: string | null;
  mode: MapMode;
  editingId: string | null;
  insetLeft: number;
  onSelect: (placementId: string | null) => void;
  onDrawn: (geometry: Polygon) => void;
  onBox: (blob: Blob) => void;
  onCancelMode: () => void;
};

// Two frames a map can be in (maps.crs):
//   legacy-mercator  the gdal2tiles maps: tiles on spherical mercator, polygons in lon/lat
//   pixel            uploaded maps: tiles in the google layout from lib/../public/tiler, polygons in
//                    image pixels, x right from the left edge, y up from the bottom edge
type Frame = { projection: ProjectionLike; extent: number[]; geojson: GeoJSON; tileGrid?: TileGrid; maxResolution?: number };

const TILE_SIZE = 256;

function map_frame(map: MapRow): Frame {
  if (map.crs !== "pixel") {
    const [[south, west], [north, east]] = JSON.parse(map.bounds) as [[number, number], [number, number]];
    return {
      projection: "EPSG:3857",
      extent: transformExtent([west, south, east, north], "EPSG:4326", "EPSG:3857"),
      geojson: new GeoJSON({ dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }),
    };
  }
  const width = Number(map.image_width);
  const height = Number(map.image_height);
  const maxZoom = Number(map.max_zoom);
  const extent = [0, 0, width, height];
  const projection = new Projection({ code: `pixel:${map.map_id}:${width}x${height}`, units: "pixels", extent });
  // Zoom z shows the image at 1 / 2^(maxZoom - z); tiles are counted from the top-left corner.
  const resolutions = Array.from({ length: maxZoom + 1 }, (_, z) => 2 ** (maxZoom - z));
  return {
    projection,
    extent,
    geojson: new GeoJSON({ dataProjection: projection, featureProjection: projection }),
    tileGrid: new TileGrid({ extent, origin: [0, height], resolutions, tileSize: TILE_SIZE }),
    maxResolution: resolutions[0],
  };
}

// Leaflet 0.7 path defaults the old viewer drew with: stroke opacity 0.5, fill opacity 0.2, weight 2.
const STROKE_ALPHA = 0.5;
const FILL_ALPHA = 0.2;
const STROKE_WIDTH = 2;

const styleCache = new Map<string, Style[]>();
function polygon_style(color: string, state: "normal" | "selected" | "editing"): Style[] {
  const key = `${color}|${state}`;
  const hit = styleCache.get(key);
  if (hit) return hit;
  const [r, g, b] = asArray(color || "#3388ff");
  const strong = state !== "normal";
  const styles = [
    ...(strong ? [new Style({ stroke: new Stroke({ color: "rgba(255,255,255,0.9)", width: 6 }) })] : []),
    new Style({
      stroke: new Stroke({ color: [r, g, b, strong ? 1 : STROKE_ALPHA], width: strong ? 3 : STROKE_WIDTH, lineDash: state === "editing" ? [8, 6] : undefined }),
      fill: new Fill({ color: [r, g, b, strong ? 0.35 : FILL_ALPHA] }),
    }),
  ];
  styleCache.set(key, styles);
  return styles;
}

function tile_source(map: MapRow, frame: Frame) {
  if (frame.tileGrid) return new XYZ({ url: map.tiles_url, projection: frame.projection, tileGrid: frame.tileGrid, crossOrigin: "anonymous", wrapX: false });
  return new XYZ({ url: map.tiles_url, maxZoom: Number(map.max_zoom), crossOrigin: "anonymous", wrapX: false });
}

function frame_view(map: MapRow, frame: Frame, options: { showFullExtent?: boolean } = {}) {
  // One zoom level past the deepest tiles, as the old viewer allowed.
  return new View({
    projection: frame.projection,
    extent: frame.extent,
    minZoom: frame.tileGrid ? 0 : Number(map.min_zoom),
    maxZoom: Number(map.max_zoom) + 1,
    maxResolution: frame.maxResolution,
    constrainOnlyCenter: true,
    ...options,
  });
}

// The canonical OpenLayers export: paint every layer canvas, with its own transform and opacity, onto one.
function compose_canvas(olMap: OlMap): HTMLCanvasElement {
  const size = olMap.getSize()!;
  const ratio = window.devicePixelRatio || 1;
  const out = document.createElement("canvas");
  out.width = Math.round(size[0] * ratio);
  out.height = Math.round(size[1] * ratio);
  const ctx = out.getContext("2d")!;
  const viewport = olMap.getViewport()?.querySelector(".ol-layers");
  viewport?.querySelectorAll<HTMLCanvasElement>(".ol-layer canvas").forEach((canvas) => {
    if (canvas.width === 0) return;
    const parent = canvas.parentElement as HTMLElement;
    ctx.globalAlpha = parent.style.opacity === "" ? 1 : Number(parent.style.opacity);
    const m = canvas.style.transform.match(/^matrix\(([^(]*)\)$/);
    const matrix = m ? m[1].split(",").map(Number) : [canvas.width / out.width, 0, 0, canvas.height / out.height, 0, 0];
    ctx.setTransform(matrix[0] * ratio, matrix[1], matrix[2], matrix[3] * ratio, matrix[4] * ratio, matrix[5] * ratio);
    ctx.drawImage(canvas, 0, 0);
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  return out;
}

function canvas_blob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("the browser refused to encode the image"))), "image/png"));
}

function rendered(olMap: OlMap): Promise<void> {
  return new Promise((resolve) => {
    olMap.once("rendercomplete", () => resolve());
    olMap.render();
  });
}

// Fits leave room for whatever floats over the left edge (an open panel), so nothing lands under it.
function padding(insetLeft: number, base: number): number[] {
  return [base, base / 2, base / 2, insetLeft + base / 2];
}

export default function MapView({ ref, map, placements, selectedId, mode, editingId, insetLeft, onSelect, onDrawn, onBox, onCancelMode }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const olRef = useRef<OlMap | null>(null);
  const tileLayer = useRef<TileLayer<XYZ> | null>(null);
  const overview = useRef<OverviewMap | null>(null);
  const viewAll = useRef<ZoomToExtent | null>(null);
  const vectorSource = useRef(new VectorSource<Feature<Geometry>>());
  const sketchSource = useRef(new VectorSource<Feature<Geometry>>());
  const history = useRef<Geometry[]>([]);
  const activeDraw = useRef<Draw | null>(null);
  const state = useRef({ selectedId, editingId, mode });
  state.current = { selectedId, editingId, mode };
  const callbacks = useRef({ onSelect, onDrawn, onBox, onCancelMode });
  callbacks.current = { onSelect, onDrawn, onBox, onCancelMode };
  const insetRef = useRef(insetLeft);
  insetRef.current = insetLeft;
  // The current map's frame; features are read and written through its GeoJSON format.
  const frameRef = useRef<Frame | null>(null);

  // One OpenLayers map for the component's life.
  useEffect(() => {
    const vectorLayer = new VectorLayer({
      source: vectorSource.current,
      style: (feature) => {
        const id = feature.getId();
        const s = state.current;
        const look = id === s.editingId ? "editing" : id === s.selectedId ? "selected" : "normal";
        return polygon_style(feature.get("layer_color"), look);
      },
    });
    const sketchLayer = new VectorLayer({ source: sketchSource.current, style: polygon_style("#007aff", "editing") });
    const tiles = new TileLayer<XYZ>();
    tileLayer.current = tiles;
    const olMap = new OlMap({
      target: host.current!,
      layers: [tiles, vectorLayer, sketchLayer],
      controls: defaultControls({ attribution: false, rotate: false }),
      view: new View({ center: [0, 0], zoom: 2 }),
    });
    olRef.current = olMap;
    // Debug handle for the dev console only.
    if (process.env.NODE_ENV !== "production") (window as unknown as { olMap: OlMap }).olMap = olMap;

    olMap.on("singleclick", (e) => {
      if (state.current.mode !== "view") return;
      const hit = olMap.forEachFeatureAtPixel(e.pixel, (f) => f, { layerFilter: (l) => l === vectorLayer });
      callbacks.current.onSelect(hit ? String(hit.getId()) : null);
    });
    olMap.on("pointermove", (e) => {
      if (e.dragging) return;
      const over = state.current.mode === "view" && olMap.hasFeatureAtPixel(e.pixel, { layerFilter: (l) => l === vectorLayer });
      const target = olMap.getTargetElement();
      if (target) target.style.cursor = over ? "pointer" : "";
    });

    const ro = new ResizeObserver(() => olMap.updateSize());
    ro.observe(host.current!);
    return () => {
      ro.disconnect();
      olMap.setTarget(undefined);
      olRef.current = null;
    };
  }, []);

  // Switching maps: new tiles, new minimap, new "view all", fit to the image.
  useEffect(() => {
    const olMap = olRef.current!;
    const frame = map_frame(map);
    frameRef.current = frame;
    const { extent } = frame;
    tileLayer.current!.setSource(tile_source(map, frame));
    tileLayer.current!.setExtent(extent);
    olMap.setView(frame_view(map, frame));
    olMap.getView().fit(extent, { padding: padding(insetRef.current, 96) });

    if (overview.current) olMap.removeControl(overview.current);
    if (viewAll.current) olMap.removeControl(viewAll.current);
    // Without its own extent the minimap zooms out to the whole globe, where these images are a sliver at the pole.
    overview.current = new OverviewMap({
      layers: [new TileLayer({ source: tile_source(map, frame), extent })],
      view: frame_view(map, frame, { showFullExtent: true }),
      collapsed: false,
      className: "ol-overviewmap minimap",
    });
    viewAll.current = new ZoomToExtent({ extent, label: "⤢", tipLabel: "View the whole map" });
    olMap.addControl(overview.current);
    olMap.addControl(viewAll.current);
  }, [map]);

  // Polygons for the current map and enabled layers.
  useEffect(() => {
    const source = vectorSource.current;
    source.clear();
    const features = placements.map((p) => {
      const f = frameRef.current!.geojson.readFeature({ type: "Feature", geometry: JSON.parse(p.geometry), properties: { layer_color: p.layer_color } }) as Feature<Geometry>;
      f.setId(p.placement_id);
      return f;
    });
    source.addFeatures(features);
  }, [placements]);

  useEffect(() => {
    vectorSource.current.changed();
  }, [selectedId, editingId]);

  // Interactions per mode. Each mode installs what it needs and removes it on the way out.
  useEffect(() => {
    const olMap = olRef.current!;
    const sketch = sketchSource.current;
    const added: (Draw | Modify | Snap | Translate | DragBox)[] = [];
    const add = <T extends Draw | Modify | Snap | Translate | DragBox>(i: T) => {
      olMap.addInteraction(i);
      added.push(i);
      return i;
    };
    let onKey: ((e: KeyboardEvent) => void) | null = null;

    if (mode === "draw") {
      sketchSource.current.clear();
      const draw = add(new Draw({ source: sketchSource.current, type: "Polygon" }));
      activeDraw.current = draw;
      add(new Snap({ source: vectorSource.current }));
      draw.on("drawend", (e) => {
        const geometry = frameRef.current!.geojson.writeGeometryObject(e.feature.getGeometry()!) as Polygon;
        callbacks.current.onDrawn(geometry);
      });
      onKey = (e) => {
        if (isTyping(e)) return;
        // F15: backspace takes back the last point while drawing.
        if (e.key === "Backspace") { e.preventDefault(); draw.removeLastPoint(); }
        if (e.key === "Escape") { draw.abortDrawing(); callbacks.current.onCancelMode(); }
      };
    }

    if (mode === "edit" && editingId) {
      const feature = vectorSource.current.getFeatureById(editingId) as Feature<Geometry> | null;
      if (feature) {
        // Cancelling needs no copy here: the caller hands back fresh placements and the features are rebuilt from rows.
        history.current = [];
        const features = new Collection([feature]);
        // F15: shift-click deletes a vertex; a plain click on an edge adds one.
        const modify = add(new Modify({ features, deleteCondition: (e) => shiftKeyOnly(e) && singleClick(e) }));
        const translate = add(new Translate({ features, condition: altKeyOnly }));
        add(new Snap({ source: vectorSource.current }));
        const remember = () => history.current.push(feature.getGeometry()!.clone());
        modify.on("modifystart", remember);
        translate.on("translatestart", remember);
        onKey = (e) => {
          if (isTyping(e)) return;
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undoEdit(); }
          if (e.key === "Escape") callbacks.current.onCancelMode();
        };
      }
    }

    if (mode === "box") {
      const box = add(new DragBox({ condition: always, className: "ol-dragbox region-box" }));
      box.on("boxend", async () => {
        const [x0, y0] = olMap.getPixelFromCoordinate([box.getGeometry().getExtent()[0], box.getGeometry().getExtent()[3]]);
        const [x1, y1] = olMap.getPixelFromCoordinate([box.getGeometry().getExtent()[2], box.getGeometry().getExtent()[1]]);
        await rendered(olMap);
        const full = compose_canvas(olMap);
        const ratio = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round((x1 - x0) * ratio));
        const h = Math.max(1, Math.round((y1 - y0) * ratio));
        const crop = document.createElement("canvas");
        crop.width = w;
        crop.height = h;
        crop.getContext("2d")!.drawImage(full, Math.round(x0 * ratio), Math.round(y0 * ratio), w, h, 0, 0, w, h);
        callbacks.current.onBox(await canvas_blob(crop));
      });
      onKey = (e) => { if (e.key === "Escape") callbacks.current.onCancelMode(); };
    }

    if (onKey) window.addEventListener("keydown", onKey);
    return () => {
      if (onKey) window.removeEventListener("keydown", onKey);
      added.forEach((i) => olMap.removeInteraction(i));
      activeDraw.current = null;
      if (mode === "draw") sketch.clear();
    };
  }, [mode, editingId]);

  function undoEdit() {
    const id = state.current.editingId;
    const feature = id ? (vectorSource.current.getFeatureById(id) as Feature<Geometry> | null) : null;
    const previous = history.current.pop();
    if (feature && previous) feature.setGeometry(previous);
  }

  useImperativeHandle(ref, () => ({
    focus_placement(placementId) {
      const f = vectorSource.current.getFeatureById(placementId);
      const geom = f?.getGeometry();
      if (!geom) return;
      // The inspector card (340px + gutter) sits on the right on wide screens; keep the shape clear of it.
      const [top, , bottom, left] = padding(insetRef.current, 160);
      const right = window.innerWidth > 720 ? 380 : 80;
      olRef.current!.getView().fit(geom.getExtent(), { padding: [top, right, bottom, left], maxZoom: Number(map.max_zoom) - 1, duration: 450 });
    },
    undo() {
      if (state.current.mode === "draw") activeDraw.current?.removeLastPoint();
      else undoEdit();
    },
    edited_geometry() {
      const id = state.current.editingId;
      const geom = id ? vectorSource.current.getFeatureById(id)?.getGeometry() : null;
      return geom ? (frameRef.current!.geojson.writeGeometryObject(geom) as Polygon) : null;
    },
    async export_view() {
      const olMap = olRef.current!;
      await rendered(olMap);
      return canvas_blob(compose_canvas(olMap));
    },
  }), [map]);

  return <div ref={host} className="map-host" data-mode={mode} />;
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}
