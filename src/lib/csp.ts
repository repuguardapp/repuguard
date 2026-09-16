/**
 * The Content-Security-Policy, built per request around a fresh nonce.
 *
 * Until now the site had good headers and no CSP: HSTS with preload,
 * X-Frame-Options, nosniff, a Permissions-Policy. None of those stop a
 * script. On a product where the page a customer is looking at contains
 * the text of their own contract, an injected script is not defacement,
 * it is exfiltration — and the same page holds a session that can read
 * every other document that organisation has uploaded.
 *
 * WHY A NONCE AND NOT 'unsafe-inline'
 *
 * Next.js renders inline scripts: the bootstrap, and the RSC payload it
 * pushes into `self.__next_f`. Allowing inline script wholesale would
 * let those run — and would let anything else run too, which is the
 * entire attack this header exists to stop. A CSP with 'unsafe-inline'
 * in script-src looks like protection in a header dump and is not any.
 *
 * So the middleware mints a nonce per request and sets the policy on
 * BOTH the request and the response. Next reads it off the request and
 * stamps its own inline scripts with that nonce; we stamp the one
 * third-party tag we render ourselves. Everything else inline is, by
 * construction, not ours.
 *
 * WHY NOT 'strict-dynamic'
 *
 * It would be tidier: trust propagates from a nonced script to the
 * scripts it creates, which is exactly how Turnstile loads. But it also
 * makes browsers IGNORE the host allowlist, so a mistake anywhere in
 * the chain fails closed and silently, on someone else's browser, in a
 * way no server-side check reproduces. This is the first CSP this site
 * has ever had. Hosts are explicit and debuggable; strict-dynamic is an
 * upgrade to make once there are reports to read.
 */

export interface CspOptions {
  nonce: string;
  /** Embed routes are meant to be framed by customers; the site is not. */
  allowFraming: boolean;
  /** Relaxed in dev, where Next needs eval for hot reload. */
  isDev: boolean;
}

/**
 * PostHog's ingestion host, read per call rather than at import.
 *
 * As a module-level const it froze whatever the environment held the
 * first time anything imported this file. Point PostHog at a proxy and
 * the policy would go on allowing the old host — so the analytics
 * requests would be blocked by our own header, silently, on visitors'
 * browsers, with nothing failing on the server to say so.
 */
function posthogHost(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';
}

/** The Supabase project origin, derived rather than hard-coded. */
function supabaseOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

export function buildCsp({ nonce, allowFraming, isDev }: CspOptions): string {
  const supabase = supabaseOrigin();
  const supabaseWs = supabase ? supabase.replace(/^https:/, 'wss:') : '';

  const script = [
    "'self'",
    `'nonce-${nonce}'`,
    // Tolt's affiliate tag, rendered by our own layout with the nonce —
    // listed because the nonce alone would not cover the requests its
    // script makes for its own assets.
    'https://cdn.tolt.io',
    // Turnstile injects itself via document.createElement from our
    // bundle, so it needs the host rather than a nonce.
    'https://challenges.cloudflare.com',
    // Next's dev server compiles with eval. Never in production.
    ...(isDev ? ["'unsafe-eval'"] : [])
  ];

  const connect = [
    "'self'",
    supabase,
    supabaseWs,
    posthogHost(),
    'https://challenges.cloudflare.com'
    // Sentry is NOT here: tunnelRoute sends its traffic through
    // /monitoring on our own origin, which 'self' already covers.
  ].filter(Boolean);

  const directives: string[] = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    // Styles are not nonced. Next and Tailwind both emit inline style
    // attributes, nonces do not apply to those, and a style injection
    // is a defacement where a script injection is a data breach. The
    // trade is deliberate and it is the standard one.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    // Turnstile renders its challenge in an iframe.
    "frame-src 'self' https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Who may frame US. The site: nobody. /embed: anyone, which is what
    // an embeddable widget means.
    allowFraming ? 'frame-ancestors *' : "frame-ancestors 'none'",
    'upgrade-insecure-requests'
  ];

  return directives.join('; ');
}
