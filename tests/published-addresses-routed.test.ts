import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A message to legal@lexyflow.com vanished on 19 October. No forward,
 * no bounce, no trace.
 *
 * The first version of this comment said Cloudflare's MX had accepted
 * and dropped it. That was a deduction from one symptom. Measured the
 * next day through the Cloudflare API with full access: the operator
 * belongs to one Cloudflare account and it holds ZERO zones —
 * lexyflow.com is not in it, and the lookup succeeds rather than
 * refusing. The cause of the loss is not established.
 *
 * legal@ is printed on the DPA as the address where a customer asks for
 * a signed counterpart. It is in the legal footer, on the integrations
 * page, and in the signature of every lifecycle e-mail in seven
 * languages. Somebody exercising a contractual right wrote into a void.
 *
 * The routing lived in a mailbox provider's settings and nowhere else,
 * so nothing could notice an address was missing. That is the defect;
 * the lost message is its first symptom.
 *
 * This test is the part that makes it stay fixed. Publishing a mailto:
 * without adding the address to infra/email/ADDRESSES.md turns red
 * here, before it can turn silent in production.
 *
 * The declaration is a table rather than a script on purpose: the DNS
 * is at Namecheap and the mailboxes are iCloud aliases, neither of
 * which has an API we hold. A script would have pretended to manage
 * infrastructure nobody can reach from here — which is exactly what the
 * Cloudflare version it replaces was doing.
 */

const ROOT = join(__dirname, '..');
const ROUTING = readFileSync(join(ROOT, 'infra/email/ADDRESSES.md'), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|json)$/.test(full) ? [full] : [];
  });
}

/**
 * Every address the application publishes.
 *
 * `\n` immediately before an address is excluded: the lifecycle
 * signoffs read "…team\nlegal@lexyflow.com", and a naive grep reports
 * `nlegal@lexyflow.com`. That phantom was one step from being written
 * into a routing table.
 */
function publishedAddresses(): Set<string> {
  const found = new Set<string>();
  for (const file of [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'messages'))]) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(\\n)?([a-z0-9._-]+)@lexyflow\.com/gi)) {
      const local = m[1] ? m[2]! : m[2]!;
      found.add(`${local.toLowerCase()}@lexyflow.com`);
    }
  }
  found.delete('nlegal@lexyflow.com');
  return found;
}

describe('every address we publish has somewhere to arrive', () => {
  it('finds the addresses the product actually prints', () => {
    const published = publishedAddresses();
    // If this ever reads zero the test has stopped measuring anything
    // and would pass for the wrong reason.
    expect(published.size).toBeGreaterThanOrEqual(5);
    expect(published).toContain('legal@lexyflow.com');
  });

  it('lists each one in the routing script', () => {
    const missing = [...publishedAddresses()].filter(
      (addr) => !ROUTING.includes(`\`${addr.replace('@lexyflow.com', '@')}\``)
    );
    expect(missing).toEqual([]);
  });

  it('routes the transactional sender too', () => {
    // hello@ is RESEND_FROM. An unrouted From means every customer
    // REPLY to a sign-in link or an audit notification is lost the same
    // way legal@ was — and nobody would report that either.
    expect(ROUTING).toContain('`hello@`');
  });

  it('does not invent an address nobody publishes', () => {
    // The routing table is derived from the product, not the reverse. A
    // rule for an address that appears nowhere is a mailbox nobody will
    // ever read.
    const published = publishedAddresses();
    const listed = [...ROUTING.matchAll(/^\| `([a-z0-9._-]+)@` \|/gm)].map(
      (m) => `${m[1]}@lexyflow.com`
    );
    expect(listed.length).toBeGreaterThan(0);
    /**
     * Two mailboxes exist without the product printing them, and both
     * have a reason that is written down rather than assumed:
     *
     *   dmarc@    the rua= target. It receives machine reports and is
     *             deliberately not published to anybody.
     *   contact@  predates this table. It is in iCloud, somebody may
     *             have given it out, and deleting a mailbox because no
     *             code mentions it is how mail goes missing.
     *
     * Anything else declared and unpublished is a mailbox nobody will
     * read, and this test says so.
     */
    const NOT_PRINTED = new Set(['dmarc@lexyflow.com', 'contact@lexyflow.com']);
    for (const addr of listed) {
      if (NOT_PRINTED.has(addr)) continue;
      expect(published).toContain(addr);
    }
  });
});

describe('the declaration records what was measured, not what was assumed', () => {
  it('names where the DNS actually is', () => {
    // The first version of this file managed Cloudflare Email Routing.
    // The zone is at Namecheap and is in no Cloudflare account the
    // operator belongs to — the lookup returns zero and SUCCEEDS, which
    // is what distinguishes an absence from a refusal.
    expect(ROUTING).toContain('Namecheap');
    expect(ROUTING).toContain('total_count: 0');
  });

  it('does not assert a cause that was never measured', () => {
    // The deleted script claimed Cloudflare had accepted and dropped
    // the message. It could not have: the domain is not there.
    expect(ROUTING).toContain('unsupported');
    expect(ROUTING).not.toMatch(/catch-all set to drop/);
  });

  it('says why this is a table and not a script', () => {
    // So the next person does not write a third one. Neither Namecheap
    // nor iCloud aliases expose an API we hold.
    expect(ROUTING).toContain('no API');
  });

  it('records the decision that was taken, and what it removed', () => {
    // The Worker fed a webhook route that existed. Deleting one would
    // have orphaned the other, so this was a decision rather than a
    // cleanup — and the operator took it on 20 October. What is gone
    // is named, so nobody wonders later whether it was ever real.
    expect(ROUTING).toContain('never existed');
    expect(ROUTING).toContain('reply-classifier');
    expect(ROUTING).toContain('INBOUND_WEBHOOK_SECRET');
  });

  it('keeps the tables the deletion did not touch', () => {
    // /api/outreach/unsubscribe/[token] reads outreach_* and is live.
    // Deleting a table because one of its two readers went away is the
    // same mistake in the other direction.
    expect(ROUTING).toContain('outreach_*');
  });

  it('says a catch-all is not a substitute for this table', () => {
    // Mail now lands somewhere whatever the address. That removes the
    // silent loss and not the reason for declaring which obligation
    // each address answers.
    expect(ROUTING).toContain('catch-all is enabled');
    expect(ROUTING).toContain('not that anybody reads it');
  });
});
