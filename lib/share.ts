// Deep links. New links: ?map=&layers=a|b&item=<id>. Old links (?layer=, ?feature=<name>) still open.

import type { ItemRow } from "./rows";

export type ViewState = { mapId?: string; layerIds: string[]; itemId?: string };

export function read_view_from_url(search: string, items: ItemRow[]): ViewState {
  const q = new URLSearchParams(search);
  const layerParam = q.get("layers") ?? q.get("layer") ?? "";
  const layerIds = [...new Set(layerParam.split("|").map((s) => s.trim()).filter(Boolean))];
  let itemId = q.get("item") ?? undefined;
  const legacyName = q.get("feature");
  if (!itemId && legacyName) {
    // Names repeat (58 name+layer pairs), so the old name links open the first match, as they did.
    itemId = items.find((i) => i.status === "active" && i.name === legacyName)?.item_id;
  }
  return { mapId: q.get("map") ?? undefined, layerIds, itemId };
}

export function build_share_url(origin: string, view: ViewState): string {
  const q = new URLSearchParams();
  if (view.mapId) q.set("map", view.mapId);
  if (view.layerIds.length) q.set("layers", view.layerIds.join("|"));
  if (view.itemId) q.set("item", view.itemId);
  const s = q.toString().replace(/%7C/gi, "|");
  return s ? `${origin}/?${s}` : `${origin}/`;
}
