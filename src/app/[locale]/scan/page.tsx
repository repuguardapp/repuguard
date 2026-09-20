import { Eye, FileSearch, Lock, ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScanForm } from '@/components/ScanForm';
import { absoluteUrl } from '@/lib/app-url';
import { NATIVE_LOCALE_CODES } from '@/i18n/locales';

/**
 * The front door of the scan.
 *
 * Indexable, unlike the results it produces — this page is ours, it names
 * nobody, and "what does your privacy policy publish" is a question a DPO
 * actually types into a search engine.
 *
 * WHY THE METHOD IS ON THE PAGE
 *
 * Under the form, four sentences say exactly what we do: we read robots.txt
 * and obey it, we read only the document the site publishes itself, the
 * result is private until the domain is proved, and we pass no judgement on
 * the organisation. That is not reassurance copy. A visitor about to point
 * our infrastructure at a third party's server is entitled to know what
 * that sends, and a company selling GDPR audits that were vague about its
 * own processing would be selling something it does not practise.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'scan' });

  return {
    title: t('indexMetaTitle'),
    description: t('indexMetaDescription'),
    alternates: {
      canonical: absoluteUrl(`/${params.locale}/scan`),
      languages: Object.fromEntries(
        NATIVE_LOCALE_CODES.map((code) => [code, absoluteUrl(`/${code}/scan`)])
      )
    }
  };
}

export default async function ScanIndexPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const t = await getTranslations('scan');

  const method: { icon: typeof ShieldCheck; text: string }[] = [
    { icon: ShieldCheck, text: t('howRobots') },
    { icon: FileSearch, text: t('howPublic') },
    { icon: Lock, text: t('howPrivate') },
    { icon: Eye, text: t('howNoVerdict') }
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-8 px-4 py-16 md:px-0">
      <header className="grid gap-3">
        <h1 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('formTitle')}
        </h1>
        <p className="text-balance leading-relaxed text-muted-foreground">{t('formLead')}</p>
      </header>

      <ScanForm
        locale={params.locale}
        labels={{
          inputLabel: t('inputLabel'),
          inputPlaceholder: t('inputPlaceholder'),
          submit: t('submit'),
          submitting: t('submitting'),
          errorNotADomain: t('errorNotADomain'),
          errorRateLimited: t('errorRateLimited'),
          errorDomainRateLimited: t('errorDomainRateLimited'),
          errorService: t('errorService')
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('howHeading')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {method.map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
