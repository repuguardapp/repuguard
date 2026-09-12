import { NextResponse } from 'next/server';
import { isAdminEmail } from '@/lib/admin';
import { getCurrentUser } from '@/lib/supabase-server';

/**
 * Why the admin queue is or is not showing you anything.
 *
 * /admin/legal-queue answers 404 to anyone who is not on the
 * allowlist, which is the right posture — an internal tool should not
 * confirm it exists — and a terrible diagnostic. Three different
 * problems produce the same blank result: not signed in, signed in as
 * the wrong address, or ADMIN_EMAILS never configured. Guessing
 * between them is exactly the kind of blind debugging this codebase
 * keeps paying for.
 *
 * This endpoint tells you which one, and leaks nothing while doing it:
 * it only ever describes the caller's OWN session. It never returns
 * the allowlist, only whether one exists and whether you are on it.
 * An anonymous caller learns nothing they did not already know.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();

  // Whether an allowlist is configured at all is not a secret — it is
  // a deployment fact, and it is the single commonest reason the queue
  // is empty for its owner.
  const allowlistConfigured = Boolean(process.env.ADMIN_EMAILS);

  if (!user) {
    return NextResponse.json(
      {
        signedIn: false,
        isAdmin: false,
        allowlistConfigured,
        hint: 'No session on this request. Sign in at /login first — the admin page reads the same cookie.'
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const isAdmin = isAdminEmail(user.email);

  return NextResponse.json(
    {
      signedIn: true,
      // Your own address, back to you. Reading it here is how you catch
      // being signed in as a different account than you assumed.
      signedInAs: user.email ?? null,
      isAdmin,
      allowlistConfigured,
      hint: isAdmin
        ? 'You are on the allowlist. /admin/legal-queue will render.'
        : allowlistConfigured
          ? 'ADMIN_EMAILS is set but does not contain this address. Compare it character for character — matching is case-insensitive but whitespace and commas are not forgiving.'
          : 'ADMIN_EMAILS is not set in this environment. Add it in Vercel and redeploy — an unset allowlist means nobody is an admin, by design.'
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
