export const config = { runtime: ‘edge’ };

export default async function handler(req) {
const headers = {
‘Access-Control-Allow-Origin’: ‘*’,
‘Content-Type’: ‘application/json’,
};

if (req.method === ‘OPTIONS’) {
return new Response(null, { status: 204, headers });
}

try {
const body = await req.json();
const paymentMethodId = body.paymentMethodId;
const priceId = body.priceId;
const email = body.email;
const name = body.name;

```
const stripeKey = process.env.STRIPE_SECRET_KEY;

const customerRes = await fetch('https://api.stripe.com/v1/customers', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + stripeKey,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'email=' + encodeURIComponent(email) + '&name=' + encodeURIComponent(name) + '&payment_method=' + encodeURIComponent(paymentMethodId) + '&invoice_settings[default_payment_method]=' + encodeURIComponent(paymentMethodId),
});

const customer = await customerRes.json();
if (customer.error) {
  return new Response(JSON.stringify({ error: customer.error.message }), { status: 400, headers });
}

const subRes = await fetch('https://api.stripe.com/v1/subscriptions', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + stripeKey,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: 'customer=' + encodeURIComponent(customer.id) + '&items[0][price]=' + encodeURIComponent(priceId) + '&trial_period_days=14&expand[]=latest_invoice.payment_intent',
});

const subscription = await subRes.json();
if (subscription.error) {
  return new Response(JSON.stringify({ error: subscription.error.message }), { status: 400, headers });
}

return new Response(JSON.stringify({ 
  success: true,
  subscriptionId: subscription.id,
  customerId: customer.id
}), { status: 200, headers });
```

} catch (err) {
return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
}
}
