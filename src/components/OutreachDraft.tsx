'use client';

import { Copy, Mail } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Compose the outreach e-mail, and send nothing.
 *
 * The part of distribution that cannot be automated without breaking the
 * law: finding ten people who write about this. What CAN be removed is
 * the fifteen minutes of rewriting the same message fifteen times with
 * the current figure pasted in by hand.
 *
 * IT STORES NOTHING, AND THAT IS THE DESIGN
 *
 * The name and the address are typed here, held in React state, and go
 * nowhere. No fetch, no database, no log line. The moment we persisted a
 * journalist's address we would become the controller of personal data we
 * obtained from somewhere other than the person, which brings Article 14
 * and a notice obligation nobody in this industry honours — and we would
 * have rebuilt, one row at a time, the harvested contact file we deleted.
 *
 * The button opens the operator's own mail client with the message
 * prefilled. The send is a human act from a human mailbox, which is also
 * the only reason the message works: its whole force is that somebody
 * read the recipient's article.
 */

export interface DraftFigures {
  /** e.g. "38" — the headline percentage, or null while collecting. */
  headlinePercent: number | null;
  headlineLabel: string;
  documentsRead: number;
  lookedAt: number;
  sampleSize: number;
  refused: number;
  sourceId: string | null;
  sourceDate: string | null;
  observatoryUrl: string;
  csvUrl: string;
}

export function OutreachDraft({ figures }: { figures: DraftFigures }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [hook, setHook] = useState('');
  const [copied, setCopied] = useState(false);

  const subject = useMemo(
    () =>
      figures.headlinePercent === null
        ? `Ce que publient les politiques de confidentialité des 300 sites .fr les plus visités`
        : `${figures.headlinePercent} % des 300 sites .fr les plus visités ${figures.headlineLabel}`,
    [figures]
  );

  const body = useMemo(() => {
    const first = name.trim() || '[prénom]';
    const personal = hook.trim() || '[une ligne sur ce que cette personne a écrit]';
    const figure =
      figures.headlinePercent === null
        ? `Premier résultat en cours de collecte`
        : `Premier résultat : ${figures.headlinePercent} % ${figures.headlineLabel}`;

    return [
      `Bonjour ${first},`,
      '',
      personal,
      '',
      `Nous avons lu la politique de confidentialité des ${figures.sampleSize} domaines .fr les plus visités et compté sept mentions prévues par le RGPD. ${figure}.`,
      '',
      `${figures.refused} domaines sur ${figures.lookedAt} n'ont pas pu être lus du tout, et le détail des refus est publié avec le reste.`,
      '',
      `Méthode et données : ${figures.observatoryUrl}`,
      `CSV : ${figures.csvUrl}`,
      '',
      figures.sourceId
        ? `L'échantillon vient de la liste Tranco ${figures.sourceId} du ${figures.sourceDate}, donc n'importe qui peut le refaire. Aucune entreprise n'est nommée : ce sont des agrégats, pas un palmarès.`
        : `Aucune entreprise n'est nommée : ce sont des agrégats, pas un palmarès.`,
      '',
      `Si ça vous sert, prenez-le. Si la méthode vous paraît discutable, dites-le-moi, je corrigerai la page.`
    ].join('\n');
  }, [name, hook, figures]);

  const mailto = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Prénom</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border bg-background px-3 py-2"
            placeholder="Camille"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Adresse</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            className="rounded-md border bg-background px-3 py-2"
            placeholder="camille@exemple.fr"
          />
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">
          La ligne personnelle — ce que cette personne a écrit. C&apos;est la seule partie qui fait
          la différence entre un message et une séquence.
        </span>
        <input
          value={hook}
          onChange={(e) => setHook(e.target.value)}
          className="rounded-md border bg-background px-3 py-2"
          placeholder="Votre papier du 12 mars sur les cookie walls."
        />
      </label>

      <div className="grid gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{subject}</span>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-4 text-sm leading-relaxed">
          {body}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild disabled={!email.trim()}>
          <a href={mailto}>
            <Mail className="me-2 h-4 w-4" aria-hidden />
            Ouvrir dans mon client mail
          </a>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          <Copy className="me-2 h-4 w-4" aria-hidden />
          {copied ? 'Copié' : 'Copier'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Rien n&apos;est enregistré. Le nom et l&apos;adresse restent dans cette page et ne partent
        nulle part&nbsp;: les conserver ferait de nous le responsable d&apos;un traitement de
        données obtenues ailleurs que chez la personne, avec l&apos;obligation d&apos;information de
        l&apos;article 14 — et reconstruirait, ligne par ligne, le fichier que nous avons supprimé.
      </p>
    </div>
  );
}
