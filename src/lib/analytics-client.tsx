'use client';

import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { useEffect, type ReactNode } from 'react';

/**
 * Browser-side PostHog wrapper.
 *
 * Two privacy-preserving knobs that matter for the GDPR posture of
 * a RegTech product:
 *
 *   • respect_dnt: true — if the visitor enables Do Not Track in
 *     their browser, posthog-js refuses to send anything. Above and
 *     beyond what GDPR strictly requires, but the right default for
 *     a product whose value proposition IS privacy.
 *
 *   • person_profiles: 'identified_only' — anonymous visitors do
 *     NOT create a PostHog person profile. We only start tracking
 *     a person once they've identified themselves (signup, login),
 *     which keeps the count-of-profiles bill predictable and avoids
 *     hoarding behavioural data on tyre-kickers who never converted.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';
    if (!key) return;
    posthog.init(key, {
      api_host: host,
      person_profiles: 'identified_only',
      capture_pageview: true,
      capture_pageleave: true,
      respect_dnt: true,
      autocapture: false,
      disable_session_recording: true,
      loaded: (ph) => {
        if (process.env.NODE_ENV === 'development') ph.debug();
      }
    });
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}

export function captureClientEvent(name: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.capture(name, props);
}

export function identifyClient(distinctId: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  posthog.identify(distinctId, props);
}
