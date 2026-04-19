const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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
      body: JSON.stringify({ type, email: client.email, firstName: client.first_name, businessName: client.business_name, ...extra }),
    });
  } catch (e) {
    console.error('Email error:', e);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case 'invoice.paid': {
        const invoice = event.data.object;
        const customer = await stripe.customers.retrieve(invoice.customer);
        const client = await getClientByEmail(customer.email);
        if (client) {
          await patchClient(`email=eq.${encodeURIComponent(customer.email)}`, {
            active: true,
            subscription_status: 'active',
            stripe_customer_id: invoice.customer,
          });
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
