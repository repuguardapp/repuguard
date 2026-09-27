import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * We measure our own marketing with our own logs, or not at all.
 *
 * The rule in this project is that there is no measurement cookie on our
 * own visitors for our own marketing, and no third party in the path of
 * their data. Counting referrers is the version of that which still
 * answers the question the observatory has sixty days to settle: did a
 * domain we do not control send anyone here.
 */

const LIB = readFileSync(join(__dirname, '..', 'src', 'lib', 'referrals.ts'), 'utf8');
const SQL = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '0041_referrals.sql'),
  'utf8'
);

describe('what is stored', () => {
  it('keeps the hostname and nothing else from the referrer', () => {
    // A referring URL routinely carries personal data in its query: a
    // search term, a session id, an address in a badly built newsletter
    // link. Discarding it here rather than sanitising it later means the
    // personal data never reaches the database at all.
    expect(LIB).toContain('url.hostname.toLowerCase()');
    expect(LIB).not.toContain('url.pathname');
    expect(LIB).not.toContain('url.search');
  });

  it('stores the path we control, not the one we were sent from', () => {
    // p_path is our own route, passed by the caller as a literal.
    expect(LIB).toContain('p_path: path');
  });

  it('stores no identifier of any kind', () => {
    const forbidden = ['ip', 'cookie', 'user-agent', 'userAgent', 'session', 'fingerprint'];
    for (const term of forbidden) {
      expect(LIB.toLowerCase()).not.toContain(`${term}:`);
    }
    expect(SQL.toLowerCase()).not.toContain('ip_address');
    expect(SQL.toLowerCase()).not.toContain('user_agent');
  });
});

describe('what it refuses to count', () => {
  it('ignores our own pages', () => {
    // Otherwise every internal click inflates the number the sixty-day
    // decision rests on.
    expect(LIB).toContain("host === 'lexyflow.com'");
    expect(LIB).toContain("host.endsWith('.lexyflow.com')");
  });

  it('ignores a referrer that is not an http URL', () => {
    expect(LIB).toContain("url.protocol !== 'https:' && url.protocol !== 'http:'");
  });

  it('ignores an absent referrer rather than inventing a bucket for it', () => {
    // "direct" is not a source. Counting it would create a number that
    // grows with our own traffic and says nothing about links.
    expect(LIB).toContain('if (!referer) return;');
    expect(LIB).not.toContain("'direct'");
  });
});

describe('it never costs the visitor anything', () => {
  it('swallows its own failures', () => {
    // The page is the product; the counter is our curiosity about it.
    expect(LIB).toContain('[referrals] write_threw');
    expect(LIB).toContain('[referrals] write_failed');
  });

  it('increments atomically rather than read-modify-write', () => {
    expect(SQL).toContain('on conflict (host, path) do update');
    expect(SQL).toContain('hits = referrals.hits + 1');
  });
});

describe('it does not overstate what it knows', () => {
  it('records the blind spot in the module itself', () => {
    // A link nobody clicks still counts for search ranking and will never
    // appear here. Reporting this as "backlinks" would be exactly the
    // confident wrong measurement this codebase keeps removing.
    expect(LIB).toContain('A link nobody clicks');
    expect(LIB).toContain('Search Console answers');
  });

  it('distinguishes an unreadable table from an absence of links', () => {
    expect(LIB).toContain('): Promise<Referral[] | null>');
  });
});
