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
 */
export function LegalReviewButtons({ developmentId }: { developmentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/admin/legal-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ developmentId, action })
      });
      if (res.status === 409) {
        // Someone else, or another tab, already decided this one.
        setError('Already reviewed — refreshing.');
        router.refresh();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? 'Failed');
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — nothing was changed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={busy !== null} onClick={() => decide('approve')}>
        {busy === 'approve' ? 'Approving…' : 'Approve for publication'}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null}
        onClick={() => decide('reject')}
      >
        {busy === 'reject' ? 'Rejecting…' : 'Reject'}
      </Button>
      {error ? <span className="text-sm text-destructive">{error}</span> : null}
    </div>
  );
}
