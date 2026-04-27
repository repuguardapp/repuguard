'use client';

import { useLocale } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { NATIVE_LOCALES } from '@/i18n/locales';

/**
 * Native-language selector.
 *
 * Why a `<select>` and not a fancy popover?
 *  - Native widgets render correctly in every locale incl. JP / RTL.
 *  - Screen readers and platform autofill work without extra ARIA glue.
 *  - It stays a single render path on Edge.
 *
 * The label uses each locale's endonym so users can spot their language even
 * if they cannot read the current UI.
 */
export function LanguageSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const current = useLocale();
  const [isPending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    startTransition(() => {
      router.replace(pathname, { locale: next });
    });
  }

  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="sr-only">Language</span>
      <span aria-hidden className="i-globe">🌐</span>
      <select
        value={current}
        onChange={onChange}
        disabled={isPending}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 pis-2 pie-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        {NATIVE_LOCALES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.endonym}
          </option>
        ))}
      </select>
    </label>
  );
}
