import 'server-only';
import { fetchExternal } from './safe-fetch';

/**
 * Where the observatory's sample comes from.
 *
 * "The most visited French sites" is a claim. "The .fr domains in <named
 * list> of <date>, ranks 1 to N" is a statement anybody can reproduce and
 * contest — which is the only kind worth publishing, and the only kind
 * that earns a citation.
 *
 * WHY THE SOURCE IS A LIST OF CANDIDATES AND NOT A CONSTANT
 *
 * It was a constant, pointing at tranco-list.eu/top-1m.csv, and that URL
 * answers 404. Eight runs recorded the same sentence before anybody
 * looked, and the fix I shipped first — streaming the download instead of
 * buffering 25 MB — was a real improvement to a thing that was not the
 * bug. I had guessed the timeout, written "the likely cause" in a commit
 * message, and been wrong.
 *
 * This sandbox cannot reach any of these hosts, so a second guess would
 * be worth exactly as much as the first. Instead the seeding tries each
 * candidate in turn and records which one answered, the same shape as the
 * legal watcher's probe: the machine finds out, and the methodology then
 * states what it actually used rather than what we assumed it would.
 *
 * THE BASIS TRAVELS WITH THE SOURCE
 *
 * These rankings do not measure the same thing. Tranco aggregates traffic
 * rankings; Majestic ranks by referring subnets. A study whose population
 * came from the second must not say "most visited", so the label carries
 * the basis and the page prints the label it was given.
 */

export interface RankingSource {
  id: string;
  url: string;
  /** Printed in the methodology, in French, basis included. */
  label: string;
  /** Column index of the domain in each CSV row. */
  domainColumn: number;
}

const SOURCES: RankingSource[] = [
  {
    id: 'tranco',
    url: 'https://tranco-list.eu/top-1m.csv',
    label: 'la liste Tranco (agrégat de classements de trafic)',
    domainColumn: 1
  },
  {
    id: 'tranco-download',
    url: 'https://tranco-list.eu/download/latest/1000000',
    label: 'la liste Tranco (agrégat de classements de trafic)',
    domainColumn: 1
  },
  {
    id: 'majestic',
    url: 'https://downloads.majestic.com/majestic_million.csv',
    label: 'le Majestic Million (classement par sous-réseaux référents)',
    // GlobalRank,TldRank,Domain,...
    domainColumn: 2
  }
];

const FETCH_TIMEOUT_MS = 60_000;

/**
 * How much of a ranking we are willing to pull.
 *
 * These files are a million lines and tens of megabytes. Read as a
 * stream, stopping at whichever comes first: enough domains, this many
 * bytes, or the end of the file. The list is ordered, so the .fr domains
 * we want are near the top by construction.
 */
const MAX_BYTES = 12 * 1024 * 1024;

export interface SampleEntry {
  domain: string;
  /** Rank in the source list, not in our filtered subset. */
  rank: number;
}

export interface Sample {
  entries: SampleEntry[];
  /** Which ranking answered, and how it is described on the page. */
  sourceId: string;
  sourceLabel: string;
  sourceDate: string;
  /** Populated instead of entries when no ranking could be used. */
  refused: string | null;
}

/**
 * Pull a ranking and keep the French ones.
 *
 * `.fr` rather than "French sites": a registry suffix is a fact, and
 * "French" would mean deciding that a .com belongs to France, which is a
 * judgement we would have to defend in the methodology and could not.
 * The study says `.fr` and means it — including that it therefore misses
 * French companies on .com, which the page states rather than hides.
 */
export async function fetchFrenchSample(limit: number): Promise<Sample> {
  const refusals: string[] = [];

  for (const source of SOURCES) {
    const attempt = await trySource(source, limit);
    if (attempt.refused === null) return attempt;
    refusals.push(`${source.id}: ${attempt.refused}`);
  }

  return {
    entries: [],
    sourceId: '',
    sourceLabel: '',
    sourceDate: '',
    // Every candidate and its own answer, so the next repair is informed
    // rather than another guess.
    refused: `no ranking could be used — ${refusals.join(' | ')}`
  };
}

async function trySource(source: RankingSource, limit: number): Promise<Sample> {
  const empty = (refused: string): Sample => ({
    entries: [],
    sourceId: '',
    sourceLabel: '',
    sourceDate: '',
    refused
  });

  let response: Response;
  try {
    response = await fetchExternal(source.url, {
      headers: { 'user-agent': 'LexyFlowObservatory/1.0 (+https://lexyflow.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store'
    });
  } catch (err) {
    return empty(`could not fetch: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!response.ok) return empty(`answered HTTP ${response.status}`);

  // The identifier that makes the sample reproducible. Tranco redirects
  // to /download/<id>/..., which carries one; a list served from a fixed
  // URL identifies itself by the day we fetched it, which is weaker but
  // still checkable against the publisher's own archive.
  const fromUrl = /\/download\/([A-Za-z0-9]+)\//.exec(response.url ?? '')?.[1];
  const today = new Date().toISOString().slice(0, 10);

  const entries: SampleEntry[] = [];

  try {
    await readLines(response, MAX_BYTES, (raw) => {
      const cells = raw.split(',');
      if (cells.length <= source.domainColumn) return true;

      const rank = Number(cells[0]!.trim());
      const domain = cells[source.domainColumn]!.trim().toLowerCase();
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
    if (entries.length < limit) {
      return empty(
        `stopped after ${entries.length} of ${limit} .fr domains: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  if (entries.length < limit) {
    return empty(`yielded ${entries.length} .fr domains, fewer than the ${limit} required`);
  }

  return {
    entries,
    sourceId: fromUrl ?? `${source.id}-${today}`,
    sourceLabel: source.label,
    sourceDate: today,
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
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!onLine(line)) return;
        newline = buffer.indexOf('\n');
      }

      if (seen > maxBytes) {
        throw new Error(`stopped after ${Math.round(seen / 1_048_576)}MB without finding enough`);
      }
    }

    if (buffer.length > 0) onLine(buffer.replace(/\r$/, ''));
  } finally {
    // Cancel rather than leave the socket draining a file we are done with.
    await reader.cancel().catch(() => {});
  }
}
