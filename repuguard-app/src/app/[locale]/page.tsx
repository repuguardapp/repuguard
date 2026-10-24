import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase-server';

export default async function LocaleHomePage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getCurrentUser();
  if (user) {
    redirect(`/${params.locale}/dashboard`);
  }
  redirect(`/${params.locale}/login`);
}
