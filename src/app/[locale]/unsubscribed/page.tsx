import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Where one click of "unsubscribe" ends.
 *
 * Deliberately a dead end. No "was this a mistake?", no preferences
 * centre, no offer of a reduced frequency — every one of those is a
 * retention pattern, and a company that audits other people's consent
 * mechanisms cannot ship one. The person said no; the only respectful
 * answer is a sentence confirming it and a door out.
 *
 * Not indexed, because it exists for one recipient at one moment.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false }
};

const DONE: Record<string, { title: string; body: string }> = {
  en: {
    title: 'You have been removed',
    body: 'We will not contact you again. Your address has been recorded only so that nothing we build later can write to it.'
  },
  fr: {
    title: 'Vous avez été retiré',
    body: 'Nous ne vous recontacterons pas. Votre adresse est conservée uniquement pour qu’aucun de nos futurs envois ne puisse l’atteindre.'
  }
};

export default function UnsubscribedPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale);
  const copy = DONE[params.locale] ?? DONE['en']!;

  return (
    <div className="mx-auto grid max-w-md gap-6 px-4 py-24 md:px-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{copy.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
        </CardContent>
      </Card>
    </div>
  );
}
