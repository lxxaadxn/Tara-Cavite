import type { SupabaseClient } from '@supabase/supabase-js';

/** Head admin — the primary owner account for the admin app. */
export const HEAD_ADMIN_EMAIL = 'taracavite.app@gmail.com';

/** Bootstrap emails — always valid even before the DB allowlist loads. */
export const ADMIN_ALLOWED_EMAILS = [
  HEAD_ADMIN_EMAIL,
  'forcapstone111@gmail.com',
] as const;

/** Primary email shown in login hints (first allowlisted address). */
export const ADMIN_ALLOWED_EMAIL = ADMIN_ALLOWED_EMAILS[0];

const bootstrap = new Set(ADMIN_ALLOWED_EMAILS.map((e) => e.toLowerCase()));
let dynamicEmails = new Set<string>();
let loadedOnce = false;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Sync check: bootstrap list and/or emails loaded from the DB. */
export function isAllowedAdminEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return bootstrap.has(normalized) || dynamicEmails.has(normalized);
}

export function getLoadedAdminAllowlist(): string[] {
  return [...new Set([...bootstrap, ...dynamicEmails])].sort();
}

export async function loadAdminAllowlist(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.rpc('admin_list_allowlist_emails');
  if (error) throw error;
  const emails = (Array.isArray(data) ? data : [])
    .map((row) => {
      if (typeof row === 'string') return normalizeEmail(row);
      if (row && typeof row === 'object' && 'email' in row) {
        return normalizeEmail(String((row as { email: unknown }).email ?? ''));
      }
      return '';
    })
    .filter(Boolean);
  dynamicEmails = new Set(emails);
  loadedOnce = true;
  return getLoadedAdminAllowlist();
}

/** Best-effort load; keeps bootstrap-only on failure. */
export async function ensureAdminAllowlist(client: SupabaseClient): Promise<void> {
  if (loadedOnce) return;
  try {
    await loadAdminAllowlist(client);
  } catch {
    loadedOnce = true;
  }
}

/**
 * Bootstrap sync check, then DB allowlist (via list when session admin, else
 * `is_cavitour_admin_email` for login of newly added admins).
 */
export async function isAllowedAdminEmailAsync(
  client: SupabaseClient,
  email: string
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  if (isAllowedAdminEmail(normalized)) return true;

  await ensureAdminAllowlist(client);
  if (isAllowedAdminEmail(normalized)) return true;

  const { data, error } = await client.rpc('is_cavitour_admin_email', { p_email: normalized });
  if (error) return false;
  if (data) {
    dynamicEmails.add(normalized);
    return true;
  }
  return false;
}

export async function addAdminAllowlistEmail(
  client: SupabaseClient,
  email: string
): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    throw new Error('Enter a valid email address');
  }
  const { data, error } = await client.rpc('admin_add_allowlist_email', { p_email: normalized });
  if (error) throw error;
  const saved = normalizeEmail(String(data ?? normalized));
  dynamicEmails.add(saved);
  loadedOnce = true;
  return saved;
}
