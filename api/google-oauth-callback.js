import crypto from 'crypto';

const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_KEY        = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_CLIENT_ID    = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET= process.env.GOOGLE_CLIENT_SECRET;
const ENC_KEY_HEX         = process.env.TOKEN_ENCRYPTION_KEY || '';

function getEncKey() {
  if (ENC_KEY_HEX.length !== 64) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex chars');
  return Buffer.from(ENC_KEY_HEX, 'hex');
}

function encrypt(text) {
  const key = getEncKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc  = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag  = cipher.getAuthTag();
  return [iv, tag, enc].map(b => b.toString('hex')).join(':');
}

export default async function handler(req, res) {
  const { code, state: userId, error } = req.query;

  if (error) return res.redirect('/dashboard?gbp_error=' + encodeURIComponent(error));
  if (!code || !userId) return res.redirect('/dashboard?gbp_error=invalid_callback');

  try {
    // 1. Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri:  'https://repuguard.app/api/google-oauth-callback',
        grant_type:    'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('GBP token exchange error:', tokenData.error);
      return res.redirect('/dashboard?gbp_error=' + encodeURIComponent(tokenData.error));
    }

    const { access_token, refresh_token } = tokenData;
    if (!refresh_token) return res.redirect('/dashboard?gbp_error=no_refresh_token');

    // 2. Fetch GBP accounts
    const accountsRes = await fetch('https://mybusiness.googleapis.com/v4/accounts', {
      headers: { 'Authorization': 'Bearer ' + access_token },
    });
    const accountsData = await accountsRes.json();
    const account = accountsData.accounts?.[0];
    if (!account) return res.redirect('/dashboard?gbp_error=no_gbp_account');

    // 3. Get client's google_place_id for location matching
    const clientRes = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${userId}&select=google_place_id`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const clients = await clientRes.json();
    const placeId = clients[0]?.google_place_id;

    // 4. Fetch GBP locations and match by Place ID in metadata
    const locRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${account.name}/locations?readMask=name,metadata`,
      { headers: { 'Authorization': 'Bearer ' + access_token } }
    );
    const locData = await locRes.json();
    const locations = locData.locations || [];

    const matched = placeId
      ? locations.find(l => l.metadata?.mapsUri?.includes(placeId) || l.metadata?.placeId === placeId)
      : null;
    const location = matched || locations[0];
    const gbpLocationName = location?.name || account.name;

    // 5. Store encrypted refresh token and location
    await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        gbp_refresh_token: encrypt(refresh_token),
        gbp_location_name: gbpLocationName,
      }),
    });

    return res.redirect('/dashboard?gbp=connected');

  } catch (err) {
    console.error('GBP OAuth callback error:', err);
    return res.redirect('/dashboard?gbp_error=server_error');
  }
}
