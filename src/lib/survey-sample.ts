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

const FETCH_TIMEOUT_MS = 60_000;

/**
 * How much of the ranking we are willing to pull.
 *
 * The file is a million lines and roughly 25 MB. Buffering all of it to
 * find three hundred .fr domains was the wrong shape twice over: it is
 * most of a minute of somebody else's bandwidth, and it put the whole
 * download inside one timeout, so a slow minute produced no sample and —
 * until this run started saying so — no sound either.
 *
 * Read as a stream instead, stopping at whichever comes first: enough
 * domains, this many bytes, or the end of the file. The ranking is
 * ordered, so the .fr domains we want are near the top by construction.
 */
const MAX_BYTES = 12 * 1024 * 1024;

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

  const entries: SampleEntry[] = [];

  try {
    await readLines(response, MAX_BYTES, (raw) => {
      // `rank,domain`
      const comma = raw.indexOf(',');
      if (comma === -1) return true;

      const rank = Number(raw.slice(0, comma).trim());
      const domain = raw.slice(comma + 1).trim().toLowerCase();
      if (!Number.isFinite(rank) || !domain.endsWith('.fr')) return true;
      // A bare registrable name. Anything with a path, a port or a label
      // that is not a hostname is not something to point a crawler at.
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
        return true;
      }

      entries.push({ domain, rank });
      // Stop the download the moment we have enough.
      return entries.length < limit;
    });
  } catch (err) {
    // A partial read is still a sample, and a partial sample is not one:
    // the study claims ranks 1 to N of a named list.
    if (entries.length < limit) {
      return empty(
        `the ranking stopped after ${entries.length} of ${limit} .fr domains: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (entries.length < limit) {
    return empty(
      `the ranking yielded ${entries.length} .fr domains, fewer than the ${limit} the sample is defined as`
    );
  }

  return {
    entries,
    sourceId,
    // The list is published daily and identified by id; the date we can
    // state honestly is the day we fetched it.
    sourceDate: new Date().toISOString().slice(0, 10),
    refused: null
  };
}

/**
 * Walk a response line by line and stop when the caller says so.
 *
 * `onLine` returns false to end the read, which cancels the download
 * rather than politely continuing to receive twenty more megabytes we
 * have already decided not to look at.
 */
async function readLines(
  response: Response,
  maxBytes: number,
  onLine: (line: string) => boolean
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('the ranking returned no body');

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let seen = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      seen += value.byteLength;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!onLine(line)) return;
        newline = buffer.indexOf('\n');
      }

      if (seen > maxBytes) {
        throw new Error(`stopped after ${Math.round(seen / 1_048_576)}MB without finding enough`);
      }
    }

    if (buffer.length > 0) onLine(buffer);
  } finally {
    // Cancel rather than leave the socket draining a file we are done with.
    await reader.cancel().catch(() => {});
  }
}
