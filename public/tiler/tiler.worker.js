// Web Worker: an image file in, tiles out, on request. Plain JS served from public/ so the
// bundler never touches wasm-vips. Needs a cross-origin-isolated page (next.config.ts, /upload).
//
//   page -> { type: "open", file }    worker -> { type: "plan", plan } | { type: "error", message }
//   page -> { type: "pull", count }   worker -> { type: "tiles", tiles: [{ key, data }], done }
//
// The page pulls the next batch only when it has room, so finished tiles never pile up here.

import Vips from "/vendor/wasm-vips/vips-es6.js";
import { image_size, pyramid_plan, pyramid_tiles } from "./pyramid.js";

let vips = null;
let tiles = null;

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === "open") {
      // The HEIF and JPEG XL decoders are separate downloads; engravings come as JPEG, PNG, TIFF or WebP.
      vips ??= await Vips({ dynamicLibraries: [] });
      const bytes = new Uint8Array(await msg.file.arrayBuffer());
      const { width, height } = image_size(vips, bytes);
      const plan = pyramid_plan(width, height);
      tiles = pyramid_tiles(vips, bytes, plan);
      self.postMessage({ type: "plan", plan });
    } else if (msg.type === "pull") {
      const batch = [];
      let done = false;
      while (batch.length < msg.count) {
        const next = tiles.next();
        if (next.done) { done = true; break; }
        // A view on the shared wasm heap can't be transferred; a copy of its bytes can.
        const { key, data } = next.value;
        batch.push({ key, data: data.buffer instanceof ArrayBuffer ? data : data.slice() });
      }
      self.postMessage({ type: "tiles", tiles: batch, done }, batch.map((t) => t.data.buffer));
    }
  } catch (e) {
    self.postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
