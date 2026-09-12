'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Live view of an audit that is still running.
 *
 * The audit no longer runs inside the customer's request, so there is
 * no stream of server-side progress to read. This polls the audit's
 * status endpoint instead and refreshes the page the moment the audit
 * reaches a terminal status, so the server component re-renders it as
 * a report — or as a failure.
 *
 * Deliberately shows elapsed time and an indeterminate bar rather than
 * a percentage. We do not know how far along the pipeline is, and a
 * compliance product that invents a number on its progress bar has
 * told its first lie before the report even arrives.
 */

const POLL_INTERVAL_MS = 3_000;

/**
 * How long a phase caption stays on screen. Purely cosmetic: it tells
 * the customer what the pipeline does, not where it currently is.
 */
const PHASE_INTERVAL_MS = 6_000;

export interface AuditLiveStatusLabels {
  title: string;
  body: string;
  phases: readonly string[];
  elapsed: string;
}

export function AuditLiveStatus({
  auditId,
  labels
}: {
  auditId: string;
  labels: AuditLiveStatusLabels;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState(0);
  // Refreshing twice would re-run the whole server component for
  // nothing, and the poll can still be in flight when the first one
  // lands.
  const settled = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setElapsed((s) => s + 1), 1_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (labels.phases.length === 0) return;
    const rotate = setInterval(
      () => setPhase((p) => (p + 1) % labels.phases.length),
      PHASE_INTERVAL_MS
    );
    return () => clearInterval(rotate);
  }, [labels.phases.length]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/audit/${auditId}`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { status?: string };
        // Any status that is not pending/running is terminal, including
        // the ones the endpoint writes itself when it finds a row
        // abandoned past 15 minutes.
        if (!cancelled && body.status && body.status !== 'pending' && body.status !== 'running') {
          if (settled.current) return;
          settled.current = true;
          router.refresh();
        }
      } catch {
        // A failed poll is not a failed audit — the tab may have been
        // backgrounded, or the network may have blinked. Keep polling.
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auditId, router]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const clock = `${minutes}:${String(seconds).padStart(2, '0')}`;

  return (
    <div className="grid gap-4" aria-live="polite">
      <p className="text-sm text-muted-foreground">{labels.body}</p>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={labels.title}
        // No aria-valuenow: the bar is indeterminate, and claiming a
        // value here would announce a number we do not have to anyone
        // using a screen reader.
      >
        <div className="h-full w-1/3 animate-[audit-sweep_1.6s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>

      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="text-muted-foreground transition-opacity duration-500">
          {labels.phases[phase] ?? ''}
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {labels.elapsed} {clock}
        </span>
      </div>

      <style>{`
        @keyframes audit-sweep {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </div>
  );
}
