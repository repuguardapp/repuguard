import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { SignInForm } from '@/components/SignInForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';
import { getCurrentUser } from '@/lib/supabase-server';

interface PageProps {
  params: { locale: string };
  searchParams?: { next?: string; error?: string };
}

/**
 * Where to send a visitor who is already signed in.
 *
 * Protected pages redirect here with `?next=` so the visitor returns to
 * what they asked for. This page ignored it and always went to the
 * dashboard, which turned every such redirect into a dead end: ask for
 * the admin queue, get bounced to login, get bounced to the dashboard,
 * and never learn why. Three rounds of that is how an afternoon
 * disappears.
 *
 * Only a same-origin path is honoured. A value starting with `//` is a
 * schema-relative URL to another host, and `next=https://evil.test`
 * would turn our login page into an open redirect — the classic way a
 * phishing link borrows a domain's credibility.
 */
function safeNext(next: string | undefined, locale: string): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return `/${locale}/dashboard`;
  }
  return next;
}

export async function generateMetadata({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'auth' });
  const alternates = await buildHreflangAlternates('/login');
  return {
    title: `${t('signInTitle')} — LexyFlow`,
    alternates: { canonical: `/${locale}/login`, languages: alternates }
  };
}

export default async function LoginPage({ params: { locale }, searchParams }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('auth');

  // Belt-and-braces redirect: never show the magic-link form to a
  // visitor who already has a valid session. The layout chrome hides
  // the "Sign in" button for authed users, but a user can still land
  // here via:
  //   - a stale bookmark / browser-history entry
  //   - a direct paste of /<locale>/login into the URL bar
  //   - a layout that briefly missed the cookie during propagation
  //     after the magic-link callback
  // In every one of those cases we route to the dashboard so the
  // signed-in state is honoured.
  const user = await getCurrentUser();
  if (user) {
    redirect(safeNext(searchParams?.next, locale));
  }

  // Surface the SignInForm's label bundle on the server so the client
  // component ships zero translation logic and the same JS bundle
  // serves every locale.
  const labels = {
    emailLabel: t('emailLabel'),
    emailPlaceholder: t('emailPlaceholder'),
    submit: t('submit'),
    submitting: t('submitting'),
    inboxTitle: t('inboxTitle'),
    inboxBody: t('inboxBody'),
    inboxRetry: t('inboxRetry'),
    errorService: t('errorService'),
    errorRateLimited: t('errorRateLimited'),
    errorGeneric: t('errorGeneric')
  };

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-16 md:px-0">
      <Card className="w-full">
        <CardHeader className="text-center">
          <CardTitle>{t('signInTitle')}</CardTitle>
          <CardDescription>{t('signInTagline')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* A failed callback lands here with ?error=. It used to land
              here silently, so someone whose link a mail scanner had
              already spent saw a login form and no reason — the exact
              dead end the interstitial exists to prevent, reproduced
              one step later. The cause is not named: the visitor can do
              nothing with "verify_failed", and the remedy is the same
              for all of them. */}
          {searchParams?.error ? (
            <div
              role="alert"
              className="mb-6 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm leading-relaxed"
            >
              {t('linkFailed')}
            </div>
          ) : null}
          <SignInForm locale={locale} labels={labels} />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('newHere')}{' '}
            <Link href="/audit" className="font-medium text-foreground hover:underline">
              {t('newHereCta')}
            </Link>{' '}
            {t('newHereSuffix')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
