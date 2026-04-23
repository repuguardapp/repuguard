import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Atomically insert event id — returns true if newly inserted, false if duplicate
async function claimEvent(eventId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/processed_webhook_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=representation,resolution=ignore-duplicates',
    },
    body: JSON.stringify({ id: eventId }),
  });
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function patchClient(filter, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/clients?${filter}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
}

async function getClientByEmail(email) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&select=*`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY },
  });
  const rows = await res.json();
  return rows[0] || null;
}

async function sendEmail(type, client, extra = {}) {
  try {
    await fetch('https://repuguard.app/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, email: client.email, firstName: client.first_name, businessName: client.business_name, lang: client.lang || 'fr', ...extra }),
    });
  } catch (e) {
    console.error('Email error:', e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  // Vercel provides req.rawBody (Buffer) for serverless functions — required for Stripe HMAC
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ error: 'Raw body unavailable' });

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Déduplication atomique — insert-or-skip via unique constraint
  if (!(await claimEvent(event.id))) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {

      case 'invoice.paid': {
        const invoice = event.data.object;
        const customer = await stripe.customers.retrieve(invoice.customer);
        const client = await getClientByEmail(customer.email);
        if (client) {
          const patch = { active: true, subscription_status: 'active', stripe_customer_id: invoice.customer };
          if (invoice.subscription) {
            const sub = await stripe.subscriptions.retrieve(invoice.subscription);
            if (sub?.current_period_end) patch.current_period_end = new Date(sub.current_period_end * 1000).toISOString();
          }
          await patchClient(`email=eq.${encodeURIComponent(customer.email)}`, patch);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customer = await stripe.customers.retrieve(invoice.customer);
        const client = await getClientByEmail(customer.email);
        if (client) {
          await patchClient(`email=eq.${encodeURIComponent(customer.email)}`, {
            subscription_status: 'payment_failed',
          });
          await sendEmail('payment_failed', client);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const client = await getClientByEmail(customer.email);
        if (client) {
          await patchClient(`email=eq.${encodeURIComponent(customer.email)}`, {
            active: false,
            subscription_status: 'cancelled',
          });
          await sendEmail('cancelled', client);
        }
        break;
      }

      case 'customer.subscription.trial_will_end': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        const client = await getClientByEmail(customer.email);
        if (client) {
          await sendEmail('trial_ending', client, {
            trialEnd: new Date(sub.trial_end * 1000).toLocaleDateString('fr-FR'),
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customer = await stripe.customers.retrieve(sub.customer);
        await patchClient(`email=eq.${encodeURIComponent(customer.email)}`, {
          subscription_status: sub.status,
          active: sub.status === 'active' || sub.status === 'trialing',
          current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        });
        break;
      }
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: err.message });
  }
};
