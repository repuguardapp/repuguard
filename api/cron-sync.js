const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const THROTTLE_MS = 2000; // 2s between clients to respect API rate limits

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // CRON_SECRET obligatoire en production
  if (!CRON_SECRET) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  const auth = req.headers['authorization'] || '';
  if (auth !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const clientsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&google_place_id=not.is.null&select=id,business_name,country,lang,trustpilot_business_id,tripadvisor_location_id,auto_respond_5star`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const clients = await clientsRes.json();

    if (!Array.isArray(clients) || clients.length === 0) {
      return res.status(200).json({ synced: 0, message: 'No clients to sync' });
    }

    const results = [];
    const baseUrl = process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'https://repuguard.app';

    for (const client of clients) {
      try {
        const syncRes = await fetch(`${baseUrl}/api/fetch-reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
          body: JSON.stringify({ businessName: client.business_name, location: client.country, clientId: client.id, lang: client.lang || 'fr', autoRespond5star: !!client.auto_respond_5star }),
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

    // TripAdvisor sync — only for clients who have a TripAdvisor location
    const taClients = clients.filter(c => c.tripadvisor_location_id);
    const taResults = [];
    for (const client of taClients) {
      try {
        const taRes = await fetch(`${baseUrl}/api/fetch-reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
          body: JSON.stringify({ platform: 'tripadvisor', businessName: client.business_name, location: client.country, clientId: client.id, lang: client.lang || 'fr' }),
        });
        const taData = await taRes.json();
        taResults.push({ clientId: client.id, success: true, reviewsFetched: taData.reviewsFetched || 0 });
      } catch (err) {
        taResults.push({ clientId: client.id, success: false, error: err.message });
      }
      await sleep(THROTTLE_MS);
    }
    // Trustpilot sync — only for clients who have connected their account
    const tpClients = clients.filter(c => c.trustpilot_business_id);
    const tpResults = [];
    for (const client of tpClients) {
      try {
        const tpRes = await fetch(`${baseUrl}/api/fetch-reviews`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
          body: JSON.stringify({ platform: 'trustpilot', businessName: client.business_name, location: client.country, clientId: client.id, lang: client.lang || 'fr' }),
        });
        const tpData = await tpRes.json();
        tpResults.push({ clientId: client.id, success: true, reviewsFetched: tpData.reviewsFetched || 0 });
      } catch (err) {
        tpResults.push({ clientId: client.id, success: false, error: err.message });
      }
      await sleep(THROTTLE_MS);
    }

    // J7 trial-ending emails — trial expires in less than 24h
    const j7Start = new Date(Date.now() + 0.5 * 24 * 60 * 60 * 1000).toISOString();
    const j7End   = new Date(Date.now() + 1.5 * 24 * 60 * 60 * 1000).toISOString();
    const j7Res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&trial_ends=gte.${j7Start}&trial_ends=lte.${j7End}&select=email,first_name,business_name,lang`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const j7Clients = await j7Res.json();
    if (Array.isArray(j7Clients) && j7Clients.length > 0) {
      for (const c of j7Clients) {
        fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'trial_ending', email: c.email, firstName: c.first_name, businessName: c.business_name, lang: c.lang || 'fr' }),
        }).catch(e => console.error('J7 email error:', e.message));
      }
    }

    // J1 onboarding emails — envoyé ~24h après l'inscription (trial_ends dans 5.5–6.5 jours)
    const j1Start = new Date(Date.now() + 5.5 * 24 * 60 * 60 * 1000).toISOString();
    const j1End   = new Date(Date.now() + 6.5 * 24 * 60 * 60 * 1000).toISOString();
    const j1Res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&trial_ends=gte.${j1Start}&trial_ends=lte.${j1End}&select=email,first_name,business_name,lang`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const j1Clients = await j1Res.json();
    if (Array.isArray(j1Clients) && j1Clients.length > 0) {
      for (const c of j1Clients) {
        fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'onboarding_j1', email: c.email, firstName: c.first_name, businessName: c.business_name, lang: c.lang || 'fr' }),
        }).catch(e => console.error('J1 email error:', e.message));
      }
    }

    // J2 re-engagement — clients sans avis, trial dans 4.5-5.5 jours (inscrit il y a ~2 jours)
    const j2Start = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString();
    const j2End   = new Date(Date.now() + 5.5 * 24 * 60 * 60 * 1000).toISOString();
    const j2Res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&trial_ends=gte.${j2Start}&trial_ends=lte.${j2End}&select=id,email,first_name,business_name,lang`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const j2Candidates = await j2Res.json();
    let j2_emails = 0;
    if (Array.isArray(j2Candidates) && j2Candidates.length > 0) {
      // Single query to find which j2 candidates already have reviews
      const ids = j2Candidates.map(c => c.id).join(',');
      const rvRes = await fetch(
        `${SUPABASE_URL}/rest/v1/reviews?client_id=in.(${ids})&select=client_id`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
      );
      const rvRows = await rvRes.json();
      const clientsWithReviews = new Set(Array.isArray(rvRows) ? rvRows.map(r => r.client_id) : []);

      for (const c of j2Candidates) {
        if (!clientsWithReviews.has(c.id)) {
          fetch(`${baseUrl}/api/send-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'onboarding_j2', email: c.email, firstName: c.first_name, businessName: c.business_name, lang: c.lang || 'fr' }),
          }).catch(e => console.error('J2 email error:', e.message));
          j2_emails++;
        }
      }
    }

    // J3 onboarding emails — find trialing users on day 3 (trial_ends in 3.5–4.5 days)
    const j3Start = new Date(Date.now() + 3.5 * 24 * 60 * 60 * 1000).toISOString();
    const j3End   = new Date(Date.now() + 4.5 * 24 * 60 * 60 * 1000).toISOString();
    const j3Res = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?active=eq.true&trial_ends=gte.${j3Start}&trial_ends=lte.${j3End}&select=email,first_name,business_name,lang`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const j3Clients = await j3Res.json();
    if (Array.isArray(j3Clients) && j3Clients.length > 0) {
      for (const c of j3Clients) {
        fetch(`${baseUrl}/api/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'onboarding_j3', email: c.email, firstName: c.first_name, businessName: c.business_name, lang: c.lang || 'fr' }),
        }).catch(e => console.error('J3 email error:', e.message));
      }
    }

    // Rapport hebdomadaire — uniquement le lundi (getUTCDay() === 1)
    let weekly_emails = 0;
    if (new Date().getUTCDay() === 1) {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const payingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?active=eq.true&select=id,email,first_name,business_name,lang,google_place_id`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
      );
      const payingClients = await payingRes.json();
      if (Array.isArray(payingClients)) {
        for (const c of payingClients) {
          try {
            // Récupérer les stats des 7 derniers jours
            const reviewsRes = await fetch(
              `${SUPABASE_URL}/rest/v1/reviews?client_id=eq.${c.id}&created_at=gte.${oneWeekAgo}&select=rating,is_negative`,
              { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
            );
            const reviews = await reviewsRes.json();
            const allRes = await fetch(
              `${SUPABASE_URL}/rest/v1/reviews?client_id=eq.${c.id}&select=rating`,
              { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
            );
            const allReviews = await allRes.json();
            const newReviews = Array.isArray(reviews) ? reviews.length : 0;
            const negativeCount = Array.isArray(reviews) ? reviews.filter(r => r.is_negative).length : 0;
            const positiveCount = newReviews - negativeCount;
            const avgRating = Array.isArray(allReviews) && allReviews.length > 0
              ? Math.round((allReviews.reduce((s, r) => s + (r.rating || 0), 0) / allReviews.length) * 10) / 10
              : 0;
            const now = new Date();
            const period = `${now.toLocaleDateString('fr-FR', {day:'2-digit',month:'long'})}`;
            await fetch(`${baseUrl}/api/send-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'report',
                email: c.email,
                firstName: c.first_name,
                businessName: c.business_name,
                lang: c.lang || 'fr',
                reportData: { avgRating, totalReviews: Array.isArray(allReviews) ? allReviews.length : 0, newReviews, negativeCount, positiveCount, period }
              }),
            });
            weekly_emails++;
          } catch(e) { console.error('Weekly report error for', c.email, e.message); }
        }
      }
    }

    return res.status(200).json({
      google: { synced: succeeded, total: clients.length },
      tripadvisor: { synced: taResults.filter(r => r.success).length, total: taClients.length },
      trustpilot: { synced: tpResults.filter(r => r.success).length, total: tpClients.length },
      results,
      j1_emails: Array.isArray(j1Clients) ? j1Clients.length : 0,
      j2_emails,
      j3_emails: Array.isArray(j3Clients) ? j3Clients.length : 0,
      j7_emails: Array.isArray(j7Clients) ? j7Clients.length : 0,
      weekly_emails,
    });

  } catch (err) {
    console.error('Cron sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
