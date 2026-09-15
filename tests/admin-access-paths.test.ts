import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Four ways to fail to reach an admin page, and for three days they
 * produced two indistinguishable outcomes: a blank screen, or a silent
 * bounce to the dashboard.
 *
 * The bounce was a loop. The queue redirected to /login, /login saw a
 * perfectly valid ordinary session and redirected to /dashboard,
 * dropping the `next` it had been given. The ordinary session lasts
 * thirty days and the admin one twelve hours, so an allowlisted
 * operator returning the next morning hit it every single time and was
 * told nothing.
 */

const root = join(__dirname, '..');
const ADMIN_PAGES = [
  'src/app/[locale]/admin/legal-queue/page.tsx',
  'src/app/[locale]/admin/ops/page.tsx'
];

describe('each way of being refused gets its own answer', () => {
  for (const page of ADMIN_PAGES) {
    const source = readFileSync(join(root, page), 'utf8');

    describe(page, () => {
      it('sends a signed-out visitor to login, carrying the way back', () => {
        expect(source).toContain('login?next=');
      });

      it('404s a signed-in stranger rather than confirming the page exists', () => {
        expect(source).toContain('isAdminEmail');
        expect(source).toContain('notFound()');
      });

      it('explains an expired admin session instead of bouncing', () => {
        // Redirecting to /login here achieves nothing: the ordinary
        // session is still valid, so login sends them straight back to
        // the dashboard.
        expect(source).toContain('AdminSessionExpired');
      });

      it('checks the allowlist before revealing anything', () => {
        // The expired-session page names the queue. Showing it to a
        // non-allowlisted visitor would leak what the 404 exists to
        // hide.
        //
        // Compared inside the component body: both names also appear in
        // the import block at the top, where their order says nothing.
        const body = source.slice(source.indexOf('export default async function'));
        expect(body.indexOf('isAdminEmail')).toBeLessThan(body.indexOf('AdminSessionExpired'));
      });
    });
  }
});

describe('login returns the visitor to what they asked for', () => {
  const source = readFileSync(join(root, 'src/app/[locale]/login/page.tsx'), 'utf8');

  it('honours next instead of always going to the dashboard', () => {
    expect(source).toContain('safeNext');
    expect(source).toContain('searchParams');
  });

  it('refuses a next that points off-site', () => {
    // `next=https://evil.test` or `//evil.test` would make our login
    // page an open redirect — the classic way a phishing link borrows a
    // domain's credibility.
    expect(source).toContain("startsWith('//')");
    expect(source).toContain("startsWith('/')");
  });
});

describe('the expired-session page says what to do', () => {
  const source = readFileSync(join(root, 'src/components/AdminSessionExpired.tsx'), 'utf8');

  it('states the limit from the policy rather than hardcoding a number', () => {
    // A page that says "12 hours" while the constant says something
    // else is the next confidently-wrong message.
    expect(source).toContain('ADMIN_SESSION_MAX_AGE_MS');
  });

  it('offers the action that actually resolves it', () => {
    // Signing out is the only thing that helps: a new session is what
    // resets the time-box.
    expect(source).toContain('/api/auth/signout');
  });
});
