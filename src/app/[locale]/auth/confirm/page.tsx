import { LogIn, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The one click that stands between a magic link and a session.
 *
 * Corporate mail security products open every URL in an inbound message
 * before the recipient sees it. While /api/auth/callback signed people
 * in on a GET, that meant the scanner spent the one-time token on
 * arrival and the person who clicked ten minutes later was told their
 * link had expired. It cost us most of a hundred real prospects — the
 * confirmation rate tracked whether a mailbox had a scanner, not
 * whether its owner was interested.
 *
 * Scanners follow links. They do not fill in forms. So the token now
 * travels to this page untouched and is spent only by a POST.
 *
 * NO JAVASCRIPT, AND NO AUTO-SUBMIT
 *
 * A plain <form> that works with scripting disabled, in an email
 * client's in-app browser, and on a ten-year-old phone. Auto-submitting
 * it on load would restore the exact bug for any scanner that runs a
 * headless browser, which the better ones do. The click has to be a
 * person's.
 *
 * The screen is also worth having on its own terms: a page that names
 * the product and the action before a session exists is what someone
 * should see before an email logs them in.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Confirm sign-in',
  // The URL carries a live credential. It must not be indexed, and no
  // referrer may carry it to a third party.
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
};

interface PageProps {
  params: { locale: string };
  searchParams?: {
    code?: string;
    token_hash?: string;
    type?: string;
    next?: string;
  };
}

export default async function ConfirmSignInPage({ params, searchParams }: PageProps) {
  setRequestLocale(params.locale);
  const t = await getTranslations('authConfirm');

  const code = searchParams?.code ?? '';
  const tokenHash = searchParams?.token_hash ?? '';
  const type = searchParams?.type ?? '';
  const next = searchParams?.next ?? `/${params.locale}/dashboard`;

  // Nothing to confirm — someone reached this URL directly. Send them
  // to sign in rather than showing a button that would fail.
  if (!code && !tokenHash) redirect(`/${params.locale}/login`);

  return (
    <div className="mx-auto grid max-w-md gap-6 px-4 py-20 md:px-0">
      <Card>
        <CardHeader className="gap-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <LogIn className="h-5 w-5 text-muted-foreground" aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('body')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form action="/api/auth/callback" method="post" className="grid gap-4">
            {code ? <input type="hidden" name="code" value={code} /> : null}
            {tokenHash ? <input type="hidden" name="token_hash" value={tokenHash} /> : null}
            {type ? <input type="hidden" name="type" value={type} /> : null}
            <input type="hidden" name="next" value={next} />
            <Button type="submit" size="lg" className="w-full">
              {t('cta')}
            </Button>
          </form>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t('reassurance')}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
