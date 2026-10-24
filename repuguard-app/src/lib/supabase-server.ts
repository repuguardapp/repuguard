import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export function createSessionClient() {
  const cookieStore = cookies();
  return createServerClient(url, anon, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // En Server Component, les cookies sont read-only — ignoré.
        }
      },
    },
  });
}

export function createServiceClient() {
  return createClient(url, svc, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getCurrentUser() {
  const client = createSessionClient();
  const { data: { user } } = await client.auth.getUser();
  return user;
}
