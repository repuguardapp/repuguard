'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SignOutButton } from '@/components/SignOutButton';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';

/**
 * The two header buttons that depend on who is looking.
 *
 * Moved out of the layout because the layout read cookies to render them,
 * which made the layout dynamic — and `dynamic` on a layout applies to
 * every route beneath it. All 524 pages were rendering on demand so that
 * a signed-in visitor would see "My dashboard" instead of "Sign in".
 *
 * WHAT THE STATIC HTML SAYS, AND WHY THAT IS THE TRUE VERSION
 *
 * Signed out. That is what the page now contains before any JavaScript
 * runs, and it is correct for the overwhelming majority of the people and
 * every crawler that will ever request it: a visitor arriving from a
 * search result is not signed in. The signed-in pair replaces it after
 * the fetch resolves.
 *
 * THE COST, STATED PLAINLY
 *
 * A signed-in visitor sees "Sign in" for the fraction of a second before
 * the answer arrives. That is a real regression for them and it is the
 * price of the whole site being static. It is not hidden behind a
 * placeholder, because a neutral placeholder would take the call to
 * action away from the visitors who do need it in order to spare a flash
 * for the ones who do not.
 *
 * Nothing here is a security boundary. Every protected page checks the
 * session on the server; this only picks which pair of links to draw.
 */
export function HeaderAuth() {
  const tNav = useTranslations('nav');
  const tBilling = useTranslations('billing');
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    // Not cancelled on unmount by choice — the header lives for the whole
    // page. `active` guards React's double-invoked effect in development.
    let active = true;

    fetch('/api/auth/state', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { signedIn?: boolean } | null) => {
        if (active && body?.signedIn) setSignedIn(true);
      })
      .catch(() => {
        // A failed check leaves the signed-out header in place. That is
        // the safe direction: it offers a way in rather than a dashboard
        // link that would bounce the visitor to /login.
      });

    return () => {
      active = false;
    };
  }, []);

  if (signedIn) {
    return (
      <>
        <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
          <Link href="/dashboard">{tNav('myDashboard')}</Link>
        </Button>
        <SignOutButton label={tBilling('signOut')} />
      </>
    );
  }

  return (
    <>
      <Button asChild size="sm" variant="ghost" className="hidden sm:inline-flex">
        <Link href="/login">{tNav('signIn')}</Link>
      </Button>
      <Button asChild size="sm">
        <Link href="/audit">{tNav('startAudit')}</Link>
      </Button>
    </>
  );
}
