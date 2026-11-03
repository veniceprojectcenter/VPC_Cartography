// Polygon helpers. Coordinates are GeoJSON [lng, lat] on the map's own frame.

export type Polygon = { type: "Polygon"; coordinates: number[][][] };

// Leaflet 0.7 wrapped tiles but not vectors, so admins drew some polygons on a repeated copy of
// the map (longitudes seen from -797 to 462). Shifting by whole turns puts each one back over
// the image it was traced on: same tile, same pixel.
export function wrapPolygonLongitudes(polygon: Polygon): Polygon {
  const ring = polygon.coordinates[0];
  const meanLng = ring.reduce((s, [lng]) => s + lng, 0) / ring.length;
  const turns = Math.floor((meanLng + 180) / 360);
  if (turns === 0) return polygon;
  return { type: "Polygon", coordinates: polygon.coordinates.map((r) => r.map(([lng, lat]) => [lng - turns * 360, lat])) };
}

// Bounding-box centre, as the old popup used (getBounds().getCenter()).
export function polygonCenter(polygon: Polygon): [number, number] {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lng, lat] of polygon.coordinates[0]) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [(west + east) / 2, (south + north) / 2];
}
