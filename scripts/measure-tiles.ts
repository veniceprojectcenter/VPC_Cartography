// Measures each gdal2tiles pyramid in maps/ and writes data/tile-extents.json.
// The import reads that file, so the 2.5 GB tree is only needed when the tiles change.
//
// State space: maps/<dir>/<z>/<x>/<y>.png, TMS rows (y counts up from the south), spherical mercator.

import { readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TILES_ROOT = "maps";
const OUT = "data/tile-extents.json";

type Extent = { max_zoom: number; bounds: [[number, number], [number, number]] };

function numericDirs(path: string): number[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => Number(d.name));
}

function tileLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

function tileLat(yXyz: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * yXyz) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function measure_extent(mapDir: string): Extent {
  const z = Math.max(...numericDirs(mapDir));
  const xs = numericDirs(join(mapDir, String(z)));
  let minTms = Infinity;
  let maxTms = -Infinity;
  for (const x of xs) {
    for (const file of readdirSync(join(mapDir, String(z), String(x)))) {
      const y = Number(file.replace(/\.png$/, ""));
      if (Number.isNaN(y)) continue;
      minTms = Math.min(minTms, y);
      maxTms = Math.max(maxTms, y);
    }
  }
  const last = 2 ** z - 1;
  // TMS row r is XYZ row (2^z - 1 - r): the highest TMS row is the northern edge.
  const north = tileLat(last - maxTms, z);
  const south = tileLat(last - minTms + 1, z);
  const west = tileLon(Math.min(...xs), z);
  const east = tileLon(Math.max(...xs) + 1, z);
  return { max_zoom: z, bounds: [[south, west], [north, east]] };
}

function main() {
  if (!existsSync(TILES_ROOT)) throw new Error(`no ${TILES_ROOT}/ here — run from the repo root with the tile tree on disk`);
  const out: Record<string, Extent> = {};
  for (const dir of readdirSync(TILES_ROOT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    out[dir.name] = measure_extent(join(TILES_ROOT, dir.name));
    console.log(dir.name, JSON.stringify(out[dir.name]));
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`measured ${Object.keys(out).length} pyramids -> ${OUT}`);
}

main();
