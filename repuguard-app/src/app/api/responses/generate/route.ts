import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createServiceClient } from '@/lib/supabase-server';
import { getLimitsForOrg } from '@/lib/tier';

export async function POST(req: NextRequest) {
  const db = createServiceClient();

  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: org } = await db
    .from('organizations')
    .select('id,name,lang')
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 });

  const limits = await getLimitsForOrg(db, org.id as string);
  if (!limits.ai_responses_enabled) {
    return NextResponse.json({ error: 'Les réponses IA ne sont pas incluses dans votre plan.' }, { status: 402 });
  }

  const body = await req.json() as {
    reviewId: string;
    reviewText?: string;
    author?: string;
    platform?: string;
    rating?: number;
    lang?: string;
  };

  const { reviewId, reviewText, author, platform, rating, lang } = body;
  if (!reviewId) return NextResponse.json({ error: 'reviewId requis' }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  const { count: todayCount } = await db
    .from('reviews')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', org.id)
    .not('responded_at', 'is', null)
    .gte('responded_at', today);

  if ((todayCount ?? 0) >= limits.ai_responses_per_day) {
    return NextResponse.json({
      error: `Quota journalier atteint (${limits.ai_responses_per_day} réponses).`,
    }, { status: 429 });
  }

  const lang_ = lang ?? (org.lang as string) ?? 'fr';
  const platformName = platform ?? 'Google';
  const stars = rating ? `${rating}/5 étoiles` : '';

  const prompt = [
    `Tu es le responsable de "${org.name as string}", un établissement professionnel.`,
    `Rédige une réponse professionnelle, empathique et concise (3-4 phrases max) à cet avis ${platformName} ${stars}.`,
    `Réponse en ${lang_ === 'fr' ? 'français' : lang_}. Ne signe pas, ne mets pas de formule de politesse de fermeture.`,
    author ? `Auteur de l'avis : ${author}.` : '',
    `Avis : "${reviewText ?? ''}"`,
  ].filter(Boolean).join('\n');

  const client = new Anthropic();
  const message = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('');

  if (!text) {
    return NextResponse.json({ error: 'Le modèle n\'a retourné aucun texte.' }, { status: 500 });
  }

  return NextResponse.json({ response: text });
}
