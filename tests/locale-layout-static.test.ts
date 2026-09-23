import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Two buttons cost us the entire static site.
 *
 * The locale layout called getCurrentUser() so the header could say "My
 * dashboard" instead of "Sign in", which made the layout dynamic — and
 * `dynamic` on a layout applies to every route beneath it. The comment
 * beside the directive claimed nested pages were "still prerendered".
 * They were not: the build reported 524 static pages and wrote ONE html
 * file to disk. Every page of the site rendered on demand, with a
 * Supabase round-trip for the session, including the 350 programmatic
 * pages whose whole purpose is to be crawled.
 *
 * After the header moved to /api/auth/state the same build writes 428.
 *
 * This is a source-text guard because the failure was invisible at every
 * level above it: types passed, tests passed, and the build printed "✓
 * Generating static pages (524/524)" while producing one. The only honest
 * signal was counting files on disk, and the only cheap way to keep the
 * property is to forbid the directive in the file that propagates it.
 */

const LAYOUT = join(__dirname, '..', 'src', 'app', '[locale]', 'layout.tsx');
const SOURCE = readFileSync(LAYOUT, 'utf8');

describe('the locale layout does not make the whole site dynamic', () => {
  it('declares no route segment config that opts the subtree out', () => {
    // A layout is not the place to decide this. A page that genuinely
    // needs the request — dashboard, admin, the scan result — says so in
    // its own file, and only for itself.
    expect(SOURCE).not.toMatch(/^export const dynamic\s*=/m);
    expect(SOURCE).not.toMatch(/^export const revalidate\s*=\s*0/m);
    expect(SOURCE).not.toMatch(/^export const fetchCache\s*=/m);
  });

  it('reads neither the session nor the request headers', () => {
    // Either one makes the subtree dynamic on its own, with no directive
    // and no warning — which is how this arrived the first time.
    expect(SOURCE).not.toContain('getCurrentUser');
    expect(SOURCE).not.toMatch(/\bcookies\(\)/);
    expect(SOURCE).not.toMatch(/\bheaders\(\)/);
  });
});
