import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

/**
 * Shared layout for /privacy, /terms, /dpa. Reading-optimised typography:
 * narrow measure, generous leading, monochrome.
 *
 * A locale-aware notice is rendered above the content on every non-EN
 * locale, telling the reader that the English text is the
 * authoritative legal version. Standard SaaS B2B pattern (Stripe,
 * Vercel, Anthropic all do the same) — avoids shipping seven
 * possibly-diverging translations of legal text, which would be
 * worse than a single authoritative one.
 */
export async function LegalShell({
  title,
  effective,
  locale,
  children
}: {
  title: string;
  effective: string;
  locale: string;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'legalNotice' });
  const showNotice = locale !== 'en';

  return (
    <article className="mx-auto max-w-3xl py-16">
      <header className="border-b pb-6">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Effective {effective} · LexyFlow ·{' '}
          <a href="mailto:legal@lexyflow.com" className="hover:underline">
            legal@lexyflow.com
          </a>
        </p>
      </header>

      {showNotice && (
        <aside className="mt-6 rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
          {t('body')}
        </aside>
      )}

      <div className="mt-8 space-y-6 text-pretty leading-relaxed text-foreground [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-semibold [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:ps-6 [&_li]:mt-1 [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold">
        {children}
      </div>
    </article>
  );
}
