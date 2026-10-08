import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serviceClient: SupabaseClient | null = null;

/**
 * Every database read goes through fetch, and Next.js caches fetch.
 *
 * This is not a theory about the observatory. It is what the probes
 * returned, in one request, on one client, microseconds apart:
 *
 *   select('*').limit(1)                      → 1 row
 *   select('domain').limit(5)                 → 5 rows
 *   count: 'planned'                          → 300
 *   select('source_id,…').order('rank')       → 0 rows, HTTP 200
 *   count: 'exact'                            → 0
 *
 * The table reads perfectly. What fails is exactly the two query shapes
 * the application issues on every render — and what succeeds is three
 * shapes nothing had ever issued before. A read is not supposed to
 * depend on whether anyone has made it before.
 *
 * supabase-js calls `fetch`, and in the App Router `fetch` is patched
 * with a Data Cache keyed on URL and options. A GET issued during a
 * build, when this table was still empty, is a cached empty answer that
 * every later request inherits — while a URL nobody had requested is a
 * cache miss and reads the database. That is the shape of what the
 * probes measured, and it explains why the figures went stale on 1
 * October and never recovered.
 *
 * SO THIS IS NOT AN OBSERVATORY BUG
 *
 * It is every server-side read in the product: audits, the review queue,
 * subscriptions, credits. Any one of them could have been answering from
 * a response captured at build time. The published study is simply where
 * it became visible, because the study is the one surface that prints
 * its own denominator.
 *
 * `cache: 'no-store'` on the client's fetch opts the whole thing out.
 * There is no read in this application where a stale answer is
 * preferable to a round trip — we sell the claim that a number came from
 * the database it says it came from.
 */
function uncachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: 'no-store' });
}

export function supabaseService(): SupabaseClient {
  if (!serviceClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase service credentials missing');
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: uncachedFetch }
    });
  }
  return serviceClient;
}
