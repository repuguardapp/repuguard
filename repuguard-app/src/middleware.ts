import { NextRequest, NextResponse } from 'next/server';
import createMiddleware from 'next-intl/middleware';
import { LOCALES, DEFAULT_LOCALE } from './i18n/locales';

const intlMiddleware = createMiddleware({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});

export function middleware(req: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https://lh3.googleusercontent.com`,
    `font-src 'self'`,
    `connect-src 'self' https://*.supabase.co`,
    `frame-ancestors 'none'`,
  ].join('; ');

  const intlRes = intlMiddleware(req) ?? NextResponse.next();
  intlRes.headers.set('Content-Security-Policy', csp);
  intlRes.headers.set('X-Nonce', nonce);
  intlRes.headers.set('Content-Language', req.nextUrl.pathname.split('/')[1] ?? DEFAULT_LOCALE);

  return intlRes as NextResponse;
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
