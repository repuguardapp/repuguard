import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  starter: 'price_1TJfMs4AfFLajYNswedRcOT5',
  pro: 'price_1TJfOW4AfFLajYNsmOvVBxGj',
  business: 'price_1TJfPU4AfFLajYNsJtTIsjl3'
};

const VALID_PRICE_IDS = new Set(Object.values(PRICE_IDS));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { paymentMethodId, priceId, email, name } = req.body;

    if (!paymentMethodId || !priceId || !email) {
      return res.status(400).json({ error: 'Paramètres manquants' });
    }

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
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: priceId }],
      trial_period_days: 14,
      payment_settings: {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription'
      },
      expand: ['latest_invoice.payment_intent']
    });

    return res.status(200).json({
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status,
      trialEnd: subscription.trial_end
    });

  } catch (error) {
    console.error('Stripe error:', error);
    return res.status(500).json({ error: error.message || 'Une erreur est survenue' });
  }
}
