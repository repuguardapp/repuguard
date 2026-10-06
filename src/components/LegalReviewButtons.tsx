'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Approve / reject for one item in the legal review queue.
 *
 * Approving is the moment a statement stops being a model's output and
 * becomes something LexyFlow says in public, in seven languages. The
 * control is deliberately plain and deliberately slow to hit by
 * accident: no keyboard shortcut, no bulk action, and the button
 * disables itself for the round trip so a double-click cannot fire
 * twice. The server enforces that too — a second decision on an item
 * already reviewed returns 409 rather than overwriting it.
 *
 * REJECTING ASKS WHY, BECAUSE THE ANSWER IS THE ONLY FEEDBACK WE GET
 *
 * The API has taken a `reason` since it was written and this component
 * never sent one: the button fired blind, and every rejection landed in
 * the database as the string "rejected in review". So the one channel
 * that tells us what the extractor gets wrong — three rejections on a
 * source surface it in the digest, a repeated phrase names a prompt
 * defect — was carrying no information at all, while the code upstream
 * was written as though it were.
 *
 * The box is required. An optional field in a flow that is already
 * tedious gets skipped, which rebuilds the blind rejection with extra
 * steps.
 */
/**
 * Short enough to be honest, long enough to be useless as a reason.
 * "non" and "ko" tell the digest nothing.
 */
const MIN_REASON_CHARS = 10;

/** The API caps it at 500; the box says so rather than truncating later. */
const MAX_REASON_CHARS = 500;

export function LegalReviewButtons({ developmentId }: { developmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Null until the reject button is pressed once; then the box is open. */
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  /**
   * Forget everything the moment this component is handed a different
   * fiche.
   *
   * Rejecting one card made the open box, the confirm button and the
   * typed reason appear on the next card to take its place, carrying the
   * text. The list is keyed, and the component still has to survive
   * being reused: `router.refresh()` reconciles a server-rendered list
   * against a live client tree, and an instance that is recycled rather
   * than unmounted keeps its state by design.
   *
   * Carrying a reason written about one organisation onto a decision
   * about another is not a cosmetic glitch. One mis-click and a
   * rejection is recorded against the wrong company with somebody
   * else's justification attached to it.
   *
   * Adjusted during render rather than in an effect: React documents
   * this as the way to reset state on a prop change, and it runs before
   * paint, so the stale text is never visible for a frame.
   */
  const [shownFor, setShownFor] = useState(developmentId);
  if (shownFor !== developmentId) {
    setShownFor(developmentId);
    setAsking(false);
    setReason('');
    setError(null);
  }

  async function decide(action: 'approve' | 'reject') {
    if (action === 'reject' && reason.trim().length < MIN_REASON_CHARS) {
      setError(`Dis pourquoi — au moins ${MIN_REASON_CHARS} caractères.`);
      return;
    }

    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/admin/legal-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          developmentId,
          action,
          ...(action === 'reject' ? { reason: reason.trim() } : {})
        })
      });
      if (res.status === 409) {
        // Someone else, or another tab, already decided this one.
        setError('Déjà traitée — actualisation.');
        router.refresh();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Échec');
        return;
      }
      // Cleared before the refresh, not left to the unmount. The
      // component may well survive the list changing under it, and a
      // box that stays open is a box the next decision inherits.
      setAsking(false);
      setReason('');
      router.refresh();
    } catch {
      setError('Erreur réseau — rien n’a été modifié.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={busy !== null} onClick={() => decide('approve')}>
          {busy === 'approve' ? 'Approbation…' : 'Approuver pour publication'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() => (asking ? decide('reject') : setAsking(true))}
        >
          {busy === 'reject' ? 'Rejet…' : asking ? 'Confirmer le rejet' : 'Rejeter'}
        </Button>
        {asking && busy === null ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAsking(false);
              setReason('');
              setError(null);
            }}
          >
            Annuler
          </Button>
        ) : null}
        {error ? <span className="text-sm text-destructive">{error}</span> : null}
      </div>

      {asking ? (
        <div className="grid gap-1.5">
          <label htmlFor={`reason-${developmentId}`} className="text-xs text-muted-foreground">
            Pourquoi ? Ce motif est lu : trois rejets sur une même source la signalent comme
            stérile, et un motif qui revient désigne un défaut du prompt.
          </label>
          {/* A plain element with the house classes, as every other form
              control in this codebase is. A new UI primitive for one box
              is a component to maintain for the sake of an import. */}
          <textarea
            id={`reason-${developmentId}`}
            value={reason}
            autoFocus
            rows={2}
            maxLength={MAX_REASON_CHARS}
            placeholder="ex. le montant de l’amende manque, la page ICO l’indique en bas"
            onChange={(e) => setReason(e.target.value)}
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      ) : null}
    </div>
  );
}
