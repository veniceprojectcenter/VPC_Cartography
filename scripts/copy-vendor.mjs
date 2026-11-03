// Copies the wasm-vips browser build into public/vendor/, where the tiler worker loads it as plain
// static files. Runs on postinstall; public/vendor/ is git-ignored.

import { copyFileSync, mkdirSync } from "node:fs";

const FROM = "node_modules/wasm-vips/lib";
const TO = "public/vendor/wasm-vips";
// vips-es6.js loads vips.wasm beside it, and starts its threads from itself.
const FILES = ["vips-es6.js", "vips.wasm"];

mkdirSync(TO, { recursive: true });
for (const f of FILES) copyFileSync(`${FROM}/${f}`, `${TO}/${f}`);
console.log(`copied ${FILES.join(", ")} to ${TO}`);
