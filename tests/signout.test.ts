import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The sign-out button never signed anyone out.
 *
 * The route built its Supabase client from the shared helper, whose
 * cookie writer goes through `cookies()` in next/headers — landing on
 * the response Next generates for you. It then returned a DIFFERENT
 * object, NextResponse.redirect(...), carrying none of those writes.
 * The session was revoked upstream and the browser kept its cookie, so
 * the next request presented one that still worked.
 *
 * On a product holding compliance reports full of names, home addresses
 * and tax identifiers, a sign-out that does not sign out is worse than
 * none: it is the control someone reaches for on a borrowed device, and
 * it told them they were safe.
 *
 * /api/auth/callback already documents this exact trap in the other
 * direction. These are declaration checks because the failure lives in
 * which object the cookies were written to — a shape, not a value.
 */

const root = join(__dirname, '..');
const source = readFileSync(join(root, 'src/app/api/auth/signout/route.ts'), 'utf8');

describe('sign-out clears the cookies on the response it returns', () => {
  it('writes cookies onto the redirect, not through next/headers', () => {
    expect(source).toContain('response.cookies.set');
    // The shared helper is what routes writes to the wrong object here.
    expect(source).not.toContain('createSupabaseServerClient');
  });

  it('builds the response before the client that writes to it', () => {
    const responseBuilt = source.indexOf('NextResponse.redirect');
    const clientBuilt = source.indexOf('createServerClient(');
    expect(responseBuilt).toBeGreaterThan(-1);
    expect(clientBuilt).toBeGreaterThan(responseBuilt);
  });
});

describe('the browser loses its session whatever the server says', () => {
  it('clears cookies when Supabase is not configured', () => {
    // A misconfigured environment is not a reason to leave someone
    // signed in on a device they are walking away from.
    expect(source).toContain('clearLocally');
  });

  it('clears cookies when revocation fails upstream', () => {
    expect(source).toContain('revoke_failed');
  });

  it('clears every chunk, not just the base cookie name', () => {
    // @supabase/ssr splits a large session across sb-<ref>-auth-token.0,
    // .1 and so on. Clearing only the base name leaves the chunks.
    expect(source).toContain("startsWith('sb-')");
    expect(source).toContain('getAll()');
  });
});
