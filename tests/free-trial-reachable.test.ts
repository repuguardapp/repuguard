import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The free audit existed and no stranger could reach it.
 *
 * `/audit` gated on one question — "does this organisation have credits
 * left?" — and a new organisation is created with credits_remaining = 0,
 * the column default, because nothing grants any. Every account that
 * ever signed up was redirected to /pricing before the upload form
 * rendered.
 *
 * The free trial lives one layer down, in the audit endpoint: free tier,
 * free_audit_used still false, document under 2 MB. It has never fired.
 * `free_audit_used` is false on all four organisations in the database,
 * and that is not luck — the endpoint could not be reached to set it.
 *
 * The redirect was written to be kind: its own comment says send them to
 * pricing with a friendly banner rather than drop them into a form that
 * 402s on submit. It asked a narrower question than the endpoint, and
 * the question it skipped was the one that lets somebody try the
 * product.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const PAGE = read('src/app/[locale]/audit/page.tsx');
const ROUTE = read('src/app/api/audit/route.ts');

describe('the page and the endpoint agree on who may audit', () => {
  it('no longer redirects on credits alone', () => {
    expect(PAGE).not.toContain('if (credits <= 0) {');
    expect(PAGE).toContain('if (credits <= 0 && !freeTrialAvailable) {');
  });

  it('asks the endpoint’s own question: free tier, trial unused', () => {
    expect(PAGE).toContain('getTierForOrg');
    expect(PAGE).toContain("tier === 'free'");
    expect(PAGE).toContain("orgRow?.free_audit_used !== true");
  });

  it('reads free_audit_used out of the organisation row', () => {
    // Without the column the condition is always true and the gate
    // swings the other way — everybody reaches a form that 402s.
    expect(PAGE).toContain('credits_remaining,country,free_audit_used');
  });

  it('still sends a spent organisation to pricing', () => {
    // The fix must not open the form to someone with no credits AND no
    // trial left: that is the case the redirect was written for.
    expect(PAGE).toContain("redirect(`/${locale}/pricing?reason=no_credits`)");
  });

  it('leaves the endpoint as the authority that actually consumes', () => {
    // The page is a courtesy. The atomic decision stays in the route,
    // or two tabs buy one audit twice.
    expect(ROUTE).toContain('try_consume_audit_credit');
    expect(ROUTE).toContain("tier === 'free' && !freeAuditUsed");
  });
});
