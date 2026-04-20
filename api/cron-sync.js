const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const THROTTLE_MS = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Always require CRON_SECRET — never allow unauthenticated access
  const auth = req.headers['authorization'] || '';
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

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
        const syncRes = await fetch(`${baseUrl}/api/fetch-reviews`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CRON_SECRET}`,
          },
          body: JSON.stringify({ businessName: client.business_name, location: client.country, clientId: client.id }),
        });
        const data = await syncRes.json();
        results.push({ clientId: client.id, success: true, reviewsFetched: data.reviewsFetched || 0 });
      } catch (err) {
        results.push({ clientId: client.id, success: false, error: err.message });
      }

      await sleep(THROTTLE_MS);
    }

    const succeeded = results.filter(r => r.success).length;
    console.log(`Cron sync done: ${succeeded}/${clients.length}`);
    return res.status(200).json({ synced: succeeded, total: clients.length, results });

  } catch (err) {
    console.error('Cron sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
