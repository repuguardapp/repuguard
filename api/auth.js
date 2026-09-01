export const config = { runtime: 'edge' };

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': 'https://repuguard.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });

  try {
    const body = await req.json();
    const { action, email, password, firstName, lastName, businessName, sector, country, plan, lang, referredBy } = body;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
    const CRON_SECRET = process.env.CRON_SECRET;

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    // Expose plan price IDs to the frontend (prevents hardcoded mismatch)
    if (action === 'plans') {
      return new Response(JSON.stringify({
        starter:  process.env.STRIPE_PRICE_STARTER  || 'price_1TJfMs4AfFLajYNswedRcOT5',
        pro:      process.env.STRIPE_PRICE_PRO      || 'price_1TJfOW4AfFLajYNsmOvVBxGj',
        business: process.env.STRIPE_PRICE_BUSINESS || 'price_1TJfPU4AfFLajYNsJtTIsjl3',
      }), { status: 200, headers });
    }

    if (action === 'signup') {
      if (!email || !EMAIL_RE.test(email)) {
        return new Response(JSON.stringify({ error: 'Adresse email invalide' }), { status: 400, headers });
      }
      if (!password || password.length < 8) {
        return new Response(JSON.stringify({ error: 'Mot de passe trop court (8 caractères minimum)' }), { status: 400, headers });
      }
      // 1. Créer le compte Supabase Auth
      const authRes = await fetch(SUPABASE_URL + '/auth/v1/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        },
        body: JSON.stringify({ email: email, password: password }),
      });
      const authData = await authRes.json();
      if (!authRes.ok || authData.error || authData.msg) {
        const rawMsg = authData.msg
          || (typeof authData.error === 'object' ? authData.error?.message : authData.error)
          || authData.message || '';
        const friendlyMsg = /already registered|already exists|duplicate/i.test(rawMsg)
          ? 'Cet email est déjà utilisé. Connectez-vous ou réinitialisez votre mot de passe.'
          : rawMsg || 'Erreur lors de la création du compte';
        return new Response(JSON.stringify({ error: friendlyMsg }), { status: 400, headers });
      }
      const userId = authData.user?.id ?? authData.id;

      // 2. Créer le profil client dans Supabase
      await fetch(SUPABASE_URL + '/rest/v1/clients', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          id: userId,
          email: email,
          first_name: firstName,
          last_name: lastName,
          business_name: businessName,
          sector: sector,
          country: country,
          plan: plan || 'starter',
          trial_ends: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          active: true,
          lang: lang || 'fr',
        }),
      });

      // 2b. Referral tracking — non-blocking, safe if referred_by column missing
      if (referredBy && /^[A-Z0-9]{6,12}$/.test(referredBy)) {
        fetch(SUPABASE_URL + '/rest/v1/clients?id=eq.' + userId, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_SECRET_KEY,
            'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ referred_by: referredBy }),
        }).catch(() => {});
      }

      // 3. Envoyer l'email de bienvenue + premier sync en parallèle (non bloquant)
      const postSignupTasks = [];

      postSignupTasks.push(
        fetch('https://repuguard.app/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'welcome',
            email: email,
            firstName: firstName,
            businessName: businessName,
            plan: plan || 'starter',
          }),
        }).catch(e => console.error('Email welcome error:', e))
      );

      if (businessName) {
        postSignupTasks.push(
          fetch('https://repuguard.app/api/fetch-reviews', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CRON_SECRET },
            body: JSON.stringify({
              businessName: businessName,
              location: country || '',
              clientId: userId,
              lang: lang || 'fr',
            }),
          }).catch(e => console.error('First sync error:', e))
        );
      }

      // Fire and forget — ne bloque pas la réponse
      Promise.all(postSignupTasks);

      return new Response(JSON.stringify({ success: true, userId: userId }), { status: 200, headers });
    }

    if (action === 'login') {
      if (!email || !EMAIL_RE.test(email)) {
        return new Response(JSON.stringify({ error: 'Adresse email invalide' }), { status: 400, headers });
      }
      const loginRes = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        },
        body: JSON.stringify({ email: email, password: password }),
      });
      const loginData = await loginRes.json();
      if (loginData.error) {
        // Check if the email exists in clients to give a specific message
        const chkRes = await fetch(
          `${SUPABASE_URL}/rest/v1/clients?email=eq.${encodeURIComponent(email)}&select=id`,
          { headers: { 'apikey': SUPABASE_SECRET_KEY, 'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY } }
        );
        const chkRows = await chkRes.json();
        const emailKnown = Array.isArray(chkRows) && chkRows.length > 0;
        const loginErrMsg = emailKnown
          ? 'Mot de passe incorrect.'
          : 'Cet email n\'est pas reconnu. Vérifiez votre adresse ou créez un compte.';
        return new Response(JSON.stringify({ error: loginErrMsg }), { status: 401, headers });
      }
      const u = loginData.user || {};
      return new Response(JSON.stringify({ success: true, token: loginData.access_token, user: { id: u.id, email: u.email, user_metadata: u.user_metadata } }), { status: 200, headers });
    }

    if (action === 'forgot_password') {
      if (!email) return new Response(JSON.stringify({ error: 'Email requis' }), { status: 400, headers });
      await fetch(SUPABASE_URL + '/auth/v1/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + SUPABASE_SECRET_KEY,
        },
        body: JSON.stringify({ email, redirectTo: 'https://repuguard.app/reset-password' }),
      });
      // Always return success to avoid user enumeration
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    if (action === 'reset_password') {
      const { token, password } = body;
      if (!token || !password) return new Response(JSON.stringify({ error: 'Paramètres manquants' }), { status: 400, headers });
      const res = await fetch(SUPABASE_URL + '/auth/v1/user', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SECRET_KEY,
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.error) return new Response(JSON.stringify({ error: data.error.message || 'Erreur' }), { status: 400, headers });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
