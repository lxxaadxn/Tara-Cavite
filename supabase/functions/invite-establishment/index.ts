import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ADMIN_RESERVED_EMAILS = [
  'taracavite.app@gmail.com',
  'forcapstone111@gmail.com',
];

type InviteBody = {
  email?: string;
  businessName?: string;
  fullName?: string;
  businessType?: string;
  lgu?: string;
  address?: string;
  phone?: string;
  redirectTo?: string;
  resend?: boolean;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function trim(value: unknown) {
  return String(value ?? '').trim();
}

function safeRedirectTo(raw: unknown) {
  try {
    const url = new URL(trim(raw));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.pathname = '/establishment/setup';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, { error: 'Missing Supabase environment on the Edge Function.' });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) {
    return json(401, { error: 'Sign in as the Tourism Office admin first.' });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_cavitour_session_admin');
  if (adminErr || isAdmin !== true) {
    return json(403, { error: 'Only the Tourism Office admin can invite establishments.' });
  }

  let body: InviteBody = {};
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const email = trim(body.email).toLowerCase();
  const businessName = trim(body.businessName);
  const fullName = trim(body.fullName);
  const businessType = trim(body.businessType);
  const lgu = trim(body.lgu);
  const address = trim(body.address);
  const phone = trim(body.phone);
  const redirectTo = safeRedirectTo(body.redirectTo);
  const resend = body.resend === true;

  if (!email || !email.includes('@')) {
    return json(400, { error: 'Establishment email is required.' });
  }
  if (ADMIN_RESERVED_EMAILS.some((reserved) => reserved.toLowerCase() === email.toLowerCase())) {
    return json(400, { error: 'That email is reserved for the Tourism Office admin.' });
  }
  if (!resend && !businessName) {
    return json(400, { error: 'Establishment name is required.' });
  }
  if (!redirectTo) {
    return json(400, { error: 'A valid setup link origin is required.' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existingOwner } = await admin
    .from('establishment_owners')
    .select('id, email, verification_status, setup_completed_at, account_status, business_name')
    .ilike('email', email)
    .maybeSingle();

  if (resend) {
    if (!existingOwner) {
      return json(404, { error: 'No invited establishment found for that email.' });
    }
    if (existingOwner.setup_completed_at || existingOwner.verification_status !== 'invited') {
      return json(400, { error: 'This establishment already finished setup. Use the profile instead of resending.' });
    }
    const sent = await sendSetupEmail(admin, supabaseUrl, anonKey, email, redirectTo, false);
    if (!sent.ok) return json(400, { error: sent.error });
    await admin
      .from('establishment_owners')
      .update({ invited_at: new Date().toISOString() })
      .eq('id', existingOwner.id);
    return json(200, { ok: true, resent: true, ownerId: existingOwner.id });
  }

  if (existingOwner) {
    return json(409, {
      error: 'That email already belongs to an establishment account. Open it from All Establishments.',
    });
  }

  const { data: traveler } = await admin.from('users').select('id, email').ilike('email', email).maybeSingle();
  if (traveler) {
    return json(409, {
      error: 'That email already belongs to a traveler account. Use a different establishment email.',
    });
  }

  const inviteMeta = {
    role: 'establishment',
    full_name: fullName,
    business_name: businessName,
  };

  const invited = await admin.auth.admin.inviteUserByEmail(email, {
    data: inviteMeta,
    redirectTo,
  });

  let userId = invited.data.user?.id ?? '';
  if (invited.error || !userId) {
    const already = /already|registered|exists/i.test(invited.error?.message ?? '');
    if (!already) {
      return json(400, { error: invited.error?.message ?? 'Could not send the invitation email.' });
    }
    const existingAuth = await findAuthUserByEmail(admin, email);
    if (!existingAuth) {
      return json(400, { error: invited.error?.message ?? 'Could not send the invitation email.' });
    }
    userId = existingAuth.id;
    const sent = await sendSetupEmail(admin, supabaseUrl, anonKey, email, redirectTo, true);
    if (!sent.ok) return json(400, { error: sent.error });
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await admin.from('establishment_owners').upsert(
    {
      id: userId,
      email,
      full_name: fullName || null,
      phone: phone || null,
      business_name: businessName,
      business_type: businessType || null,
      lgu: lgu || null,
      address: address || null,
      auth_provider: 'email',
      verification_status: 'invited',
      account_status: 'active',
      public_visible: false,
      invited_at: now,
      setup_completed_at: null,
    },
    { onConflict: 'id' }
  );
  if (upsertErr) {
    return json(400, { error: upsertErr.message });
  }

  return json(200, { ok: true, ownerId: userId });
});

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<{ id: string } | null> {
  const getByEmail = (
    admin.auth.admin as { getUserByEmail?: (value: string) => Promise<{ data: { user?: { id?: string } } | null }> }
  ).getUserByEmail;
  if (typeof getByEmail === 'function') {
    const { data } = await getByEmail(email);
    const id = data?.user?.id;
    if (id) return { id };
  }
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const found = (data.users ?? []).find((u) => (u.email ?? '').trim().toLowerCase() === email);
    if (found?.id) return { id: found.id };
    if ((data.users ?? []).length < 200) break;
  }
  return null;
}

async function sendSetupEmail(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string,
  recoveryFallback: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!recoveryFallback) {
    const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (!invited.error) return { ok: true };
    if (!/already|registered|exists/i.test(invited.error.message ?? '')) {
      return { ok: false, error: invited.error.message };
    }
  }
  const recover = await fetch(`${supabaseUrl}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, gotrue_meta_security: {}, redirect_to: redirectTo }),
  });
  if (!recover.ok) {
    const text = await recover.text();
    return { ok: false, error: text || 'Could not resend the setup email.' };
  }
  return { ok: true };
}
