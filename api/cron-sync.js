const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Protect against unauthorized calls
  const authHeader = req.headers['authorization'];
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Fetch all active clients with a Google Place ID
    const clientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&google_place_id=not.is.null&select=id,business_name,country,google_place_id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const clients = await clientsRes.json();

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(200).json({ synced: 0, message: 'No clients to sync' });
    }

    const results = [];

    for (const client of clients) {
      try {
        const syncRes = await fetch('https://repuguard.app/api/fetch-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName: client.business_name,
            location: client.country,
            clientId: client.id,
          }),
        });
        const data = await syncRes.json();
        results.push({ clientId: client.id, success: true, reviewsFetched: data.reviewsFetched });
      } catch (err) {
        results.push({ clientId: client.id, success: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    console.log(`Cron sync complete: ${succeeded}/${clients.length} clients synced`);

    return res.status(200).json({ synced: succeeded, total: clients.length, results });
  } catch (err) {
    console.error('Cron sync error:', err);
    return res.status(500).json({ error: err.message });
  }
};
