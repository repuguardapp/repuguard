import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Is this browser signed in? Yes or no, and nothing else.
 *
 * WHY THIS EXISTS
 *
 * The locale layout used to call getCurrentUser() to choose between
 * "Sign in / Start an audit" and "My dashboard / Sign out". A layout that
 * reads cookies is dynamic, and `dynamic` on a layout applies to every
 * route beneath it — so all 524 pages of the site rendered on demand. The
 * comment above it claimed nested pages were "still prerendered". They
 * were not: the build reported 524 static pages and wrote one HTML file
 * to disk. Two header buttons were costing us the entire static site.
 *
 * So the header asks instead, and the answer comes from the same
 * getCurrentUser() as every protected page. One definition of "signed
 * in", including the time-box and the idle timeout — a second one,
 * evaluated in the browser against the Supabase cookie, would drift and
 * would tell someone they are signed in while the server has already
 * expired them.
 *
 * WHAT IT DOES NOT RETURN
 *
 * The user. No id, no email, no claim. The header needs one bit to pick
 * between two pairs of buttons, and an endpoint reachable without
 * authentication returns exactly that bit. Anything more would be a
 * profile endpoint nobody asked for.
 */
export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json(
    { signedIn: !!user },
    // Never cached, anywhere. A shared cache holding "signedIn: true"
    // would hand one visitor's header to the next.
    { headers: { 'cache-control': 'no-store, private' } }
  );
}
