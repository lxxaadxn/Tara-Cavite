import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

const ADMIN_RESERVED_EMAILS = [
  'taracavite.app@gmail.com',
  'forcapstone111@gmail.com',
];

/** Sync bootstrap check (always available). */
export function isAdminReservedEmail(email = '') {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  return ADMIN_RESERVED_EMAILS.some((reserved) => reserved.toLowerCase() === normalized);
}

/**
 * Bootstrap + DB allowlist (`is_cavitour_admin_email`).
 * Use on signup/sign-in paths that can await.
 */
export async function isAdminReservedEmailAsync(
  email = '',
  client: SupabaseClient | null = supabase
) {
  const normalized = String(email ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (isAdminReservedEmail(normalized)) return true;
  if (!client) return false;
  try {
    const { data, error } = await client.rpc('is_cavitour_admin_email', { p_email: normalized });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export function getAdminReservedEmailMessage() {
  return 'This email is reserved for the admin app only.';
}
