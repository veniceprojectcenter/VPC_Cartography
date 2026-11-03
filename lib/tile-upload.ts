// Image file -> a complete tile set in storage, or an error. Never a map pointing at half a set:
// this only uploads; the caller publishes the set to a map after `verified` comes back.
//
// Resumable: tiles already stored for this tile set are skipped, so running it again with the
// same file and tile set id uploads only what is missing.

import { auth_headers } from "./auth-client";

export type Plan = { width: number; height: number; maxZoom: number; tileCount: number; levels: { z: number; width: number; height: number; cols: number; rows: number }[] };
export type Progress = { phase: "reading" | "tiling" | "verifying"; made: number; uploaded: number; skipped: number; total: number };
export type UploadResult = { plan: Plan; base: string; sourceName: string; verified: true };

// Tiles per worker pull, and PUTs in flight. Enough to keep a connection busy without holding much.
const BATCH = 48;
const PARALLEL = 6;
const RETRIES = 3;

async function tiles_api<T>(body: object): Promise<T> {
  const res = await fetch("/api/tiles", { method: "POST", headers: { "Content-Type": "application/json", ...(await auth_headers()) }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `tile storage refused (${res.status})`);
  return json as T;
}

type SignedPut = { key: string; url: string; headers: Record<string, string> };

async function put_with_retry(put: SignedPut, body: Blob | Uint8Array, signal?: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(put.url, { method: "PUT", headers: put.headers, body: body as BodyInit, signal });
      if (res.ok) return;
      throw new Error(`${put.key}: storage answered ${res.status}`);
    } catch (e) {
      if (signal?.aborted || attempt >= RETRIES) throw e;
      // 1 s, then 3 s: a dropped connection usually comes back within that.
      await new Promise((r) => setTimeout(r, 1000 * (2 * attempt - 1)));
    }
  }
}

async function run_parallel<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

// What storage already holds for a tile set, and the URL it is read from.
export function stored_tiles(tilesetId: string): Promise<{ names: string[]; base: string }> {
  return tiles_api({ action: "list", tileset_id: tilesetId });
}

export function planned_names(plan: Plan): string[] {
  return plan.levels.flatMap((l) => Array.from({ length: l.cols * l.rows }, (_, i) => `${l.z}/${i % l.cols}/${Math.floor(i / l.cols)}.webp`));
}

export function source_name(file: File): string {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!/^(jpe?g|png|tiff?|webp)$/.test(ext)) throw new Error("The image must be JPEG, PNG, TIFF or WebP.");
  return `source.${ext}`;
}

// Opens the worker and reads the image's size and tile plan. Cheap next to the upload itself.
export function open_tiler(file: File): Promise<{ worker: Worker; plan: Plan }> {
  if (!crossOriginIsolated) return Promise.reject(new Error("This page is not cross-origin isolated, so the tiler cannot start. Open the uploader from its own page (/upload)."));
  const worker = new Worker("/tiler/tiler.worker.js", { type: "module" });
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "plan") resolve({ worker, plan: data.plan });
      else if (data.type === "error") { worker.terminate(); reject(new Error(`Could not read the image: ${data.message}`)); }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || "The tiler stopped.")); };
    worker.postMessage({ type: "open", file });
  });
}

function pull(worker: Worker, count: number): Promise<{ tiles: { key: string; data: Uint8Array }[]; done: boolean }> {
  return new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => (data.type === "tiles" ? resolve(data) : reject(new Error(data.message)));
    worker.postMessage({ type: "pull", count });
  });
}

export async function upload_tileset(args: { file: File; tilesetId: string; worker: Worker; plan: Plan; onProgress: (p: Progress) => void; signal?: AbortSignal }): Promise<UploadResult> {
  const { file, tilesetId, worker, plan, onProgress, signal } = args;
  const progress: Progress = { phase: "reading", made: 0, uploaded: 0, skipped: 0, total: plan.tileCount };
  const report = () => onProgress({ ...progress });
  try {
    const sourceName = source_name(file);
    const { names: stored, base } = await tiles_api<{ names: string[]; base: string }>({ action: "list", tileset_id: tilesetId });
    const have = new Set(stored);

    // The original first: kept so the map can be re-tiled later, and a bad file fails before any tile.
    if (!have.has(sourceName)) {
      const [put] = (await tiles_api<{ puts: SignedPut[] }>({ action: "sign", tileset_id: tilesetId, names: [sourceName] })).puts;
      await put_with_retry(put, file, signal);
    }

    progress.phase = "tiling";
    report();
    for (let done = false; !done;) {
      signal?.throwIfAborted();
      const batch = await pull(worker, BATCH);
      done = batch.done;
      progress.made += batch.tiles.length;
      const todo = batch.tiles.filter((t) => !have.has(t.key));
      progress.skipped += batch.tiles.length - todo.length;
      if (todo.length) {
        const { puts } = await tiles_api<{ puts: SignedPut[] }>({ action: "sign", tileset_id: tilesetId, names: todo.map((t) => t.key) });
        const bytes = new Map(todo.map((t) => [t.key, t.data]));
        await run_parallel(puts, async (put) => {
          await put_with_retry(put, bytes.get(put.key)!, signal);
          progress.uploaded++;
          report();
        });
      }
      report();
    }

    // The proof the set is whole: storage lists every tile the plan has, and the original.
    progress.phase = "verifying";
    report();
    const now = new Set((await tiles_api<{ names: string[] }>({ action: "list", tileset_id: tilesetId })).names);
    const missing = [sourceName, ...planned_names(plan)].filter((n) => !now.has(n));
    if (missing.length) throw new Error(`${missing.length} of ${plan.tileCount} tiles did not arrive (first: ${missing[0]}). Run the upload again to send just those.`);
    return { plan, base, sourceName, verified: true };
  } finally {
    worker.terminate();
  }
}
