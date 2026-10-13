import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Creates (or password-resets) a real auth account from the admin panel.
 * Runs through the `admin-create-user` Edge Function, which holds the
 * service-role key and checks that the caller is an allowlisted admin.
 *
 * - role 'admin': creates the auth user AND adds the email to the allowlist.
 * - role 'establishment': creates the auth user AND the establishment_owners
 *   record (approved, setup complete) — no invitation email needed.
 * - If the email already has an auth account, its password is reset instead.
 */
export type AdminCreateAccountInput = {
  email: string;
  password: string;
  role: 'admin' | 'establishment';
  /** Existing STA catalog row to link (connect-account flow). */
  staPlaceId?: string;
  fullName?: string;
  businessName?: string;
  businessType?: string;
  lgu?: string;
  barangay?: string;
  address?: string;
  phone?: string;
};

export type AdminCreateAccountResult = {
  ok?: boolean;
  userId?: string;
  /** True when the email already existed and only the password was changed. */
  updated?: boolean;
  error?: string;
};

export async function createAccountWithPassword(
  client: SupabaseClient,
  input: AdminCreateAccountInput
): Promise<AdminCreateAccountResult> {
  const { data, error } = await client.functions.invoke('admin-create-user', {
    body: {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      role: input.role,
      staPlaceId: (input.staPlaceId ?? '').trim(),
      fullName: (input.fullName ?? '').trim(),
      businessName: (input.businessName ?? '').trim(),
      businessType: (input.businessType ?? '').trim(),
      lgu: (input.lgu ?? '').trim(),
      barangay: (input.barangay ?? '').trim(),
      address: (input.address ?? '').trim(),
      phone: (input.phone ?? '').trim(),
    },
  });

  if (error) {
    // functions.invoke surfaces HTTP errors as FunctionsHttpError with the
    // response body in error.context; try to pull the readable message out.
    const ctx = (error as { context?: Response }).context;
    let bodyError = '';
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = (await ctx.clone().json()) as { error?: string };
        bodyError = body?.error ?? '';
      } catch {
        /* body already consumed or not JSON — fall through */
      }
    }
    throw new Error(bodyError || error.message || 'Could not create the account.');
  }

  const payload = (data ?? {}) as AdminCreateAccountResult;
  if (payload.error) throw new Error(payload.error);
  return payload;
}
