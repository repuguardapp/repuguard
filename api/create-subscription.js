import Stripe from 'stripe';

// Keep in sync with PRICE_TO_PLAN in stripe-webhook.js
const PRICE_IDS = {
  starter:  process.env.STRIPE_PRICE_STARTER  || 'price_1TJfMs4AfFLajYNswedRcOT5',
  pro:      process.env.STRIPE_PRICE_PRO      || 'price_1TJfOW4AfFLajYNsmOvVBxGj',
  business: process.env.STRIPE_PRICE_BUSINESS || 'price_1TJfPU4AfFLajYNsJtTIsjl3',
};
const VALID_PRICE_IDS = new Set(Object.values(PRICE_IDS));

const STRIPE_FR = {
  card_declined:                    'Carte refusée par votre banque. Contactez votre banque ou utilisez une autre carte.',
  insufficient_funds:               'Fonds insuffisants sur la carte.',
  expired_card:                     'Carte expirée. Veuillez utiliser une autre carte.',
  incorrect_cvc:                    'Code CVV incorrect.',
  incorrect_number:                 'Numéro de carte invalide.',
  invalid_expiry_year:              "Date d'expiration invalide.",
  invalid_expiry_month:             "Date d'expiration invalide.",
  payment_method_already_attached:  'Cette carte est déjà enregistrée. Réessayez.',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Guard: fail fast with a readable JSON error if Stripe is not configured
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Configuration Stripe manquante. Contactez le support.' });
  }

  // Instantiate inside the handler so a missing key returns JSON instead of crashing at module load
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Rollback: cancel a subscription if Supabase account creation failed after Stripe succeeded
    if (req.body?.action === 'cancel') {
      const { subscriptionId, email } = req.body;
      if (!subscriptionId || !email) return res.status(400).json({ error: 'Paramètres manquants' });
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const customer = await stripe.customers.retrieve(sub.customer);
      if (customer.email.toLowerCase() !== email.toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      await stripe.subscriptions.cancel(subscriptionId);
      return res.status(200).json({ cancelled: true });
    }

    const { paymentMethodId, priceId, email, name } = req.body || {};

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
      // Attach only if not already attached to this customer
      try {
        await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
      } catch (attachErr) {
        if (attachErr.code !== 'payment_method_already_attached') throw attachErr;
      }
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
    });

    return res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status,
      trialEnd: subscription.trial_end,
    });

  } catch (error) {
    console.error('Stripe error:', error);
    const code = error.raw?.code || error.code;
    const msg = STRIPE_FR[code] || error.message || 'Erreur lors du paiement. Veuillez réessayer.';
    return res.status(400).json({ error: msg });
  }
}
