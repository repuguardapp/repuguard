import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A door out of the business model, open to anyone who opened the
 * network tab.
 *
 * The org-spoof guard tested the CLAIM first and skipped itself
 * entirely for the anonymous UUID. So any account holder could send
 * `organizationId=00000000-0000-0000-0000-000000000000` and receive an
 * audit that consumes no credit, never touches `free_audit_used`, is
 * readable by UUID without a session, and escapes the paywall — because
 * every downstream branch reads that flag as "share link, never
 * charged, never paywalled".
 *
 * The decision: a signed-in visitor never produces an anonymous audit.
 */

const ROUTE = readFileSync(join(__dirname, '..', 'src/app/api/audit/route.ts'), 'utf8');
const ANON = '00000000-0000-0000-0000-000000000000';

describe('a session decides the organisation, never the form field', () => {
  it('reads the session before looking at what was claimed', () => {
    // The old order was the bug: test the claim, skip the guard. The
    // session has to be read on every submission, anonymous included,
    // or you cannot know whether one exists.
    expect(ROUTE.indexOf('const sessionUser = await getCurrentUser()')).toBeLessThan(
      ROUTE.indexOf('const isAnonymousOrg =')
    );
  });

  it('forces a claimed anonymous audit onto the signed-in organisation', () => {
    expect(ROUTE).toContain('anonymous_claim_forced_to_session_org');
    expect(ROUTE).toContain('meta = { ...meta, organizationId: sessionOrgId }');
  });

  it('recomputes the anonymous flag after forcing, never before', () => {
    // Everything downstream keys off this flag — the credit bypass, the
    // free-trial fallback, the paywall, the analytics attribution.
    // Reading it from the claim rather than from the decision is
    // precisely how the door was open.
    expect(ROUTE.indexOf('meta = { ...meta, organizationId: sessionOrgId }')).toBeLessThan(
      ROUTE.indexOf('const isAnonymousOrg =')
    );
    expect(ROUTE).toContain(`const isAnonymousOrg = meta.organizationId === ANONYMOUS_ORG;`);
  });

  it('refuses a signed-in user who has no organisation yet', () => {
    // Otherwise the door reopens: sign in, skip onboarding, submit as
    // anonymous for ever.
    expect(ROUTE).toContain("errorJson(\n        'onboarding_required'");
    expect(ROUTE).toContain("| 'onboarding_required'");
  });

  it('still rejects a mismatch between two real organisations', () => {
    // Silently rewriting that one would turn an attack attempt into a
    // success for the attacker's own org and erase the only trace.
    expect(ROUTE).toContain('org_mismatch_rejected');
    expect(ROUTE).toContain("errorJson('organization_mismatch'");
  });

  it('still lets a signed-out visitor use the embed widget', () => {
    // The feature we fixed two commits ago has to survive the fix to
    // the hole beside it.
    expect(ROUTE).toContain('} else if (!claimsAnonymous) {');
    expect(ROUTE).toContain("errorJson('unauthenticated'");
  });

  it('keeps one spelling of the anonymous id in this file', () => {
    const code = ROUTE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect((code.match(new RegExp(ANON, 'g')) ?? []).length).toBe(1);
    expect(code).toContain('const ANONYMOUS_ORG =');
  });
});

describe('the codes a user can actually hit have words', () => {
  const LOCALES = ['en', 'fr', 'es', 'de', 'pt-br', 'ja', 'ar'];

  it('translates every auth-shaped refusal, in all seven', () => {
    // `unauthenticated` and `organization_mismatch` were reachable and
    // silent before this change: the client renders labels.errors[code]
    // and fell through to a generic message.
    for (const locale of LOCALES) {
      const errors = JSON.parse(
        readFileSync(join(__dirname, '..', `messages/${locale}.json`), 'utf8')
      ).errors as Record<string, string>;
      for (const code of ['onboarding_required', 'unauthenticated', 'organization_mismatch']) {
        expect(errors[code], `${locale}.${code}`).toBeTruthy();
      }
    }
  });
});
