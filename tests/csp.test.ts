import { beforeEach, describe, expect, it } from 'vitest';
import { buildCsp } from '@/lib/csp';

/**
 * The first Content-Security-Policy this site has ever had.
 *
 * It had good headers and no CSP: HSTS with preload, X-Frame-Options,
 * nosniff, a Permissions-Policy. None of those stop a script. On a page
 * that contains the text of a customer's own contract, an injected
 * script is not defacement — it is exfiltration, from a session that
 * can read every other document that organisation has uploaded.
 *
 * These tests pin the shape. The browser check is elsewhere and is the
 * one that matters: twelve pages loaded in Chromium with zero
 * violations, the login form still interactive, the site refusing to be
 * framed and the embed widget accepting it.
 */

function directive(policy: string, name: string): string {
  const found = policy.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `) || d === name);
  return found ?? '';
}

const NONCE = 'a1b2c3d4e5f6';

beforeEach(() => {
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'https://proj.supabase.co';
  delete process.env['NEXT_PUBLIC_POSTHOG_HOST'];
});

describe('script-src is the directive that does the work', () => {
  it('carries the nonce and never allows inline wholesale', () => {
    // 'unsafe-inline' in script-src looks like protection in a header
    // dump and is not any: it would let Next's bootstrap run, and
    // everything else too.
    const policy = buildCsp({ nonce: NONCE, allowFraming: false, isDev: false });
    expect(directive(policy, 'script-src')).toContain(`'nonce-${NONCE}'`);
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('never allows eval in production', () => {
    const prod = buildCsp({ nonce: NONCE, allowFraming: false, isDev: false });
    expect(directive(prod, 'script-src')).not.toContain("'unsafe-eval'");
    // Next's dev server compiles with eval; that is the only reason it
    // is ever permitted.
    const dev = buildCsp({ nonce: NONCE, allowFraming: false, isDev: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });

  it('allows exactly the two third parties that load scripts', () => {
    const script = directive(buildCsp({ nonce: NONCE, allowFraming: false, isDev: false }), 'script-src');
    expect(script).toContain('https://cdn.tolt.io');
    expect(script).toContain('https://challenges.cloudflare.com');
    // PostHog and Sentry are bundled, not fetched — allowing their
    // origins here would widen the policy for nothing.
    expect(script).not.toContain('posthog');
    expect(script).not.toContain('sentry');
  });
});

describe('connect-src follows the code, not a guess', () => {
  it('derives the Supabase origin from the configured URL', () => {
    const connect = directive(buildCsp({ nonce: NONCE, allowFraming: false, isDev: false }), 'connect-src');
    expect(connect).toContain('https://proj.supabase.co');
    expect(connect).toContain('wss://proj.supabase.co');
  });

  it('follows PostHog wherever it is pointed', () => {
    process.env['NEXT_PUBLIC_POSTHOG_HOST'] = 'https://ph.lexyflow.com';
    const connect = directive(buildCsp({ nonce: NONCE, allowFraming: false, isDev: false }), 'connect-src');
    expect(connect).toContain('https://ph.lexyflow.com');
  });

  it('does not allow Sentry, which tunnels through our own origin', () => {
    // tunnelRoute sends it to /monitoring, which 'self' covers. Naming
    // sentry.io here would be a directive nobody could later justify.
    const connect = directive(buildCsp({ nonce: NONCE, allowFraming: false, isDev: false }), 'connect-src');
    expect(connect).not.toContain('sentry.io');
    expect(connect).toContain("'self'");
  });

  it('degrades to a valid policy when Supabase is unconfigured', () => {
    // A build machine has no env. A stray empty token would make the
    // whole directive invalid and browsers drop the policy entirely —
    // failing open, which is the worst outcome available.
    delete process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const connect = directive(buildCsp({ nonce: NONCE, allowFraming: false, isDev: false }), 'connect-src');
    expect(connect).not.toMatch(/\s{2,}/);
    expect(connect.endsWith(' ')).toBe(false);
  });
});

describe('who may frame us', () => {
  it('refuses the site', () => {
    const policy = buildCsp({ nonce: NONCE, allowFraming: false, isDev: false });
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'");
  });

  it('lets the embed widget be framed, which is what a widget is', () => {
    // X-Frame-Options: DENY applied to /:path* and therefore to
    // /embed/audit, so the widget could not work in the only context it
    // exists for. It had been that way since it shipped.
    const policy = buildCsp({ nonce: NONCE, allowFraming: true, isDev: false });
    expect(directive(policy, 'frame-ancestors')).toBe('frame-ancestors *');
  });
});

describe('the directives that cost nothing and close doors', () => {
  it('forbids plugins, foreign bases and foreign form targets', () => {
    const policy = buildCsp({ nonce: NONCE, allowFraming: false, isDev: false });
    // base-uri in particular: without it, an injected <base> rewrites
    // every relative URL on the page, including the form that carries a
    // magic-link token.
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(policy, 'form-action')).toBe("form-action 'self'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('accepts inline styles, and says so out loud', () => {
    // Next and Tailwind both emit inline style attributes, which nonces
    // do not cover. A style injection is a defacement; a script
    // injection is a data breach. The trade is deliberate.
    const policy = buildCsp({ nonce: NONCE, allowFraming: false, isDev: false });
    expect(directive(policy, 'style-src')).toContain("'unsafe-inline'");
  });

  it('is a single well-formed header with no empty directive', () => {
    const policy = buildCsp({ nonce: NONCE, allowFraming: false, isDev: false });
    expect(policy).not.toContain('\n');
    for (const d of policy.split(';')) expect(d.trim()).not.toBe('');
  });
});
