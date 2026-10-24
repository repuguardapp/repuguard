import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase-server';

const PRICE_IDS = () => ({
  starter:  process.env.STRIPE_PRICE_STARTER  ?? '',
  pro:      process.env.STRIPE_PRICE_PRO      ?? '',
  business: process.env.STRIPE_PRICE_BUSINESS ?? '',
});

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({ error: 'Configuration Stripe manquante.' }, { status: 500 });
  }

  const body = await req.json() as { plan: string; locale?: string; orgId?: string };
  const { plan, locale = 'fr', orgId } = body;

  const prices = PRICE_IDS();
  const priceId = prices[plan as keyof typeof prices];
  if (!priceId) {
    return NextResponse.json({ error: 'Plan invalide.' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://repuguard.app';

  const stripe = new Stripe(stripeKey);
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: { trial_period_days: 7 },
    success_url: `${appUrl}/${locale}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${appUrl}/${locale}/pricing`,
    ...(orgId ? { client_reference_id: orgId } : {}),
    locale: locale === 'fr' ? 'fr' : locale === 'es' ? 'es' : locale === 'de' ? 'de' : locale === 'pt-br' ? 'pt-BR' : 'en',
  });

  return NextResponse.json({ id: session.id, url: session.url });
}
