'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Re-fetch a server component until the work it shows is finished.
 *
 * This replaces `metadata.other = { refresh: '6' }`, which never worked.
 * Next renders that field as `<meta name="refresh" content="6">`, and a
 * browser only acts on `<meta http-equiv="refresh">` — the `name` form is
 * inert. The result page therefore sat on "reading…" for ever while the
 * scan had finished in under a second, and the only way to see the answer
 * was to reload by hand.
 *
 * `router.refresh()` rather than `location.reload()`: it re-runs the server
 * component and swaps the result in, without discarding the page or losing
 * the scroll position.
 *
 * BOUNDED, BECAUSE A STUCK SCAN MUST NOT POLL FOR EVER.
 *
 * The pipeline always writes a terminal status, including from its catch —
 * so a page still running after this many attempts is evidence of a bug
 * rather than of a slow server, and hammering it would hide that rather
 * than surface it.
 */
export function AutoRefresh({ seconds, maxAttempts = 30 }: { seconds: number; maxAttempts?: number }) {
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (attempts >= maxAttempts) return;

    const id = setTimeout(() => {
      setAttempts((n) => n + 1);
      router.refresh();
    }, seconds * 1000);

    return () => clearTimeout(id);
  }, [attempts, maxAttempts, router, seconds]);

  return null;
}
