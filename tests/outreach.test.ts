import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The automated outreach machine, and the measurement errors it must not
 * repeat.
 *
 * This company has already been misled once by its own numbers: 345
 * signups, 46 "confirmed", all 46 "signed in" — and four organisations,
 * three of them named Test. The confirmations were corporate mail scanners
 * following links, and months of decisions rested on them.
 *
 * A cold-email funnel is the same trap with a bigger budget, so the rules
 * are asserted here rather than left to whoever reads the dashboard.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/**
 * The same file with its comments removed.
 *
 * Three assertions below first failed against the prose that explains why
 * we do NOT do a thing — "no open-tracking pixel", "unlike waitUntil", "no
 * preferences centre" — and reported the explanation as the offence. A
 * test that greps a file cannot tell an intention from its opposite unless
 * the intentions are stripped out first, and the whole value of these
 * assertions is that they read what the code does.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('what the funnel refuses to measure', () => {
  const click = read('src/app/api/r/[token]/route.ts');
  const dashboard = read('src/app/[locale]/admin/growth/page.tsx');

  it('records no opens at all', () => {
    const clickCode = code('src/app/api/r/[token]/route.ts');
    const dashboardCode = code('src/app/[locale]/admin/growth/page.tsx');
    // Apple Mail Privacy Protection fetches every image in every message
    // before the human sees it. An open rate from a pixel measures how
    // many recipients use Apple Mail — the same machine behaviour that
    // burned our magic links. Not recorded wrongly; not recorded.
    for (const source of [clickCode, dashboardCode]) {
      expect(source).not.toMatch(/pixel|\bopen(ed|_rate)?\b/i);
    }
  });

  it('counts distinct people, not events', () => {
    // One recipient whose scanner follows a link four times is one
    // person. Reporting four is how 46 confirmations became 42 sessions
    // used for nothing.
    expect(dashboard).toContain('Set<string>');
    expect(dashboard).toContain('people.size');
    expect(dashboard).toContain('personnes distinctes');
  });

  it('computes every rate against people contacted, not the step above', () => {
    // A chain of percentages each taken on the previous stage flatters
    // everything after the first.
    expect(dashboard).toContain('n / contacted');
  });

  it('names one number as the answer and says what the others are for', () => {
    expect(dashboard).toContain('audit_completed');
    expect(dashboard).toContain('des contactés');
    // Thresholds written into the page before the data arrives, so a
    // disappointing number cannot be reinterpreted later.
    expect(dashboard).toMatch(/contacted < 200/);
  });
});

describe('the link in the message', () => {
  const click = read('src/app/api/r/[token]/route.ts');

  it('never puts the recipient in the URL', () => {
    // `?e=<base64 email>` is the industry default and hands the address to
    // every proxy, log and chat window the link passes through.
    expect(click).not.toMatch(/searchParams\.get\(['"]e(mail)?['"]\)/);
    expect(click).toContain('opaque row identifier');
  });

  it('redirects even when the measurement fails', () => {
    // A person who clicked in good faith must not meet an error because
    // our analytics did. The response is built before anything is
    // recorded, and the recording is deferred.
    const bodyOrder = click.indexOf('NextResponse.redirect') < click.indexOf('waitUntil(record');
    expect(bodyOrder).toBe(true);
  });

  it('keeps the token out of the destination page’s referrer', () => {
    expect(click).toContain("'Referrer-Policy', 'no-referrer'");
  });

  it('only sends visitors to our own pages', () => {
    // An open redirect on a domain that sends email is a phishing kit.
    expect(click).toContain('DESTINATIONS');
    expect(click).toContain('appUrl()');
  });
});

describe('opposition', () => {
  const unsub = read('src/app/api/outreach/unsubscribe/[token]/route.ts');
  const page = read('src/app/[locale]/unsubscribed/page.tsx');

  it('supports one-click unsubscribe, which is now a condition of delivery', () => {
    // RFC 8058. Since 2024 Google and Yahoo require it from bulk senders,
    // so this is not a courtesy — without it the mail does not arrive.
    expect(unsub).toContain('export async function POST');
    expect(unsub).toContain('RFC 8058');
  });

  it('writes the opt-out synchronously, unlike every other event here', () => {
    // Telemetry may be deferred; a person's decision may not. A decision
    // that lands "usually" is a decision we did not honour.
    expect(code('src/app/api/outreach/unsubscribe/[token]/route.ts')).not.toContain('waitUntil');
    expect(unsub).toContain('await optOut');
  });

  it('offers no way back', () => {
    // No "was this a mistake?", no preferences centre, no reduced
    // frequency. A company that audits other people's consent mechanisms
    // cannot ship a retention pattern on its own unsubscribe page.
    expect(code('src/app/[locale]/unsubscribed/page.tsx')).not.toMatch(
      /mistake|resubscribe|préférences|fréquence|réabonner/i
    );
  });
});

describe('attribution', () => {
  const lib = read('src/lib/outreach.ts');
  const audit = read('src/app/api/audit/route.ts');

  it('uses no cookie', () => {
    // A tracking cookie would need a banner, on a site that sells GDPR
    // audits, to measure our own marketing.
    expect(lib).not.toContain('cookies');
    expect(lib).toContain('WHY THE TOKEN AND NOT A COOKIE');
  });

  it('never lets bookkeeping break an audit', () => {
    expect(lib).toContain('console.warn');
    expect(lib).toContain('catch');
  });

  it('counts a conversion only once the audit row is closed', () => {
    const closed = audit.indexOf("status: 'completed'");
    const counted = audit.indexOf("recordOutreachEvent(input.outreachRef, 'audit_completed')");
    expect(counted).toBeGreaterThan(closed);
    expect(audit).toContain('if (!closeErr)');
  });

  it('validates the token shape before it reaches the database', () => {
    expect(lib).toMatch(/\[A-Za-z0-9_-\]\{16,64\}/);
  });
});
