import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ADMIN_SESSION_MAX_AGE_MS } from '@/lib/session-policy';

/**
 * Shown to someone who IS on the allowlist but whose session is older
 * than the admin time-box.
 *
 * This case had no answer of its own and was the worst one to be in.
 * The page redirected to /login, /login saw a perfectly valid ordinary
 * session and sent the visitor to the dashboard, and the admin surface
 * became unreachable with no explanation anywhere in the loop. The
 * ordinary session is valid for thirty days; the admin one for twelve
 * hours; so an allowlisted operator coming back the next morning hits
 * this every single time.
 *
 * Only rendered once the allowlist has already matched, so it reveals
 * nothing to anyone who has no business here — a signed-in stranger
 * still gets 404.
 */
export function AdminSessionExpired({ email }: { email: string | null }) {
  const hours = Math.round(ADMIN_SESSION_MAX_AGE_MS / (60 * 60 * 1000));

  return (
    <div className="mx-auto grid max-w-lg gap-6 px-4 py-16 md:px-0">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5 text-muted-foreground" aria-hidden />
            Admin session expired
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            You are signed in as {email ?? 'this account'} and you are on the allowlist, but admin
            pages require a session opened less than {hours} hours ago. Approving an item publishes
            a legal claim under our name in seven languages, which is not a decision an overnight
            session should be able to take.
          </p>
          <p className="text-sm text-muted-foreground">
            Sign out and sign in again with the same address. Your ordinary dashboard session is
            unaffected either way.
          </p>
          <form action="/api/auth/signout" method="post">
            <Button type="submit" size="sm">
              Sign out and start again
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
