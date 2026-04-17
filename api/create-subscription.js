import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  starter: 'price_1TJfMs4AfFLajYNswedRcOT5',
  pro: 'price_1TJfOW4AfFLajYNsmOvVBxGj',
  business: 'price_1TJfPU4AfFLajYNsJtTIsjl3'
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { paymentMethodId, priceId, email, name } = await req.json();

    if (!paymentMethodId || !priceId || !email) {
      return new Response(JSON.stringify({ error: 'Paramètres manquants' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1. Créer ou récupérer le client Stripe
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customer;

    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      // Attacher le nouveau moyen de paiement
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customer.id });
    } else {
      customer = await stripe.customers.create({
        email,
        name,
        payment_method: paymentMethodId,
      });
    }

    // 2. Définir le moyen de paiement par défaut
    await stripe.customers.update(customer.id, {
      invoice_settings: { default_payment_method: paymentMethodId }
    });

    // 3. Créer l'abonnement avec 14 jours d'essai gratuit
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

    return new Response(JSON.stringify({
      success: true,
      subscriptionId: subscription.id,
      customerId: customer.id,
      status: subscription.status,
      trialEnd: subscription.trial_end
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Stripe error:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Une erreur est survenue'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = { runtime: 'edge' };
