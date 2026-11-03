import type { ItemRow, MapRow } from "./rows";

// Ported from main.js buildSearchMatches: substring hit scores 1, otherwise Levenshtein similarity,
// kept at >= 0.8, best 12. Values are the old viewer's, so search finds what it found.
const MATCH_THRESHOLD = 0.8;
const RESULTS_LIMIT = 12;

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, up, prev[j - 1]);
      diag = up;
    }
  }
  return prev[b.length];
}

function match_score(term: string, target: string): number {
  if (!term || !target) return 0;
  if (target.includes(term)) return 1;
  return 1 - levenshtein(term, target) / Math.max(term.length, target.length);
}

export type SearchHit = { item: ItemRow; score: number; maps: MapRow[] };

export function search_items(term: string, items: ItemRow[], mapsById: Map<string, MapRow>): SearchHit[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    if (item.status !== "active") continue;
    const score = Math.max(match_score(t, item.name.toLowerCase()), match_score(t, item.code.toLowerCase()));
    if (score < MATCH_THRESHOLD) continue;
    const maps = item.map_ids.split("|").map((id) => mapsById.get(id)).filter((m): m is MapRow => !!m);
    hits.push({ item, score, maps });
  }
  hits.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return hits.slice(0, RESULTS_LIMIT);
}
