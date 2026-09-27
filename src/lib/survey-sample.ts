import 'server-only';
import { fetchExternal } from './safe-fetch';

/**
 * Where the observatory's sample comes from.
 *
 * "The most visited French sites" is a claim. "The .fr domains in Tranco
 * list <id> of <date>, ranks 1 to N" is a statement anybody can reproduce
 * and contest — which is the only kind worth publishing, and the only
 * kind that earns a citation.
 *
 * WHY TRANCO AND NOT A LIST WE WROTE
 *
 * A sample we assembled is a sample we chose, and a sample we chose is one
 * we chose to flatter the result. Tranco is free, academic, and published
 * with a permanent identifier per list precisely because the commercial
 * top-site rankings are unstable and uncitable. Its id and date go into
 * the methodology, and a reader who disagrees with the population can
 * fetch the same file.
 *
 * WHAT COMES BACK IS CANDIDATES, NOT RESULTS
 *
 * A domain in this list is a domain we intend to look at. Whether we
 * could read anything is decided later, by the same pipeline the public
 * scan uses, and the refusals are part of the published figures rather
 * than quietly dropped from the denominator.
 */

/**
 * The daily list, by permanent id. `/top-1m.csv.zip` is the archive; the
 * plain CSV endpoint is what we want and it redirects to the current list.
 */
const TRANCO_LATEST = 'https://tranco-list.eu/top-1m.csv';

const FETCH_TIMEOUT_MS = 30_000;

/** Enough of the ranking to find several hundred .fr domains in it. */
const MAX_LINES = 400_000;

export interface SampleEntry {
  domain: string;
  /** Rank in the source list, not in our filtered subset. */
  rank: number;
}

export interface Sample {
  entries: SampleEntry[];
  /** The list's permanent identifier, for the methodology. */
  sourceId: string;
  sourceDate: string;
  /** Populated instead of entries when we could not build a sample. */
  refused: string | null;
}

/**
 * Pull the ranking and keep the French ones.
 *
 * `.fr` rather than "French sites": a registry suffix is a fact, and
 * "French" would mean deciding that a .com belongs to France, which is a
 * judgement we would have to defend in the methodology and could not.
 * The study says `.fr` and means it — including that it therefore misses
 * French companies on .com, which is a limitation the page states rather
 * than hides.
 */
export async function fetchFrenchSample(limit: number): Promise<Sample> {
  const empty = (refused: string): Sample => ({
    entries: [],
    sourceId: '',
    sourceDate: '',
    refused
  });

  let response: Response;
  try {
    response = await fetchExternal(TRANCO_LATEST, {
      headers: { 'user-agent': 'LexyFlowObservatory/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
  } catch (err) {
    return empty(`could not fetch the ranking: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) return empty(`the ranking answered HTTP ${response.status}`);

  // Tranco redirects /top-1m.csv to /download/<id>/1000000, so the final
  // URL carries the permanent identifier. Without it the sample is
  // unreproducible, and an unreproducible sample is not publishable.
  const sourceId = /\/download\/([A-Za-z0-9]+)\//.exec(response.url)?.[1] ?? '';
  if (!sourceId) {
    return empty(`the ranking did not identify itself (resolved to ${response.url || TRANCO_LATEST})`);
  }

  const text = await response.text();
  const entries: SampleEntry[] = [];
  let line = 0;

  for (const raw of text.split('\n')) {
    if (line++ > MAX_LINES || entries.length >= limit) break;

    // `rank,domain`
    const comma = raw.indexOf(',');
    if (comma === -1) continue;

    const rank = Number(raw.slice(0, comma).trim());
    const domain = raw.slice(comma + 1).trim().toLowerCase();
    if (!Number.isFinite(rank) || !domain.endsWith('.fr')) continue;
    // A bare registrable name. Anything with a path, a port or a label
    // that is not a hostname is not something to point a crawler at.
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) continue;

    entries.push({ domain, rank });
  }

  if (entries.length === 0) return empty('the ranking contained no usable .fr domains');

  return {
    entries,
    sourceId,
    // The list is published daily and identified by id; the date we can
    // state honestly is the day we fetched it.
    sourceDate: new Date().toISOString().slice(0, 10),
    refused: null
  };
}
