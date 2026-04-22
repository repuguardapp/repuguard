import crypto from 'crypto';

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_KEY         = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const ENC_KEY_HEX          = process.env.TOKEN_ENCRYPTION_KEY || '';

function decrypt(stored) {
  if (!stored || ENC_KEY_HEX.length !== 64) throw new Error('Token décryptage impossible');
  const key = Buffer.from(ENC_KEY_HEX, 'hex');
  const [ivHex, tagHex, encHex] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

async function getAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error || 'Échec du rafraîchissement du token');
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  const token = auth.slice(7);

  try {
    // Verify JWT
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + token },
    });
    const user = await userRes.json();
    if (!user.id) return res.status(401).json({ error: 'Unauthorized' });

    const { reviewId, replyText } = req.body;
    if (!reviewId || !replyText) return res.status(400).json({ error: 'reviewId et replyText requis' });

    const safeReply = String(replyText).slice(0, 4000).trim();
    if (!safeReply) return res.status(400).json({ error: 'Réponse vide' });

    // Fetch client GBP credentials
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${user.id}&select=gbp_refresh_token,gbp_location_name,business_name`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const clients = await clientRes.json();
    const client = clients[0];

    if (!client?.gbp_refresh_token || !client?.gbp_location_name) {
      return res.status(403).json({ error: 'Google Business Profile non connecté — activez les réponses directes dans Plateformes' });
    }

    // Fetch the review from DB to get author, date, rating for matching
    const reviewRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reviews?id=eq.${reviewId}&client_id=eq.${user.id}&select=author,date,rating,text`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const reviews = await reviewRes.json();
    const review = reviews[0];
    if (!review) return res.status(404).json({ error: 'Avis non trouvé' });

    // Get fresh access token
    const refreshToken = decrypt(client.gbp_refresh_token);
    const accessToken = await getAccessToken(refreshToken);

    // Fetch GBP reviews to find the matching native reviewId
    const gbpReviewsRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${client.gbp_location_name}/reviews?pageSize=50`,
      { headers: { 'Authorization': 'Bearer ' + accessToken } }
    );
    const gbpReviewsData = await gbpReviewsRes.json();
    const gbpReviews = gbpReviewsData.reviews || [];

    // Match by author name + star rating + approximate date (within 48h)
    const reviewDate = new Date(review.date).getTime();
    const matched = gbpReviews.find(r => {
      const gbpDate = new Date(r.createTime).getTime();
      const authorMatch = (r.reviewer?.displayName || '').toLowerCase().includes((review.author || '').toLowerCase().split(' ')[0]);
      const ratingMatch = r.starRating === ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][review.rating || 0];
      const dateClose = Math.abs(gbpDate - reviewDate) < 48 * 3600 * 1000;
      return (authorMatch || dateClose) && ratingMatch;
    });

    if (!matched) {
      return res.status(404).json({ error: 'Avis introuvable dans Google Business Profile — il sera disponible après la prochaine synchronisation' });
    }

    // Extract reviewId from resource name (accounts/.../locations/.../reviews/{reviewId})
    const gbpReviewId = matched.name.split('/').pop();

    // Post reply to Google Business Profile
    const replyRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${client.gbp_location_name}/reviews/${gbpReviewId}/reply`,
      {
        method: 'PUT',
        headers: {
          'Authorization':  'Bearer ' + accessToken,
          'Content-Type':   'application/json',
        },
        body: JSON.stringify({ comment: safeReply }),
      }
    );

    if (!replyRes.ok) {
      const errData = await replyRes.json().catch(() => ({}));
      return res.status(502).json({ error: errData.error?.message || `Google API error ${replyRes.status}` });
    }

    // Mark review as responded in DB
    await fetch(`${SUPABASE_URL}/rest/v1/reviews?id=eq.${reviewId}&client_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        needs_response: false,
        responded_at:   new Date().toISOString(),
      }),
    });

    return res.status(200).json({ success: true, published: true, reviewId: gbpReviewId });

  } catch (err) {
    console.error('Publish reply error:', err);
    return res.status(500).json({ error: err.message });
  }
}
