import 'server-only';
import { supabaseService } from './supabase';

/**
 * Who links to us, counted without tracking anybody.
 *
 * The question the observatory has to answer within sixty days is
 * narrow: did a domain we do not control put a link to it somewhere. The
 * honest instrument is the Referer header — the browser volunteers which
 * page it came from — and the honest way to use it is to keep the
 * hostname and throw everything else away.
 *
 * WHAT IS THROWN AWAY, AND WHY AT THE DOOR
 *
 * The path and the query string. A referring URL routinely carries
 * personal data in its query: a search term, a session id, an e-mail
 * address in a badly built newsletter link. Discarding them here rather
 * than sanitising them later means the personal data never reaches our
 * database in the first place, which is the difference between
 * minimisation and cleanup.
 *
 * No IP, no cookie, no user agent, no per-visit timestamp. What remains
 * is "lemonde.fr sent people to /observatory, 14 times". It cannot
 * identify a person, it stores nothing on the visitor's device, and it
 * therefore needs no banner — which is the whole point. The rule in this
 * project is that we do not put a measurement cookie on our own visitors
 * for our own marketing, and this is what obeying it looks like while
 * still being able to count.
 *
 * WHAT IT CANNOT TELL US
 *
 * A link nobody clicks. That link still counts for search ranking and
 * will never appear here, so this instrument answers "did anyone come
 * from somewhere" and not "does a link exist". Search Console answers
 * the second. Reporting this number as if it were that one would be the
 * kind of confident wrong measurement this codebase keeps removing.
 */

/** Referrers we do not count: ourselves. */
function isOurs(host: string): boolean {
  return host === 'lexyflow.com' || host.endsWith('.lexyflow.com') || host === 'localhost';
}

/**
 * Record one arrival. Never throws, never blocks the response.
 *
 * A failure to count is not a failure to serve: the page is the product
 * and the counter is our curiosity about it.
 */
export async function recordReferral(referer: string | null, path: string): Promise<void> {
  if (!referer) return;

  let host: string;
  try {
    const url = new URL(referer);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return;
    host = url.hostname.toLowerCase();
  } catch {
    // A Referer that is not a URL tells us nothing and is not worth a row.
    return;
  }

  if (!host || isOurs(host)) return;

  try {
    const { error } = await supabaseService().rpc('record_referral', {
      p_host: host,
      // Our own path, which we control and which contains no query.
      p_path: path
    });
    if (error) console.error('[referrals] write_failed', { error: error.message });
  } catch (err) {
    console.error('[referrals] write_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export interface Referral {
  host: string;
  path: string;
  hits: number;
  firstSeen: string;
  lastSeen: string;
}

/** Null means we could not read them — never an empty list. */
export async function listReferrals(): Promise<Referral[] | null> {
  try {
    const { data, error } = await supabaseService()
      .from('referrals')
      .select('host, path, hits, first_seen, last_seen')
      .order('hits', { ascending: false })
      .limit(200);

    if (error) {
      console.error('[referrals] read_failed', { error: error.message });
      return null;
    }

    return ((data ?? []) as Record<string, string | number>[]).map((row) => ({
      host: String(row.host),
      path: String(row.path),
      hits: Number(row.hits),
      firstSeen: String(row.first_seen),
      lastSeen: String(row.last_seen)
    }));
  } catch (err) {
    console.error('[referrals] read_threw', {
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}
