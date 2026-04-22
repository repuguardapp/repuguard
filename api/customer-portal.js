import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token }
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Unauthorized' });

    const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${user.id}&select=stripe_customer_id`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY }
    });
    const clients = await clientRes.json();
    if (!clients.length || !clients[0].stripe_customer_id) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: clients[0].stripe_customer_id,
      return_url: 'https://repuguard.app/dashboard',
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Customer portal error:', err);
    return res.status(500).json({ error: err.message });
  }
}
