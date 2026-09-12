'use client';

import * as Sentry from '@sentry/nextjs';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Boundary for render errors inside a localized page.
 *
 * This is the one that will actually fire in practice — global-error
 * only catches what escapes the root layout. The layout above this
 * one survives, so the header, the locale and the message bundle are
 * all intact and the customer stays inside a page that looks like the
 * product rather than being dropped onto a blank screen.
 *
 * Reporting is explicit because next.config.mjs turns off Sentry's
 * automatic App Directory instrumentation — without this useEffect a
 * render error reaches nobody.
 */
export default function LocaleError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors');

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto grid max-w-xl gap-6 px-4 py-16 md:px-0">
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-lg">{t('boundaryTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">{t('boundaryBody')}</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="sm" onClick={reset}>
              {t('boundaryRetry')}
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard">{t('boundaryHome')}</Link>
            </Button>
          </div>
          {error.digest ? (
            // The digest is the only handle we and the customer share
            // when they write in. It identifies the occurrence without
            // describing it, so it is safe to show.
            <p className="text-xs text-muted-foreground">Ref: {error.digest}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
