import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A message to legal@lexyflow.com vanished on 19 October. No forward,
 * no bounce, no trace: Cloudflare's MX accepted it and dropped it,
 * which is what Email Routing does for an address with no rule when the
 * catch-all is set to drop.
 *
 * legal@ is printed on the DPA as the address where a customer asks for
 * a signed counterpart. It is in the legal footer, on the integrations
 * page, and in the signature of every lifecycle e-mail in seven
 * languages. Somebody exercising a contractual right wrote into a void.
 *
 * The routing lived in a dashboard and nowhere else, so nothing could
 * notice an address was missing. That is the defect; the lost message
 * is its first symptom.
 *
 * This test is the part that makes it stay fixed. Publishing a mailto:
 * without adding the address to routing.sh turns red here, before it
 * can turn silent in production.
 */

const ROOT = join(__dirname, '..');
const ROUTING = readFileSync(join(ROOT, 'infra/cloudflare-email-worker/routing.sh'), 'utf8');

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
      (addr) => !ROUTING.includes(addr.replace('@lexyflow.com', '@${ZONE_NAME}'))
    );
    expect(missing).toEqual([]);
  });

  it('routes the transactional sender too', () => {
    // hello@ is RESEND_FROM. An unrouted From means every customer
    // REPLY to a sign-in link or an audit notification is lost the same
    // way legal@ was — and nobody would report that either.
    expect(ROUTING).toContain('hello@${ZONE_NAME}');
  });

  it('does not invent an address nobody publishes', () => {
    // The routing table is derived from the product, not the reverse. A
    // rule for an address that appears nowhere is a mailbox nobody will
    // ever read.
    const published = publishedAddresses();
    const listed = [...ROUTING.matchAll(/"([a-z0-9._-]+)@\$\{ZONE_NAME\}"/g)].map(
      (m) => `${m[1]}@lexyflow.com`
    );
    expect(listed.length).toBeGreaterThan(0);
    for (const addr of listed) expect(published).toContain(addr);
  });
});

describe('the script refuses to write before it has been asked', () => {
  it('defaults to a read-only report', () => {
    // It has never run: api.cloudflare.com is refused by the sandbox's
    // egress proxy, so nothing here has been executed against the live
    // zone. Untested code that writes mail routing defaults to reading.
    expect(ROUTING).toContain('APPLY="${1:-}"');
    expect(ROUTING).toContain('if [ "${APPLY}" != "--apply" ]; then');
  });

  it('names the two ways mail is lost quietly', () => {
    // A catch-all set to drop, and a destination that was registered
    // but never verified. Both look healthy in the dashboard.
    expect(ROUTING).toContain('catch-all');
    expect(ROUTING).toContain('NOT VERIFIED');
  });

  it('never prints the token', () => {
    // The usage line prints the variable NAME followed by "..." so the
    // operator knows what to set. What must never appear is its
    // expansion: `${CLOUDFLARE_API_TOKEN}` outside the Authorization
    // header it belongs in.
    const expansions = [...ROUTING.matchAll(/\$\{CLOUDFLARE_API_TOKEN\}/g)];
    expect(expansions.length).toBe(1);
    expect(ROUTING).toContain('Authorization: Bearer ${CLOUDFLARE_API_TOKEN}');
    expect(ROUTING).not.toMatch(/(echo|printf)[^\n]*\$\{CLOUDFLARE_API_TOKEN\}/);
  });
});
