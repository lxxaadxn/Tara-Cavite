import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';
import {
  applyOAuthCallbackFromUrl,
  createSessionFromOAuthUrl,
  getExpoOAuthCallbackUrl,
  getRedirectToFromAuthorizeUrl,
  isLocalhostAuthUrl,
  isOAuthCallbackUrl,
  patchOAuthAuthorizeUrl,
  persistOAuthRedirectMode,
} from './authOAuth';

WebBrowser.maybeCompleteAuthSession();

const OAUTH_REDIRECT_MODE_KEY = 'google_oauth_redirect_mode';

const SETUP_HINT =
  'Google signed in, but the app did not get the return link.\n\n' +
  'If the browser ended up on the website, Supabase sent the sign-in to the Site URL instead of the app.\n\n' +
  'KNOWN CAUSES:\n' +
  '1. exp:// URLs with a private Wi-Fi IP (e.g. exp://192.168.x.x:8081/...) are ALWAYS rejected by\n' +
  '   Supabase (private-IP security rule) regardless of the allow list. Fix: run a dev build\n' +
  '   (npx expo run:android) so the app uses cavitour://auth/callback, or use npx expo start --tunnel.\n' +
  '2. The app’s redirect URL is missing from the allow list. Fix: Supabase → Authentication →\n' +
  '   URL Configuration → Redirect URLs, add and SAVE:\n\n' +
  '     cavitour://auth/callback\n' +
  '     cavitour://**\n' +
  '     exp://**\n\n' +
  'Keep the web URLs (Site URL + web auth/callback) as they are — do not remove them.';

export type GoogleSignInPhase = 'starting' | 'google' | 'finishing' | 'done';

type GoogleSignInOptions = {
  onPhase?: (phase: GoogleSignInPhase) => void;
};

function isHttpUrl(url: string | undefined | null): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

function isOAuthReturnUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // Must carry auth data (?code=… / #access_token=… / ?error=…). A BARE
  // cavitour://auth/callback (no params) is NOT a valid return — Android's
  // openAuthSessionAsync and stale launch intents produce it, and treating it
  // as a return caused the false "did not return a valid session" error.
  return isOAuthCallbackUrl(url) || /[?&#]code=/i.test(url) || /access_token=/i.test(url);
}

async function markSignedIn(): Promise<void> {
  await Promise.all([
    persistOAuthRedirectMode('expo'),
    AsyncStorage.setItem('isAuthenticated', 'true'),
  ]);
}

async function sessionReady(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

async function waitForSession(maxMs = 800): Promise<boolean> {
  if (await sessionReady()) return true;
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise((r) => setTimeout(r, 40));
    if (await sessionReady()) return true;
  }
  return false;
}

async function ensureSessionFromCallback(callbackUrl: string): Promise<void> {
  if (isLocalhostAuthUrl(callbackUrl) || isHttpUrl(callbackUrl)) {
    throw new Error(SETUP_HINT);
  }

  if (__DEV__) {
    console.info('[authOAuth] finishing with callback', callbackUrl.split('?')[0]);
  }

  const ok = await applyOAuthCallbackFromUrl(supabase, callbackUrl);
  if (!ok) {
    await createSessionFromOAuthUrl(callbackUrl);
  }

  if (!(await waitForSession())) {
    throw new Error('Google sign-in finished, but no session was created. Try again.');
  }
  await markSignedIn();
}

async function runGoogleOAuthExpoOnly(options?: GoogleSignInOptions): Promise<void> {
  const onPhase = options?.onPhase;
  await AsyncStorage.setItem(OAUTH_REDIRECT_MODE_KEY, 'expo');

  const redirectTo = getExpoOAuthCallbackUrl();

  if (__DEV__) {
    console.info('[authOAuth] mobile Google redirectTo=', redirectTo, 'os=', Platform.OS);
  }

  if (isHttpUrl(redirectTo) || isLocalhostAuthUrl(redirectTo)) {
    throw new Error(SETUP_HINT);
  }

  onPhase?.('starting');

  const warmup =
    Platform.OS === 'android' ? WebBrowser.warmUpAsync().catch(() => undefined) : Promise.resolve();

  const oauthStart = supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  const [{ data, error }] = await Promise.all([oauthStart, warmup]);

  if (error) throw error;
  if (!data?.url) throw new Error('Unable to start Google sign in.');

  const authorizeUrl = patchOAuthAuthorizeUrl(data.url, redirectTo);
  const redirectInUrl = getRedirectToFromAuthorizeUrl(authorizeUrl);

  if (__DEV__) {
    console.info('[authOAuth] authorize redirect_to=', redirectInUrl);
  }


  if (isLocalhostAuthUrl(redirectInUrl) || isHttpUrl(redirectInUrl)) {
    throw new Error(SETUP_HINT);
  }

  if (Platform.OS === 'web') {
    window.location.assign(authorizeUrl);
    return;
  }

  let linkCallback: string | null = null;
  const linkSub = Linking.addEventListener('url', ({ url }) => {
    if (isOAuthReturnUrl(url)) {
      linkCallback = url;
      void WebBrowser.dismissAuthSession();
    }
  });

  const appStateSub = AppState.addEventListener('change', (state) => {
    if (state === 'active' && !linkCallback) {
      void Linking.getInitialURL().then((url) => {
        if (isOAuthReturnUrl(url)) {
          linkCallback = url;
          void WebBrowser.dismissAuthSession();
        }
      });
    }
  });

  try {
    onPhase?.('google');

    const authSessionOptions =
      Platform.OS === 'android'
        ? { showInRecents: true, createTask: true }
        : { preferEphemeralSession: false, createTask: false };

    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectTo, authSessionOptions);

    onPhase?.('finishing');

    let callbackUrl: string | null =
      result.type === 'success' && result.url && isOAuthCallbackUrl(result.url)
        ? result.url
        : linkCallback;

    if (!callbackUrl) {
      const deadline = Date.now() + 280;
      while (!callbackUrl && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 40));
        callbackUrl = linkCallback;
      }
    }

    if (!callbackUrl) {
      const initial = await Linking.getInitialURL();
      if (isOAuthReturnUrl(initial)) {
        callbackUrl = initial;
      }
    }

    if (callbackUrl) {
      await ensureSessionFromCallback(callbackUrl);
      onPhase?.('done');
      return;
    }

    if (await sessionReady()) {
      await markSignedIn();
      onPhase?.('done');
      return;
    }

    if (result.type === 'cancel' || result.type === 'dismiss') {
      if (linkCallback) {
        await ensureSessionFromCallback(linkCallback);
        onPhase?.('done');
        return;
      }
      if (result.type === 'dismiss') {
        // The browser tab was closed WITHOUT the sign-in link ever coming back
        // to the app — the signature of Supabase sending the sign-in to the
        // website (Site URL) instead of the app's deep link.
        throw new Error(SETUP_HINT);
      }
      throw new Error('Google sign in was cancelled.');
    }

    throw new Error(SETUP_HINT);
  } finally {
    linkSub.remove();
    appStateSub.remove();
    if (Platform.OS === 'android') {
      void WebBrowser.coolDownAsync().catch(() => undefined);
    }
  }
}

export async function signInWithGoogleMobile(options?: GoogleSignInOptions): Promise<void> {
  try {
    await runGoogleOAuthExpoOnly(options);
  } catch (err) {
    if (await sessionReady()) {
      await markSignedIn();
      options?.onPhase?.('done');
      return;
    }
    throw err;
  }
}
