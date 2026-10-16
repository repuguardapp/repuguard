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

/**
 * The headline observation, with its three columns and nothing less.
 *
 * It used to be a bare percentage. A percentage is a ratio that has
 * forgotten what it was a ratio OF, and this component then printed it
 * beside the only other number it had — the sample size.
 */
export interface DraftHeadline {
  label: string;
  present: number;
  notFound: number;
  /** Published, never folded into "not found". It is 40% of this one. */
  unclear: number;
  /** present + notFound + unclear. The documents actually read. */
  total: number;
}

export interface DraftFigures {
  /** Null while the crawl has produced nothing to lead with. */
  headline: DraftHeadline | null;
  documentsRead: number;
  lookedAt: number;
  sampleSize: number;
  refused: number;
  sourceId: string | null;
  /** How the ranking describes itself. Never our paraphrase of it. */
  sourceLabel: string | null;
  sourceDate: string | null;
  observatoryUrl: string;
  csvUrl: string;
}

export function OutreachDraft({ figures }: { figures: DraftFigures }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [hook, setHook] = useState('');
  const [copied, setCopied] = useState(false);

  /**
   * A COUNT OVER ITS OWN DENOMINATOR. NEVER A PERCENTAGE BESIDE ANOTHER
   * NUMBER.
   *
   * This line read: "13 % des politiques de confidentialité lues sur 297
   * sites .fr traitent les transferts hors Union européenne."
   *
   * Both halves are false and they compound. We did not read policies on
   * 297 sites — we read 106, from 280 domains attempted, out of a sample
   * of 297. And the 13% is 14 over 106. Put beside 297 it invites the
   * reader to multiply: 13% of 297 is 39, and the true figure is 14. The
   * sentence overstated the finding by a factor of nearly three, in the
   * one artefact written to be forwarded to a journalist.
   *
   * It got there by a fix. An earlier version hardcoded "300", that was
   * corrected to the real sample size, and the correction dropped a
   * truthful constant next to a ratio computed over something else.
   * Removing one false number is not the same as making the sentence
   * true.
   *
   * The public page has enforced the rule since the day it shipped —
   * "the count beside the percentage, always; a percentage with no
   * denominator is the shape of a number you cannot check" — and this
   * component, which is the only place the figure leaves the building,
   * was the one place not obeying it.
   */
  const subject = useMemo(() => {
    const h = figures.headline;
    return h === null
      ? `Ce que publient les politiques de confidentialité des sites .fr`
      : `${h.total} politiques de confidentialité .fr lues : ${h.present} ${h.label}`;
  }, [figures]);

  const body = useMemo(() => {
    const first = name.trim() || '[prénom]';
    const personal = hook.trim() || '[une ligne sur ce que cette personne a écrit]';
    const h = figures.headline;

    /**
     * The three columns, in the order that publishes our own doubt first.
     *
     * 42 of the 106 are undetermined — 40% — and that is the first
     * question a serious reader asks. Saying it before being asked is
     * what makes the other two numbers worth anything, and it is the
     * paragraph the hand-written version led with.
     */
    const figure =
      h === null
        ? `Le premier résultat est encore en cours de collecte.`
        : `${h.present} des ${h.total} politiques que nous avons pu lire ${h.label}. Dans ${h.notFound}, le sujet est absent. Pour ${h.unclear}, notre lecture automatique n'a pas tranché — et nous publions cette incertitude plutôt que de la ranger d'un côté ou de l'autre.`;

    return [
      `Bonjour ${first},`,
      '',
      personal,
      '',
      `Je publie un relevé sur les politiques de confidentialité des domaines .fr.`,
      figure,
      '',
      // lookedAt, not sampleSize. We attempted 280 of a sample of 297:
      // the other 17 were lost to our own failures, and counting them as
      // attempts would quietly inflate the denominator of the refusals
      // printed on the next line.
      // All three numbers, in one sentence, reconciling: a reader who
      // adds them gets the attempted count back. The earlier version
      // said "tenté de lire 297 domaines" and then used 280 as the
      // denominator of the refusals two lines down — internally
      // inconsistent, in a message whose only asset is being checkable.
      `Les refus font partie du résultat : ${figures.lookedAt} domaines tentés sur un échantillon de ${figures.sampleSize}, dont ${figures.documentsRead} lus et ${figures.refused} illisibles — robots.txt, 403, PDF, pages assemblées dans le navigateur — comptés et ventilés par motif plutôt que retirés du dénominateur.`,
      '',
      `Aucune organisation n'est nommée ni évaluée. Ce sont des agrégats, et une politique qui omet une mention peut être parfaitement licite.`,
      '',
      `Méthode et données : ${figures.observatoryUrl}`,
      `CSV : ${figures.csvUrl}`,
      '',
      figures.sourceId
        ? `L'échantillon vient de ${figures.sourceLabel ?? 'un classement public'}, édition ${figures.sourceId} du ${figures.sourceDate}, donc n'importe qui peut le refaire. Aucune entreprise n'est nommée : ce sont des agrégats, pas un palmarès.`
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
