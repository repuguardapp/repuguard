const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const THROTTLE_MS = 2000; // 2s between each client to respect Google Places rate limits

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // CRON_SECRET obligatoire en production
  if (!CRON_SECRET) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const clientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&google_place_id=not.is.null&select=id,business_name,country`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const clients = await clientsRes.json();

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(200).json({ synced: 0, message: 'No clients to sync' });
    }

    console.log(`Cron sync starting: ${clients.length} clients`);
    const results = [];
    const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://repuguard.app';

    for (const client of clients) {
      try {
        const syncRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://repuguard.app'}/api/fetch-reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
          body: JSON.stringify({ businessName: client.business_name, location: client.country, clientId: client.id }),
        });
        const data = await syncRes.json();
        results.push({ clientId: client.id, success: true, reviewsFetched: data.reviewsFetched || 0 });
      } catch (err) {
        results.push({ clientId: client.id, success: false, error: err.message });
      }

      // Throttle to avoid hitting Google Places API rate limits
      await sleep(THROTTLE_MS);
    }

    const succeeded = results.filter(r => r.success).length;
    console.log(`Cron sync done: ${succeeded}/${clients.length}`);

    // J3 onboarding emails — find trialing users on day 3 (trial_ends in 3.5–4.5 days)
    const j3Start = new Date(Date.now() + 3.5 * 24 * 60 * 60 * 1000).toISOString();
    const j3End   = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString();
    const j3Res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&trial_ends=gte.${j3Start}&trial_ends=lte.${j3End}&select=email,first_name,business_name,lang`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const j3Clients = await j3Res.json();
    if (Array.isArray(j3Clients) && j3Clients.length > 0) {
      console.log(`Sending J3 onboarding email to ${j3Clients.length} clients`);
      for (const c of j3Clients) {
        fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'onboarding_j3', email: c.email, firstName: c.first_name, businessName: c.business_name, lang: c.lang || 'fr' }),
        }).catch(e => console.error('J3 email error:', e.message));
      }
    }

    return res.status(200).json({ synced: succeeded, total: clients.length, results, j3_emails: Array.isArray(j3Clients) ? j3Clients.length : 0 });

  } catch (err) {
    console.error('Cron sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
