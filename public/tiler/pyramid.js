// Image -> XYZ tile pyramid, with wasm-vips. Shared by the browser worker and the Node check.
//
// The pyramid is the "google" layout: zoom 0 is the whole image in one 256px tile, each level
// doubles, the deepest is the image at full size. Tiles are 256x256 WebP, keyed z/x/y.webp,
// y counted from the top. Edge tiles are padded with transparency, never stretched.
//
// Memory: wasm-vips has at most 2 GB, and a large engraving decoded whole is more than that.
// So nothing is ever held whole. The image is read once, top to bottom, in 256-row strips (vips
// decodes only those rows). Each strip is cut into tiles, halved, and handed to the level below,
// which cuts its own tiles once it has 256 rows, halves them and hands them on. One pass makes
// every level, holding about one strip per level. The file sits in the emscripten file system
// (JS memory, outside the wasm heap), so its bytes are never copied into the heap.

// In the browser this is MEMFS. Node's build maps the real disk, so the Node check passes its own path.
let SOURCE_PATH = "/source-image";
export function set_source_path(path) {
  SOURCE_PATH = path;
}

export const TILE_SIZE = 256;
const WEBP = { Q: 82, effort: 2 };

// Levels, sizes and the tile count, from the image size alone.
export function pyramid_plan(width, height) {
  const maxZoom = Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE)));
  const levels = [];
  for (let z = maxZoom; z >= 0; z--) {
    const scale = 2 ** (maxZoom - z);
    const w = Math.ceil(width / scale);
    const h = Math.ceil(height / scale);
    levels.push({ z, width: w, height: h, cols: Math.ceil(w / TILE_SIZE), rows: Math.ceil(h / TILE_SIZE) });
  }
  const tileCount = levels.reduce((n, l) => n + l.cols * l.rows, 0);
  return { width, height, maxZoom, levels, tileCount };
}

export function tile_key(z, x, y) {
  return `${z}/${x}/${y}.webp`;
}

// Three bands (sRGB) or four (sRGB + alpha), whatever came in.
function as_srgb(image) {
  const hasAlpha = image.hasAlpha();
  let out = image.interpretation === "srgb" || image.bands >= 3 ? image : image.colourspace("srgb");
  if (out.format !== "uchar") out = out.cast("uchar");
  return { image: out, hasAlpha };
}

// The image's size without decoding it, from the bytes the caller has.
export function image_size(vips, bytes) {
  stage_source(vips, bytes);
  const image = vips.Image.newFromFile(SOURCE_PATH, { access: "sequential" });
  const size = { width: image.width, height: image.height };
  image.delete();
  return size;
}

function stage_source(vips, bytes) {
  // Each operation's result would otherwise stay cached, and with it the decoded pixels.
  vips.Cache.max(0);
  vips.FS.writeFile(SOURCE_PATH, bytes);
}

// wasm-vips frees images only at the end of an event-loop turn; this all runs in one, so every
// intermediate is freed here by hand. A lazy result also pins the pixels of what it was cut from.
function settle(lazy) {
  const solid = lazy.copyMemory();
  lazy.delete();
  return solid;
}

function replace(old, next) {
  old.delete();
  return next;
}

function* strip_tiles(level, row, strip, hasAlpha) {
  for (let x = 0; x < level.cols; x++) {
    const left = x * TILE_SIZE;
    const w = Math.min(TILE_SIZE, strip.width - left);
    let tile = strip.extractArea(left, 0, w, strip.height);
    if (w < TILE_SIZE || strip.height < TILE_SIZE) {
      if (!hasAlpha) tile = replace(tile, tile.bandjoin(255));
      tile = replace(tile, tile.embed(0, 0, TILE_SIZE, TILE_SIZE, { extend: "background", background: [0, 0, 0, 0] }));
    }
    const data = tile.webpsaveBuffer(WEBP);
    tile.delete();
    yield { z: level.z, x, y: row, key: tile_key(level.z, x, row), data };
  }
}

// Half size, rounding up: an odd last row or column is repeated, then 2x2 boxes are averaged.
function halve(strip) {
  const w = strip.width + (strip.width % 2);
  const h = strip.height + (strip.height % 2);
  const even = w === strip.width && h === strip.height ? null : strip.embed(0, 0, w, h, { extend: "copy" });
  const half = settle((even ?? strip).shrink(2, 2));
  even?.delete();
  return half;
}

// Yields { z, x, y, key, data } for every tile; `data` is a Uint8Array of WebP bytes.
// Order: by strip, top to bottom, with smaller levels interleaved as their strips fill.
export function* pyramid_tiles(vips, bytes, plan) {
  stage_source(vips, bytes);
  const opened = vips.Image.newFromFile(SOURCE_PATH, { access: "sequential" });
  const { image, hasAlpha } = as_srgb(opened);
  // Per level below the deepest: rows waiting to make a full strip, and the next strip row to emit.
  const pending = plan.levels.map(() => null);
  const nextRow = plan.levels.map(() => 0);

  // Takes a strip for level i (and owns it), emits the full strips it completes, passes halves down.
  function* feed(i, strip, last) {
    let rows = strip;
    if (pending[i]) {
      rows = settle(pending[i].join(strip, "vertical"));
      pending[i].delete();
      strip.delete();
      pending[i] = null;
    }
    while (rows && (rows.height >= TILE_SIZE || (last && rows.height > 0))) {
      let full = rows;
      let rest = null;
      if (rows.height > TILE_SIZE) {
        full = settle(rows.extractArea(0, 0, rows.width, TILE_SIZE));
        rest = settle(rows.extractArea(0, TILE_SIZE, rows.width, rows.height - TILE_SIZE));
        rows.delete();
      }
      yield* strip_tiles(plan.levels[i], nextRow[i]++, full, hasAlpha);
      if (i + 1 < plan.levels.length) yield* feed(i + 1, halve(full), last && !rest);
      full.delete();
      rows = rest;
    }
    pending[i] = rows;
  }

  const deepest = plan.levels[0];
  for (let y = 0; y < deepest.rows; y++) {
    const top = y * TILE_SIZE;
    const height = Math.min(TILE_SIZE, deepest.height - top);
    // Pulling one strip into memory is what keeps the whole image from being decoded at once.
    const strip = settle(image.extractArea(0, top, deepest.width, height));
    yield* feed(0, strip, y === deepest.rows - 1);
  }
  image.delete();
  if (opened !== image) opened.delete();
  vips.FS.unlink(SOURCE_PATH);
}
