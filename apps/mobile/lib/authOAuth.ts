import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { parseAuthParams } from './authUrlParams';

const AUTH_CALLBACK_PATH = 'auth/callback';
const MOBILE_BRIDGE_PATH = 'auth/mobile-callback';
const DEFAULT_WEB_DEV_PORT = '5173';
const OAUTH_REDIRECT_MODE_KEY = 'google_oauth_redirect_mode';

const LAN_IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

export type OAuthRedirectMode = 'expo' | 'bridge' | 'web';

export function isLocalhostAuthUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(url);
}

function extractLanHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(LAN_IPV4);
  if (!match?.[1] || match[1] === '127.0.0.1') return null;
  return match[1];
}

function getDevMachineLanHost(): string | null {
  const candidates: string[] = [];

  // Current Metro / Expo Go debugger host (most reliable for “this PC”).
  const expoGo = (Constants as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig;
  if (expoGo?.debuggerHost) candidates.push(expoGo.debuggerHost);

  const manifest = Constants.manifest as { debuggerHost?: string } | null;
  if (manifest?.debuggerHost) candidates.push(manifest.debuggerHost);

  if (Constants.expoConfig?.hostUri) candidates.push(Constants.expoConfig.hostUri);
  if (typeof Constants.linkingUri === 'string' && Constants.linkingUri) {
    candidates.push(Constants.linkingUri);
  }
  try {
    candidates.push(Linking.createURL(AUTH_CALLBACK_PATH));
  } catch {
    // ignore
  }

  for (const raw of candidates) {
    const host = extractLanHost(raw);
    if (host) return host;
  }
  return null;
}

export function getDevOAuthBridgeBaseUrl(): string | null {
  const port = (process.env.EXPO_PUBLIC_WEB_DEV_PORT ?? DEFAULT_WEB_DEV_PORT).trim() || DEFAULT_WEB_DEV_PORT;
  const host = getDevMachineLanHost();
  const fromMetro = host ? `http://${host}:${port}` : null;

  const explicit = process.env.EXPO_PUBLIC_OAUTH_BRIDGE_BASE_URL?.trim()?.replace(/\/$/, '') || null;
  // Wi‑Fi IPs change often — never keep a stale EXPO_PUBLIC_OAUTH_BRIDGE_BASE_URL
  // that doesn't match the Expo Go / Metro LAN host.
  if (explicit && host && !explicit.includes(host)) {
    if (__DEV__) {
      console.warn(
        '[authOAuth] Ignoring stale EXPO_PUBLIC_OAUTH_BRIDGE_BASE_URL=',
        explicit,
        '→ using Metro host',
        fromMetro
      );
    }
    return fromMetro;
  }
  return explicit || fromMetro;
}

/** Phone must reach this URL after Google — wrong Wi‑Fi IP = blank white page. */
export async function isOAuthBridgeReachable(baseUrl?: string | null, timeoutMs = 2500): Promise<boolean> {
  const base = (baseUrl ?? getDevOAuthBridgeBaseUrl())?.replace(/\/$/, '');
  if (!base) return false;

  const tryOnce = async (method: 'HEAD' | 'GET') => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/`, { method, signal: controller.signal });
      return res.status > 0;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await tryOnce('HEAD');
  } catch {
    try {
      return await tryOnce('GET');
    } catch {
      return false;
    }
  }
}

export function getExpoOAuthCallbackUrl(): string {
  if (Platform.OS === 'web') {
    return Linking.createURL(AUTH_CALLBACK_PATH);
  }

  // Expo Go cannot receive cavitour:// links — it listens on the exp://
  // proxy URL. Using the default Linking URL keeps Expo Go working, while
  // standalone dev-client / release builds fall through to cavitour://.
  try {
    const def = Linking.createURL(AUTH_CALLBACK_PATH);
    if (/^exp:\/\//i.test(def)) {
      return def;
    }
  } catch {
    /* empty */
  }

  try {
    const withScheme = Linking.createURL(AUTH_CALLBACK_PATH, { scheme: 'cavitour' });
    if (/^cavitour:/i.test(withScheme)) {
      return withScheme;
    }
  } catch {
    /* empty */
  }

  return 'cavitour://auth/callback';
}

export function buildOAuthRedirectUrl(mode: OAuthRedirectMode): string {
  if (mode === 'web') {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}/${AUTH_CALLBACK_PATH}`;
    }
    return Linking.createURL(AUTH_CALLBACK_PATH);
  }
  if (mode === 'bridge') {
    const base = getDevOAuthBridgeBaseUrl();
    const expoCallback = getExpoOAuthCallbackUrl();
    if (!base) {
      return expoCallback;
    }
    return `${base}/${MOBILE_BRIDGE_PATH}?expo_redirect=${encodeURIComponent(expoCallback)}`;
  }
  return getExpoOAuthCallbackUrl();
}

async function getSavedOAuthRedirectMode(): Promise<OAuthRedirectMode | null> {
  const raw = await AsyncStorage.getItem(OAUTH_REDIRECT_MODE_KEY);
  if (raw === 'expo' || raw === 'bridge' || raw === 'web') {
    return raw;
  }
  return null;
}

export async function persistOAuthRedirectMode(mode: OAuthRedirectMode): Promise<void> {
  await AsyncStorage.setItem(OAUTH_REDIRECT_MODE_KEY, mode);
}

/**
 * Mobile Google uses Expo / app deep links only — apps/web is NOT required.
 */
export async function resolveOAuthRedirectModes(): Promise<OAuthRedirectMode[]> {
  if (Platform.OS === 'web') {
    return ['web'];
  }
  return ['expo'];
}

export function patchOAuthAuthorizeUrl(oauthUrl: string, redirectTo: string): string {
  const url = new URL(oauthUrl);
  url.searchParams.set('redirect_to', redirectTo);
  return url.toString();
}

export function getRedirectToFromAuthorizeUrl(oauthUrl: string): string {
  try {
    return decodeURIComponent(new URL(oauthUrl).searchParams.get('redirect_to') ?? '');
  } catch {
    return '';
  }
}

export function isOAuthCallbackUrl(url: string): boolean {
  if (!url) return false;
  if (/auth\/callback|auth\/mobile-callback/i.test(url)) {
    return true;
  }
  // App-scheme return from Google/Supabase (may omit path in some clients).
  // Also covers Expo Go's exp:// proxy return URL (e.g. exp://…/--/auth/callback?code=…).
  return (
    /^(cavitour|exp):/i.test(url) && /(?:[?&#]code=|access_token=|error=)/i.test(url)
  );
}

export async function createSessionFromOAuthUrl(
  url: string,
  client: SupabaseClient = supabase,
): Promise<void> {
  const params = parseAuthParams(url);
  const oauthError = params.get('error');
  const oauthErrorDescription = params.get('error_description');
  if (oauthError) {
    throw new Error(oauthErrorDescription || oauthError);
  }

  const code = params.get('code');
  if (code) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      if (__DEV__) {
        console.warn('[authOAuth] exchangeCodeForSession:', error.message);
      }
      const { data: existing } = await client.auth.getSession();
      if (existing.session) {
        return;
      }
      throw error;
    }
    return;
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error } = await client.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      throw error;
    }
    return;
  }

  const { data: existing } = await client.auth.getSession();
  if (existing.session) {
    return;
  }

  // The return link reached us WITHOUT any sign-in data. That is the signature
  // of Supabase sending the auth code to the website (Site URL) instead of the
  // app's deep link — i.e. the redirect URL allow list did not accept it.
  throw new Error(
    'Google sign in did not return a valid session. The return link reached the app without any sign-in data.\n\n' +
      'This happens when Supabase sends the sign-in to the website instead of the app — check that these exact entries ' +
      'are saved in Supabase → Authentication → URL Configuration → Redirect URLs:\n\n' +
      '     cavitour://auth/callback\n' +
      '     cavitour://**\n' +
      '     exp://**'
  );
}

/** One exchange at a time — App.tsx + SignIn both see the deep link. */
let oauthCallbackInFlight: Promise<boolean> | null = null;

export async function applyOAuthCallbackFromUrl(
  supabaseClient: SupabaseClient,
  url: string,
): Promise<boolean> {
  if (!isOAuthCallbackUrl(url)) {
    return false;
  }

  if (oauthCallbackInFlight) {
    return oauthCallbackInFlight;
  }

  oauthCallbackInFlight = (async () => {
    try {
      const { data: existing } = await supabaseClient.auth.getSession();
      if (existing.session) {
        return true;
      }
      await createSessionFromOAuthUrl(url, supabaseClient);
      return true;
    } catch (err) {
      const { data: existing } = await supabaseClient.auth.getSession();
      if (existing.session) {
        return true;
      }
      if (__DEV__) {
        console.warn('[authOAuth] applyOAuthCallbackFromUrl:', err);
      }
      return false;
    } finally {
      oauthCallbackInFlight = null;
    }
  })();

  return oauthCallbackInFlight;
}

export class OAuthLocalhostRedirectError extends Error {
  constructor() {
    super('OAUTH_LOCALHOST_REDIRECT');
    this.name = 'OAuthLocalhostRedirectError';
  }
}
