import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { FRAMEWORKS } from '@/lib/legal-frameworks';
import { AuditForm } from '@/components/AuditForm';

interface PageProps {
  params: { locale: string };
}

export default async function AuditPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('audit');

  return (
    <div className="grid gap-8 max-w-2xl">
      <h1 className="text-3xl font-semibold">{t('upload')}</h1>
      <p className="text-sm text-slate-600">{t('zeroKnowledge')}</p>

      <AuditForm
        labels={{
          upload: t('upload'),
          uploadHint: t('uploadHint'),
          targetLanguage: t('targetLanguage'),
          targetLanguageHint: t('targetLanguageHint'),
          framework: t('framework'),
          submit: t('submit'),
          running: t('running')
        }}
        frameworks={FRAMEWORKS.map((f) => ({ id: f.id, name: f.name }))}
        defaultLanguage={locale}
      />
    </div>
  );
}
