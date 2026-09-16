/**
 * The site's own origin, in one place.
 *
 * `NEXT_PUBLIC_APP_URL` was read in seventeen modules with nine
 * different fallbacks, and two of them were catastrophic if the
 * variable ever went missing in production:
 *
 *   sitemap.ts     → 'https://example.com'
 *   layout.tsx     → 'http://localhost:3000'   (metadataBase)
 *
 * A missing env var would not have thrown. It would have published a
 * sitemap of 360 URLs on example.com, and set every canonical, every
 * hreflang and every Open Graph URL on the site to localhost — silently,
 * to Google, for as long as nobody looked. The remaining fallbacks were
 * '' (a relative URL that Next resolves against that same broken
 * metadataBase) and, in checkout and billing, an empty Stripe return
 * URL.
 *
 * One value, one fallback, and a test that nothing reintroduces a
 * second. The fallback is the real domain: if the variable is ever
 * lost, the worst case is a correct URL rather than a wrong one.
 *
 * NEXT_PUBLIC_ so it is inlined at build time and usable from client
 * components as well as the server.
 */

const FALLBACK = 'https://lexyflow.com';

/** Origin with no trailing slash, e.g. `https://lexyflow.com`. */
export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return FALLBACK;
  // A trailing slash here produces `https://lexyflow.com//fr/pricing`
  // in every template that concatenates a path — which is a different
  // URL to a crawler, and a duplicate of the real one.
  return configured.replace(/\/+$/, '');
}

/** Absolute URL for a site-relative path. */
export function absoluteUrl(path: string): string {
  return `${appUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
