import 'server-only';
import { PostHog } from 'posthog-node';

/**
 * Server-side PostHog client for capturing funnel events from API
 * routes and Server Components.
 *
 * Why a singleton: posthog-node spawns a flush interval timer; one
 * instance per Vercel function invocation is fine, but we cache it
 * inside the function module so cold-start cost is amortised across
 * requests on the same instance.
 *
 * Why EU host: lexyflow.com is GDPR-positioned. PostHog EU
 * (Frankfurt) keeps every event server-side and at-rest in the EU.
 * The public NEXT_PUBLIC_POSTHOG_HOST mirrors this for the browser
 * client (see analytics-client.ts).
 *
 * Why the key check at the boundary: we want a no-op client in dev
 * environments that lack the key, instead of throwing on import. The
 * exported helpers stay sync from the call site's perspective and
 * silently drop the event when the key is unset — the call sites
 * never have to branch on "is analytics enabled".
 */

let cachedClient: PostHog | null = null;
let warnedAboutMissingKey = false;

function client(): PostHog | null {
  if (cachedClient) return cachedClient;
  const key = process.env.POSTHOG_PERSONAL_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';
  if (!key) {
    if (!warnedAboutMissingKey) {
      console.warn('[analytics] POSTHOG key missing — events will be silently dropped.');
      warnedAboutMissingKey = true;
    }
    return null;
  }
  cachedClient = new PostHog(key, {
    host,
    // Flush every event immediately. Server-side, we're inside a
    // short-lived Vercel function invocation; buffering across
    // events risks losing them when the function is recycled. The
    // performance cost is one extra HTTP round-trip per event,
    // worth it for the data-integrity guarantee.
    flushAt: 1,
    flushInterval: 0
  });
  return cachedClient;
}

interface ServerEvent {
  /**
   * Stable per-user identifier — use the Supabase auth user id for
   * authenticated events, or the organization id for events that
   * happen before login (anonymous-org public-share flows). PostHog
   * uses this to stitch the funnel across pages and devices.
   */
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

/**
 * Capture a server-side event. Returns immediately after enqueueing
 * to PostHog's HTTP layer; failures are logged and dropped — the
 * caller's request must never fail because of an analytics outage.
 */
export async function captureServerEvent(e: ServerEvent): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    c.capture({
      distinctId: e.distinctId,
      event: e.event,
      properties: {
        ...(e.properties ?? {}),
        $lib: 'lexyflow-server',
        env: process.env.VERCEL_ENV ?? 'development'
      }
    });
    await c.flush();
  } catch (err) {
    console.warn('[analytics] capture failed', { event: e.event, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Attach the user's org to their PostHog person profile so funnels
 * can be filtered by org-level traits (plan, country, ui_locale).
 * Called from /api/onboarding after the org row is created.
 */
export async function identifyOrg(distinctId: string, orgId: string, traits: Record<string, unknown> = {}): Promise<void> {
  const c = client();
  if (!c) return;
  try {
    c.identify({
      distinctId,
      properties: { organization_id: orgId, ...traits }
    });
    c.groupIdentify({ groupType: 'organization', groupKey: orgId, properties: traits });
    await c.flush();
  } catch (err) {
    console.warn('[analytics] identify failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
