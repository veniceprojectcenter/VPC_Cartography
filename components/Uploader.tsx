"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ImageUp, RotateCcw, X } from "lucide-react";
import SignInSheet from "./SignInSheet";
import { signed_in_email } from "@/lib/auth-client";
import { load_dataset, save_rows, type Dataset } from "@/lib/store-client";
import { complete_tileset, publish_blocker, publish_tileset, start_tileset, tileset_progress, type MapInfo, type TileFields } from "@/lib/edits";
import { fetch_catalog_image, open_tiler, source_name, stored_tiles, upload_tileset, type Plan, type Progress } from "@/lib/tile-upload";
import type { MapRow, TilesetRow } from "@/lib/rows";
import { catalog_meta, is_tiled } from "@/lib/catalog";

// F17 from an image: pick it, tile it here in the browser, upload the tiles, and only once storage
// holds every one of them, point the map at them. A stopped upload leaves the map as it was and
// can be resumed with the same file.

type Step =
  | { kind: "pick" }
  | { kind: "planned"; file: File; worker: Worker; plan: Plan }
  | { kind: "running"; file: File; plan: Plan; progress: Progress; tileset: TilesetRow }
  | { kind: "stopped"; message: string; tileset?: TilesetRow }
  | { kind: "published"; mapId: string; tiles: number };

// How often the tile set row records its count while uploading: often enough to show how far a
// stopped upload got, rarely enough not to write a row per tile.
const PROGRESS_EVERY = 0.1;

function slug(name: string) {
  return name.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function pixel_tiles(base: string, plan: Plan, sourceName: string): TileFields {
  return {
    tiles_url: `${base}/{z}/{x}/{y}.webp`,
    tile_scheme: "xyz",
    crs: "pixel",
    min_zoom: "0",
    max_zoom: String(plan.maxZoom),
    // [[bottom, left], [top, right]] in image pixels, the same order as lat/lon bounds.
    bounds: JSON.stringify([[0, 0], [plan.height, plan.width]]),
    image_width: String(plan.width),
    image_height: String(plan.height),
    source_image_url: `${base}/${sourceName}`,
  };
}

const EMPTY_INFO: MapInfo = { map_id: "", name: "", year: "", parent: "", description: "", author: "", source: "", collection: "", scale: "" };

export default function Uploader() {
  const [user, setUser] = useState<string | null | undefined>(undefined);
  const [data, setData] = useState<Dataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The map to give new tiles to, from ?map=; none means a new map. Nothing renders from it before the
  // sign-in check, so reading it on the client only is safe.
  const [mapId] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("map")));
  const [info, setInfo] = useState<MapInfo>(EMPTY_INFO);
  const [idTouched, setIdTouched] = useState(false);
  const [resumeId, setResumeId] = useState<string>("");
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [tried, setTried] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    signed_in_email().then(setUser).catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    load_dataset(true).then(setData).catch((e: Error) => setLoadError(e.message));
  }, [user]);

  // Closing the tab mid-upload is safe (the map keeps its tiles), but it loses the progress.
  useEffect(() => {
    if (step.kind !== "running") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step.kind]);

  const map: MapRow | undefined = useMemo(() => data?.maps.find((m) => m.map_id === mapId), [data, mapId]);
  const unfinished = useMemo(() => (data?.tilesets ?? []).filter((t) => t.map_id === mapId && t.upload_state === "uploading" && t.status === "active").sort((a, b) => b.created_at.localeCompare(a.created_at)), [data, mapId]);
  const catalog = map?.status === "catalog" ? (catalog_meta(map) ?? { key: "", id: "", image_url: "", record_url: "" }) : null;
  const shapes = useMemo(() => (data && map ? data.placements.filter((p) => p.map_id === map.map_id && p.status === "active").length : 0), [data, map]);

  if (user === undefined) return <div className="fatal quiet">Checking who is signed in…</div>;
  if (!user) {
    return (
      <main className="page">
        <div className="page-card">
          <p className="note">The uploader is for admins.</p>
          {/* A full page load back: the viewer is not served cross-origin isolated, this page is. */}
          <SignInSheet onClose={() => window.location.assign(new URL("/", window.location.href))} onSignedIn={setUser} />
        </div>
      </main>
    );
  }
  if (loadError) return <div className="fatal">Could not read the data: {loadError}</div>;
  if (!data) return <div className="fatal quiet">Loading maps…</div>;
  if (mapId && !map) return <div className="fatal">There is no map “{mapId}”. <a href="/upload">Upload a new map instead.</a></div>;

  const errors: Partial<Record<keyof MapInfo, string>> = {};
  if (!map) {
    if (!info.name.trim()) errors.name = "A name is needed.";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(info.map_id)) errors.map_id = "Lowercase letters, numbers and dashes.";
    else if (data.maps.some((m) => m.map_id === info.map_id)) errors.map_id = "That id is taken.";
    if (!/^-?\d+$/.test(info.year.trim())) errors.year = "A year, as a number.";
  }
  const err = (k: keyof MapInfo) => (tried && errors[k] ? <span className="error">{errors[k]}</span> : null);
  const set = (k: keyof MapInfo) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInfo((f) => ({ ...f, [k]: value, ...(k === "name" && !idTouched ? { map_id: slug(value) } : {}) }));
    if (k === "map_id") setIdTouched(true);
  };

  async function choose(file: File | undefined) {
    if (!file) return;
    if (step.kind === "planned") step.worker.terminate();
    try {
      source_name(file);
      setStep({ kind: "stopped", message: "Reading the image…" });
      const { worker, plan } = await open_tiler(file);
      setStep({ kind: "planned", file, worker, plan });
    } catch (e) {
      setStep({ kind: "stopped", message: (e as Error).message });
    }
  }

  async function use_catalog_image(url: string) {
    setStep({ kind: "stopped", message: "Fetching the catalog image…" });
    try {
      await choose(await fetch_catalog_image(url));
    } catch (e) {
      setStep({ kind: "stopped", message: (e as Error).message });
    }
  }

  // What would stop these tiles going live once uploaded; checked before any work is done.
  function blocker(plan: Plan): string | null {
    if (!map || !shapes) return null;
    const probe = { ...start_tileset(map.map_id, map.name, pixel_tiles("", plan, "source.jpg"), plan.tileCount, user!), upload_state: "complete" as const };
    return publish_blocker(data!, map, probe);
  }

  async function run(file: File, worker: Worker, plan: Plan) {
    const targetId = map?.map_id ?? info.map_id;
    const targetName = map?.name ?? info.name.trim();
    const resuming = unfinished.find((t) => t.tileset_id === resumeId);
    if (resuming && (resuming.image_width !== String(plan.width) || resuming.image_height !== String(plan.height))) {
      worker.terminate();
      setStep({ kind: "stopped", message: `That upload was of a ${resuming.image_width} × ${resuming.image_height} image; this one is ${plan.width} × ${plan.height}. Choose the same file to resume it, or start a new upload.` });
      return;
    }

    const sourceName = source_name(file);
    let tileset = resuming;
    try {
      if (!tileset) {
        const draft = start_tileset(targetId, targetName, pixel_tiles("", plan, sourceName), plan.tileCount, user!);
        const { base } = await stored_tiles(draft.tileset_id);
        tileset = { ...draft, ...pixel_tiles(base, plan, sourceName) };
        // The row exists before the first tile: if the upload stops, this is the record that it did.
        await save_rows([{ table: "tilesets", rows: [tileset] }]);
      }
    } catch (e) {
      worker.terminate();
      setStep({ kind: "stopped", message: `Could not start: ${(e as Error).message}` });
      return;
    }

    const controller = new AbortController();
    abort.current = controller;
    let row = tileset;
    let recorded = Number(row.uploaded_count) || 0;
    const progress0: Progress = { phase: "reading", made: 0, uploaded: 0, skipped: 0, total: plan.tileCount };
    setStep({ kind: "running", file, plan, progress: progress0, tileset: row });
    let latest = progress0;

    try {
      await upload_tileset({
        file, tilesetId: row.tileset_id, worker, plan, signal: controller.signal,
        onProgress: (p) => {
          latest = p;
          setStep({ kind: "running", file, plan, progress: p, tileset: row });
          const stored = p.uploaded + p.skipped;
          if (stored - recorded >= plan.tileCount * PROGRESS_EVERY) {
            recorded = stored;
            const [w] = tileset_progress(row, stored, user!);
            row = w.rows[0] as TilesetRow;
            save_rows([w]).catch(() => undefined);
          }
        },
      });
      const complete = complete_tileset(row, user!);
      const fresh = await load_dataset(true);
      await save_rows(publish_tileset(fresh, complete, user!, map ? undefined : { ...info, name: info.name.trim(), year: info.year.trim() }));
      setStep({ kind: "published", mapId: targetId, tiles: plan.tileCount });
    } catch (e) {
      const stored = latest.uploaded + latest.skipped;
      const [w] = tileset_progress(row, stored, user!);
      await save_rows([w]).catch(() => undefined);
      const why = controller.signal.aborted ? "You stopped the upload." : (e as Error).message;
      setStep({ kind: "stopped", tileset: w.rows[0] as TilesetRow, message: `${why} ${stored} of ${plan.tileCount} tiles are stored. ${map ? `${map.name} still shows its previous tiles.` : "The map has not been created."} To finish, choose the same file again and resume.` });
      setData(await load_dataset(true).catch(() => data));
      setResumeId(row.tileset_id);
    } finally {
      abort.current = null;
    }
  }

  const title = catalog ? `Tile ${map!.name} to explore` : map ? `New tiles for ${map.name}` : "New map from an image";
  // Tiles are kept, never made twice: a catalog map that has them is explored, not tiled again.
  const tiledAlready = !!catalog && is_tiled(map!);
  const running = step.kind === "running";

  return (
    <main className="page">
      <div className="page-card glass-solid">
        <header className="page-head">
          <a className="icon-button" href={map ? `/?map=${map.map_id}` : "/"} aria-label="Back to the map"><ArrowLeft /></a>
          <h1>{title}</h1>
        </header>

        {!map && (
          <fieldset className="form" disabled={running}>
            <label>Name<input value={info.name} onChange={set("name")} placeholder="Jacopo de'Barbari" />{err("name")}</label>
            <div className="layer-edit-row">
              <label>Id<input value={info.map_id} onChange={set("map_id")} placeholder="debarbari" />{err("map_id")}</label>
              <label className="narrow">Year<input value={info.year} onChange={set("year")} inputMode="numeric" placeholder="1500" />{err("year")}</label>
            </div>
            <label>Group<input value={info.parent} onChange={set("parent")} placeholder="Optional" /></label>
            <label>Description<textarea value={info.description} onChange={set("description")} rows={2} /></label>
            <div className="layer-edit-row">
              <label>Author<input value={info.author} onChange={set("author")} /></label>
              <label>Source<input value={info.source} onChange={set("source")} /></label>
            </div>
            <div className="layer-edit-row">
              <label>Collection<input value={info.collection} onChange={set("collection")} /></label>
              <label>Scale<input value={info.scale} onChange={set("scale")} /></label>
            </div>
          </fieldset>
        )}

        {map && shapes > 0 && (
          <p className="note">{shapes} shapes are drawn on {map.name}. New tiles must be the same image size as the current ones{map.crs === "pixel" ? ` (${map.image_width} × ${map.image_height})` : " — and this map's tiles came from the old site, so an upload cannot match them"}, or the shapes would no longer line up.</p>
        )}

        {unfinished.length > 0 && (
          <fieldset className="form" disabled={running}>
            <label>Unfinished uploads
              <select value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                <option value="">Start a new upload</option>
                {unfinished.map((t) => (
                  <option key={t.tileset_id} value={t.tileset_id}>Resume {t.created_at.slice(0, 16).replace("T", " ")} — {t.uploaded_count || 0} of {t.tile_count} stored, {t.image_width} × {t.image_height}</option>
                ))}
              </select>
            </label>
          </fieldset>
        )}

        {catalog && !tiledAlready && (
          <p className="note">From the catalog. Tiling is for looking at it; it joins the maps list only if you add it afterwards.{catalog.record_url && <> <a href={catalog.record_url} target="_blank" rel="noreferrer">Catalog record</a>.</>}</p>
        )}
        {tiledAlready && <p className="note">{map!.name} is tiled already. Tiles are kept and never made twice. <a href={`/?map=${map!.map_id}`}>Explore it</a>, and add it to the maps list from there if it is worth keeping.</p>}
        {catalog && !tiledAlready && catalog.image_url && (
          <button type="button" disabled={running || step.kind === "planned"} onClick={() => use_catalog_image(catalog.image_url)}><ImageUp /> Use the catalog image</button>
        )}

        {!tiledAlready && <label className={`drop ${running ? "disabled" : ""}`}>
          <ImageUp />
          <span>{step.kind === "planned" || step.kind === "running" ? step.file.name : "Choose an image — JPEG, PNG, TIFF or WebP"}</span>
          <input type="file" accept="image/jpeg,image/png,image/tiff,image/webp" disabled={running} onChange={(e) => choose(e.target.files?.[0])} />
        </label>}

        {step.kind === "planned" && (
          <PlanSummary plan={step.plan} />
        )}
        {step.kind === "planned" && blocker(step.plan) && <p className="error" role="alert">{blocker(step.plan)}</p>}

        {step.kind === "running" && <ProgressBar progress={step.progress} />}

        {step.kind === "stopped" && <p className={step.message.endsWith("…") ? "note" : "error"} role="status">{step.message}</p>}

        {step.kind === "published" && (
          <p className="success" role="status"><Check /> <span>All {step.tiles} tiles are stored and the map shows them. <a href={`/?map=${step.mapId}`}>Open the map</a>{catalog && " to look at it, and add it to the maps list from its Maps panel if it is worth keeping."}</span></p>
        )}

        <footer className="page-foot">
          {running ? (
            <button type="button" onClick={() => abort.current?.abort()}><X /> Stop</button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={tiledAlready || step.kind !== "planned" || !!blocker(step.plan)}
              onClick={() => {
                setTried(true);
                if (step.kind === "planned" && (map || Object.keys(errors).length === 0)) run(step.file, step.worker, step.plan);
              }}
            >
              {resumeId ? <><RotateCcw /> Resume upload</> : "Tile and upload"}
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}

function PlanSummary({ plan }: { plan: Plan }) {
  return (
    <dl className="plan">
      <div><dt>Image</dt><dd>{plan.width.toLocaleString()} × {plan.height.toLocaleString()} px</dd></div>
      <div><dt>Zoom levels</dt><dd>0–{plan.maxZoom}</dd></div>
      <div><dt>Tiles</dt><dd>{plan.tileCount.toLocaleString()}</dd></div>
    </dl>
  );
}

function ProgressBar({ progress: p }: { progress: Progress }) {
  const stored = p.uploaded + p.skipped;
  const label = p.phase === "reading" ? "Storing the original image…" : p.phase === "verifying" ? "Checking every tile arrived…" : `Tiling and uploading — ${stored.toLocaleString()} of ${p.total.toLocaleString()} stored${p.skipped ? ` (${p.skipped.toLocaleString()} were already there)` : ""}`;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={stored} aria-label={label}>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${(stored / Math.max(1, p.total)) * 100}%` }} /></div>
      <span className="note">{label}</span>
    </div>
  );
}
