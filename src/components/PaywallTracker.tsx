'use client';

import { useEffect } from 'react';
import { captureClientEvent } from '@/lib/analytics-client';

/**
 * Zero-render analytics beacon for the paywall view.
 *
 * Mounted only when the server-rendered dashboard audit page has
 * decided to paywall the report (paywalled=true). Firing on
 * useEffect means the event captures actual viewport delivery —
 * not just a route hit — so PostHog's funnel can distinguish a
 * page-load from a paywall surface. The component returns null
 * because the wall itself is rendered server-side; we're only
 * here to instrument it.
 *
 * Properties intentionally minimal: the audit id and the count
 * of withheld findings. We do NOT forward any finding text,
 * scoring, or framework data — those are paywalled content and
 * must not leak into the browser-bound analytics payload even
 * by accident.
 */
interface Props {
  auditId: string;
  hiddenCount: number;
}

export function PaywallTracker({ auditId, hiddenCount }: Props) {
  useEffect(() => {
    captureClientEvent('paywall_viewed', {
      audit_id: auditId,
      hidden_findings_count: hiddenCount
    });
    // We intentionally fire once per mount. Auditing the same
    // audit twice in a session is two distinct "paywall views"
    // — PostHog's funnel treats first-occurrence per user
    // automatically, so emitting both is correct (not
    // duplicated).
  }, [auditId, hiddenCount]);

  return null;
}
