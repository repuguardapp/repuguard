import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase-server';

const PRICE_TO_PLAN: Record<string, string> = {};

function buildPriceMap() {
  if (process.env.STRIPE_PRICE_STARTER)  PRICE_TO_PLAN[process.env.STRIPE_PRICE_STARTER]  = 'starter';
  if (process.env.STRIPE_PRICE_PRO)      PRICE_TO_PLAN[process.env.STRIPE_PRICE_PRO]      = 'pro';
  if (process.env.STRIPE_PRICE_BUSINESS) PRICE_TO_PLAN[process.env.STRIPE_PRICE_BUSINESS] = 'business';
}

export async function POST(req: NextRequest) {
  buildPriceMap();

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe non configuré' }, { status: 500 });
  }

  const body = await req.text();
  const sig  = req.headers.get('stripe-signature') ?? '';

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(stripeKey);
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const db = createServiceClient();

  const { data: already } = await db
    .from('stripe_events')
    .select('id')
    .eq('id', event.id)
    .maybeSingle();
  if (already) return NextResponse.json({ ok: true, skipped: true });

  try {
    await handleEvent(db, event);
    await db.from('stripe_events').insert({ id: event.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    await db.from('error_logs').insert({
      source: 'stripe-webhook',
      message,
      payload: { eventId: event.id, type: event.type },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleEvent(db: ReturnType<typeof createServiceClient>, event: Stripe.Event) {
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.client_reference_id;
      if (!orgId || !session.subscription) break;

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = sub.items.data[0]?.price.id ?? '';
      const plan = PRICE_TO_PLAN[priceId] ?? 'starter';

      await db.from('subscriptions').upsert({
        org_id:                 orgId,
        stripe_customer_id:     session.customer as string,
        stripe_subscription_id: sub.id,
        plan,
        status:                 sub.status,
        trial_ends_at:          sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
        current_period_end:     new Date(sub.current_period_end * 1000).toISOString(),
        updated_at:             new Date().toISOString(),
      }, { onConflict: 'org_id' });
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const priceId = sub.items.data[0]?.price.id ?? '';
      const plan = PRICE_TO_PLAN[priceId] ?? 'starter';

      await db.from('subscriptions')
        .update({
          plan,
          status:             sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
          updated_at:         new Date().toISOString(),
        })
        .eq('stripe_subscription_id', sub.id);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = typeof invoice.subscription === 'string'
        ? invoice.subscription
        : invoice.subscription?.id;
      if (subId) {
        await db.from('subscriptions')
          .update({ status: 'past_due', updated_at: new Date().toISOString() })
          .eq('stripe_subscription_id', subId);
      }
      break;
    }

    default:
      break;
  }
}
