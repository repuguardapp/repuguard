import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_LOCALE, NATIVE_LOCALE_CODES } from '@/i18n/locales';
import { buildCsp } from '@/lib/csp';
import { detectLocale } from '@/lib/locale-detection';

const intlMiddleware = createMiddleware({
  locales: NATIVE_LOCALE_CODES as unknown as string[],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
  localeDetection: false
});

const COUNTRY_HEADERS = [
  'x-vercel-ip-country',
  'cf-ipcountry',
  'x-country-code'
] as const;

function readCountry(req: NextRequest): string | null {
  for (const header of COUNTRY_HEADERS) {
    const value = req.headers.get(header);
    if (value) return value;
  }
  return null;
}

/**
 * Mint a nonce and attach the policy to the request AND the response.
 *
 * Both, and in that order, because they do different jobs. Next reads
 * the CSP off the REQUEST, finds the nonce in it, and stamps its own
 * inline bootstrap and RSC-payload scripts with it. The browser reads
 * it off the RESPONSE and enforces it. Set only the response and Next's
 * own scripts are blocked by our own header — the site goes blank in a
 * way no server-side test reproduces.
 *
 * `x-nonce` rides along so the layout can stamp the one third-party
 * script tag we render ourselves.
 */
function withCsp(request: NextRequest): { headers: Headers; policy: string } {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const policy = buildCsp({
    nonce,
    // An embeddable widget that no one may embed is not a widget. The
    // rest of the site stays unframeable.
    allowFraming: request.nextUrl.pathname.startsWith('/embed'),
    isDev: process.env.NODE_ENV !== 'production'
  });

  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', policy);
  return { headers, policy };
}

/**
 * Middleware orchestration:
 *  1. Skip for assets and API.
 *  2. If the URL has no locale, run our detector (Accept-Language + IP country)
 *     and rewrite to `/${locale}${pathname}`.
 *  3. Hand off to next-intl middleware which sets the request locale.
 *  4. Always emit `Content-Language` for SEO and analytics.
 */
export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The embed widget has no locale segment and never will: it lives
  // outside [locale] because the embedding site owns the chrome and
  // passes its own options. Sending it through the locale detector
  // redirected /embed/audit to /en/embed/audit, which does not exist —
  // so the widget answered 404 in the only context it is for, and had
  // done since it shipped. It still gets a CSP; what it does not get is
  // a locale prefix or frame-ancestors 'none'.
  if (pathname.startsWith('/embed')) {
    const { headers, policy } = withCsp(request);
    const response = NextResponse.next({ request: { headers } });
    response.headers.set('Content-Security-Policy', policy);
    return response;
  }

  const hasLocalePrefix = NATIVE_LOCALE_CODES.some(
    (code) => pathname === `/${code}` || pathname.startsWith(`/${code}/`)
  );

  if (!hasLocalePrefix) {
    const locale = detectLocale({
      acceptLanguage: request.headers.get('accept-language'),
      countryHeader: readCountry(request),
      availableLocales: NATIVE_LOCALE_CODES
    });

    const url = request.nextUrl.clone();
    url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`;

    const response = NextResponse.redirect(url);
    response.headers.set('Content-Language', locale);
    response.cookies.set('NEXT_LOCALE', locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax'
    });
    return response;
  }

  const { headers, policy } = withCsp(request);

  // next-intl builds the response, so the request headers have to reach
  // it through a new NextRequest rather than through NextResponse.next.
  const response = intlMiddleware(
    new NextRequest(request.nextUrl, { headers, ...({ geo: request.geo, ip: request.ip } as object) })
  );

  const localeFromPath = pathname.split('/')[1] ?? DEFAULT_LOCALE;
  response.headers.set('Content-Language', localeFromPath);
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
};
