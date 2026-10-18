import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One client, one guarantee — and the guarantee is not optional.
 *
 * Next 14 caches `fetch` GET requests by default, keyed on URL and
 * options. Every server-side read in this application went through that
 * cache until `supabaseService()` was given `cache: 'no-store'`, and the
 * symptom was a published CSV reporting a population of zero under a
 * crawl of 280 domains.
 *
 * That fix went into one place while two more copies of the client
 * existed, built inline with no override:
 *
 *   api/cron/purge          decides which accounts are unconfirmed past
 *                           the cutoff, from a GET, and then DELETES
 *                           them. A snapshot taken before a user
 *                           confirmed reads as unconfirmed.
 *
 *   api/email/optout/[token] resolves an objection token to an address,
 *                           from a GET. A stale list records the
 *                           objection against the wrong address, in the
 *                           one route whose rule is that an objection is
 *                           honoured immediately and definitively.
 *
 * Neither was a stale number on a dashboard. Both were irreversible acts
 * taken on possibly stale reads.
 */

const ROOT = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

const FILES = walk(ROOT);

/** The one module allowed to build a service-role client. */
const OWNER = join(ROOT, 'lib', 'supabase.ts');

describe('the no-store guarantee cannot be bypassed by a second client', () => {
  it('builds a service-role client in exactly one module', () => {
    const offenders = FILES.filter((f) => {
      if (f === OWNER) return false;
      const src = readFileSync(f, 'utf8');
      // The service role key is the tell: an anon/cookie client is a
      // different thing and is allowed to exist elsewhere.
      return src.includes('SUPABASE_SERVICE_ROLE_KEY') && /createClient\(/.test(src);
    });
    expect(offenders.map((f) => f.slice(ROOT.length + 1))).toEqual([]);
  });

  it('keeps the override on the one client that is allowed', () => {
    const src = readFileSync(OWNER, 'utf8');
    expect(src).toContain("cache: 'no-store'");
    expect(src).toContain('global: { fetch: uncachedFetch }');
  });

  it('routes the two irreversible callers through it', () => {
    for (const path of ['app/api/cron/purge/route.ts', 'app/api/email/optout/[token]/route.ts']) {
      const src = readFileSync(join(ROOT, path), 'utf8');
      expect(src).toContain('supabaseService()');
      expect(src).not.toContain("from '@supabase/supabase-js'");
    }
  });
});
