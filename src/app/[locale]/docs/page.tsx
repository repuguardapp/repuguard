import { Book, Code, Globe, Languages, ShieldCheck } from 'lucide-react';
import { getTranslations, unstable_setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { buildHreflangAlternates } from '@/lib/hreflang';

interface PageProps {
  params: { locale: string };
}

export async function generateMetadata({ params }: PageProps) {
  unstable_setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: 'docs' });
  const alternates = await buildHreflangAlternates('/docs');
  return {
    title: `${t('title')} — LexyFlow`,
    description: t('subtitle'),
    alternates: { canonical: `/${params.locale}/docs`, languages: alternates }
  };
}

export default async function DocsPage({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations('docs');

  const sections = [
    { icon: Book,         key: 'gettingStarted', href: '/audit' },
    { icon: Languages,    key: 'multiPass',      href: '/docs#multi-pass' },
    { icon: ShieldCheck,  key: 'zeroKnowledge',  href: '/docs#zero-knowledge' },
    { icon: Globe,        key: 'i18n',           href: '/docs#i18n' },
    { icon: Code,         key: 'api',            href: '/docs#api' }
  ] as const;

  return (
    <div className="mx-auto max-w-4xl py-16">
      <header className="grid gap-2">
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          {t('title')}
        </h1>
        <p className="text-pretty text-lg text-muted-foreground">
          {t('subtitle')}
        </p>
      </header>

      <section className="mt-12 grid gap-4 md:grid-cols-2">
        {sections.map(({ icon: Icon, key, href }) => (
          <Link key={key} href={href} className="group">
            <Card className="h-full transition-all hover:border-foreground/20 hover:shadow-md">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <CardTitle className="pt-2 group-hover:underline">{t(`sections.${key}.title`)}</CardTitle>
                <CardDescription className="text-pretty">{t(`sections.${key}.description`)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>

      <section className="mt-16 rounded-lg border bg-muted/40 p-6 text-center">
        <p className="text-pretty text-sm text-muted-foreground">
          {t.rich('footer', {
            link: (chunks) => (
              <a
                href="https://github.com/repuguardapp/repuguard"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:underline"
              >
                {chunks}
              </a>
            )
          })}
        </p>
      </section>
    </div>
  );
}
