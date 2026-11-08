// The minimap: the whole map, always, with a box on the part the main view is showing.
//
// ol/control/OverviewMap is not used on purpose. It re-fits its own view to the main view each
// time the main view moves, so zoomed in it shows a fragment around the main view, not the whole
// map. Here the minimap view is fixed to the full extent and only the box moves.

import Control from "ol/control/Control";
import Collection from "ol/Collection";
import Feature from "ol/Feature";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import type TileSource from "ol/source/Tile";
import { Polygon, type Geometry } from "ol/geom";
import { fromExtent } from "ol/geom/Polygon";
import { Fill, Stroke, Style } from "ol/style";
import { equals, getCenter, type Extent } from "ol/extent";
import type { ProjectionLike } from "ol/proj";
import type MapBrowserEvent from "ol/MapBrowserEvent";

// The minimap takes the map's own proportions (within limits), so there is no empty band round it.
const WIDTH = 160;
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 160;
// Space kept clear round the map inside the minimap.
const MARGIN = 6;

type Options = { source: TileSource; projection: ProjectionLike; extent: Extent };

export default class MiniMap extends Control {
  private readonly mini: OlMap;
  private readonly box = new Feature<Geometry>();
  private shown: Extent | null = null;
  private readonly follow = () => this.update_box();

  constructor({ source, projection, extent }: Options) {
    const [x0, y0, x1, y1] = extent;
    const width = WIDTH;
    const height = Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, (width - 2 * MARGIN) * ((y1 - y0) / (x1 - x0)) + 2 * MARGIN)));
    const element = document.createElement("div");
    element.className = "minimap ol-unselectable";
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
    super({ element });

    const resolution = Math.max((x1 - x0) / (width - 2 * MARGIN), (y1 - y0) / (height - 2 * MARGIN));
    // One resolution only: the view cannot drift from the full map.
    const view = new View({ projection, center: getCenter(extent), resolution, minResolution: resolution, maxResolution: resolution });

    this.box.setStyle(new Style({
      stroke: new Stroke({ color: "#007aff", width: 2 }),
      fill: new Fill({ color: "rgba(0, 122, 255, 0.14)" }),
    }));
    this.mini = new OlMap({
      target: element,
      view,
      layers: [
        new TileLayer({ source, extent }),
        new VectorLayer({ source: new VectorSource({ features: [this.box] }) }),
      ],
      controls: new Collection(),
      interactions: new Collection(),
    });

    // Click or drag on the minimap: the main view goes there.
    const recentre = (e: MapBrowserEvent) => this.getMap()?.getView().setCenter(e.coordinate);
    this.mini.on("click", recentre);
    this.mini.on("pointerdrag", recentre);
  }

  override setMap(map: OlMap | null) {
    const old = this.getMap();
    if (old) {
      old.un("postrender", this.follow);
      old.un("change:size", this.follow);
    }
    super.setMap(map);
    if (!map) {
      this.mini.setTarget(undefined);
      return;
    }
    this.mini.setTarget(this.element);
    map.on("postrender", this.follow);
    map.on("change:size", this.follow);
    this.update_box();
  }

  private update_box() {
    const map = this.getMap();
    const size = map?.getSize();
    if (!map || !size) return;
    const extent = map.getView().calculateExtent(size);
    if (this.shown && equals(extent, this.shown)) return;
    this.shown = extent;
    this.box.setGeometry(fromExtent(extent) as Polygon);
  }
}
