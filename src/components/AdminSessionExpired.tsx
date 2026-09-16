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
            Session administrateur expirée
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            Tu es connecté avec {email ?? 'ce compte'} et tu es bien sur la liste
            d&apos;autorisation, mais les pages d&apos;administration exigent une session ouverte
            depuis moins de {hours} heures. Approuver une fiche publie une affirmation juridique
            sous notre nom en sept langues — ce n&apos;est pas une décision qu&apos;une session
            laissée ouverte toute la nuit doit pouvoir prendre.
          </p>
          <p className="text-sm text-muted-foreground">
            Déconnecte-toi et reconnecte-toi avec la même adresse. Ta session ordinaire du tableau
            de bord n&apos;est affectée ni dans un cas ni dans l&apos;autre.
          </p>
          <form action="/api/auth/signout" method="post">
            <Button type="submit" size="sm">
              Se déconnecter et recommencer
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
