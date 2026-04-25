import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Keep in sync with PRICE_TO_PLAN in stripe-webhook.js
const PRICE_IDS = {
  starter:  process.env.STRIPE_PRICE_STARTER  || 'price_1TJfMs4AfFLajYNswedRcOT5',
  pro:      process.env.STRIPE_PRICE_PRO      || 'price_1TJfOW4AfFLajYNsmOvVBxGj',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_1TJfPU4AfFLajYNsJtTIsjl3',
};
const VALID_PRICE_IDS = new Set(Object.values(PRICE_IDS));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { paymentMethodId, priceId, email, name } = req.body;

    if (!paymentMethodId || !priceId || !email) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

    // Whitelist stricte des price IDs — empêche toute manipulation
    if (!VALID_PRICE_IDS.has(priceId)) {
      return res.status(400).json({ error: 'Plan invalide' });
    }

    // Créer ou récupérer le client Stripe
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customer;

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    } else {
      customer = await stripe.customers.create({ email, name, payment_method: paymentMethodId });
    }

    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: 7,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
    });

    // Patch Supabase immediately so the client record is consistent
    // (webhook will also fire, this is belt-and-suspenders)
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
    if (SUPABASE_URL && SUPABASE_KEY) {
      fetch(`${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          stripe_customer_id: customer.id,
          subscription_status: subscription.status,
        }),
      }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status,
      trialEnd: subscription.trial_end,
    });

  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: error.message || 'Une erreur est survenue' });
  }
}
