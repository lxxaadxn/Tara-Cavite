import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Emails reserved for the Tourism Office — establishments can never use these. */
const ADMIN_RESERVED_EMAILS = [
  'taracavite.app@gmail.com',
  'forcapstone111@gmail.com',
];

type CreateUserBody = {
  email?: string;
  password?: string;
  role?: 'admin' | 'establishment';
  staPlaceId?: string;
  businessName?: string;
  fullName?: string;
  businessType?: string;
  lgu?: string;
  barangay?: string;
  address?: string;
  phone?: string;
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

  // Only allowlisted Tourism Office admins may create accounts.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_cavitour_session_admin');
  if (adminErr || isAdmin !== true) {
    return json(403, { error: 'Only the Tourism Office admin can create accounts.' });
  }

  let body: CreateUserBody = {};
  try {
    body = (await req.json()) as CreateUserBody;
  } catch {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const email = trim(body.email).toLowerCase();
  const password = String(body.password ?? '');
  const role = body.role === 'establishment' ? 'establishment' : 'admin';
  const staPlaceId = trim(body.staPlaceId);

  if (!email || !email.includes('@')) {
    return json(400, { error: 'A valid email address is required.' });
  }
  if (password.length < 6) {
    return json(400, { error: 'Password must be at least 6 characters.' });
  }
  if (staPlaceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(staPlaceId)) {
    return json(400, { error: 'staPlaceId must be a UUID.' });
  }
  if (role === 'establishment' && ADMIN_RESERVED_EMAILS.some((r) => r.toLowerCase() === email)) {
    return json(400, { error: 'That email is reserved for the Tourism Office admin.' });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Reuse an existing auth account (reset its password) or create a fresh one.
  const existing = await findAuthUserByEmail(admin, email);
  let userId = '';
  let updated = false;

  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
    });
    if (error) return json(400, { error: error.message });
    userId = existing.id;
    updated = true;
  } else {
    const userMetadata =
      role === 'establishment'
        ? {
            role: 'establishment',
            full_name: trim(body.fullName),
            business_name: trim(body.businessName),
          }
        : { role: 'admin', full_name: trim(body.fullName) };
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (created.error || !created.data.user?.id) {
      return json(400, { error: created.error?.message ?? 'Could not create the account.' });
    }
    userId = created.data.user.id;
  }

  if (role === 'admin') {
    const { error } = await admin
      .from('cavitour_admin_allowlist')
      .upsert({ email }, { onConflict: 'email' });
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, userId, updated });
  }

  // role === 'establishment': create/link the owner record.
  const { data: traveler } = await admin
    .from('users')
    .select('id, email')
    .ilike('email', email)
    .maybeSingle();
  if (traveler && !existing) {
    return json(409, {
      error: 'That email already belongs to a traveler account. Use a different establishment email.',
    });
  }

  const now = new Date().toISOString();
  const { error: upsertErr } = await admin.from('establishment_owners').upsert(
    {
      id: userId,
      email,
      ...(staPlaceId ? { sta_place_id: staPlaceId } : {}),
      full_name: trim(body.fullName) || null,
      phone: trim(body.phone) || null,
      business_name: trim(body.businessName),
      business_type: trim(body.businessType) || null,
      lgu: trim(body.lgu) || null,
      barangay: trim(body.barangay) || null,
      address: trim(body.address) || null,
      auth_provider: 'email',
      verification_status: 'approved',
      account_status: 'active',
      public_visible: false,
      invited_at: now,
      setup_completed_at: now,
    },
    { onConflict: 'id' }
  );
  if (upsertErr) {
    return json(400, { error: upsertErr.message });
  }

  if (staPlaceId) {
    // Linking to an EXISTING catalog row: force the link after the upsert so a
    // live "auto-create STA row" trigger can never override or drop it.
    const { error: linkErr } = await admin
      .from('establishment_owners')
      .update({ sta_place_id: staPlaceId })
      .eq('id', userId);
    if (linkErr) {
      return json(400, { error: linkErr.message });
    }
  }

  return json(200, { ok: true, userId, updated });
});

async function findAuthUserByEmail(
  admin: ReturnType<typeof createClient>,
  email: string
): Promise<{ id: string } | null> {
  const getByEmail = (
    admin.auth.admin as {
      getUserByEmail?: (value: string) => Promise<{ data: { user?: { id?: string } } | null }>;
    }
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
