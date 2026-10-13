import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isAllowedAdminEmailAsync } from '../lib/adminEmail';
import {
  completeOAuthFromUrl,
  isStaleOAuthStateError,
  urlHasOAuthParams,
  waitForSupabaseSession,
} from '../lib/oauthCallback';
import {
  clearAdminOAuthNextPath,
  peekAdminOAuthNextPath,
  startAdminGoogleOAuth,
} from '../lib/startGoogleOAuth';
import { supabase } from '../lib/supabase';
import { useAdminHref } from '../contexts/AdminPathPrefixContext';
import styles from './LoginPage.module.css';

function safeNextPath(raw: string | null) {
  const next = String(raw ?? '').trim();
  if (!next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

function friendlyGoogleError(message: string) {
  const text = String(message || '').trim();
  if (/oauth state has expired|flow_state_expired|flow_state_not_found|invalid flow state/i.test(text)) {
    return 'Google sign-in expired. Please try Sign in with Google again.';
  }
  if (/pkce code verifier/i.test(text)) {
    return 'Google sign-in could not finish in this browser tab. Please try again from the login page.';
  }
  return text || 'Google sign in failed';
}

/** Guards the one automatic restart so a broken redirect config cannot loop. */
const OAUTH_RESTARTED_KEY = 'cavitour.adminOauth.restarted';

function oauthRestartUsed(): boolean {
  try {
    return sessionStorage.getItem(OAUTH_RESTARTED_KEY) === '1';
  } catch {
    return true;
  }
}

function setOAuthRestartUsed(used: boolean) {
  try {
    if (used) sessionStorage.setItem(OAUTH_RESTARTED_KEY, '1');
    else sessionStorage.removeItem(OAUTH_RESTARTED_KEY);
  } catch {
    /* ignore */
  }
}

export function OAuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const loginHref = '/login';
  const dashboardHref = useAdminHref('/web/dashboard');
  const [statusMessage, setStatusMessage] = useState('Please wait while we complete your sign in.');

  useEffect(() => {
    let active = true;
    const nextPath =
      safeNextPath(searchParams.get('next')) || peekAdminOAuthNextPath() || dashboardHref;

    const finish = async () => {
      let authError: string | null = null;
      let staleState = false;

      try {
        const href = window.location.href;
        if (urlHasOAuthParams(href)) {
          if (active) setStatusMessage('Exchanging the Google security codeâ€¦');
          await completeOAuthFromUrl(href);
          clearAdminOAuthNextPath();
          setOAuthRestartUsed(false);
          document.cookie = 'cavitour_oauth_intent=; path=/; max-age=0; SameSite=Lax';
          const cleanPath = window.location.pathname;
          window.history.replaceState({}, document.title, `${cleanPath}?next=${encodeURIComponent(nextPath)}`);
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'Google sign in failed';
        staleState = isStaleOAuthStateError(raw);
        authError = friendlyGoogleError(raw);
      }

      if (!active) return;

      const goLogin = (message: string) => {
        setStatusMessage(message);
        window.setTimeout(() => {
          if (active) navigate(loginHref, { replace: true, state: { googleError: message } });
        }, 2500);
      };

      // The security code that pairs this browser with Google is missing or spent â€”
      // usually a reused link or a stale tab (Supabase also bounces those to the
      // site root). One fresh round trip fixes it.
      if (authError && staleState && !oauthRestartUsed()) {
        setOAuthRestartUsed(true);
        if (active) setStatusMessage('Restarting Google sign-inâ€¦');
        try {
          await startAdminGoogleOAuth(nextPath);
          return;
        } catch {
          /* fall through to the error message below */
        }
      }

      if (authError) {
        goLogin(authError);
        return;
      }

      if (active) setStatusMessage('Reading your sessionâ€¦');

      let session = null;
      try {
        session = await waitForSupabaseSession();
      } catch (err) {
        goLogin(err instanceof Error ? err.message : 'Could not read your session.');
        return;
      }

      if (!active) return;

      if (!session) {
        // Be explicit â€” a missing session here means the code exchange silently
        // failed; a generic "not allowlisted" message would be misleading.
        goLogin('Google finished, but no session was created. Please try again.');
        return;
      }

      const email = session?.user?.email?.trim().toLowerCase() ?? '';
      if (!(await isAllowedAdminEmailAsync(supabase, email))) {
        // Show WHICH account Google actually returned â€” this exposes wrong-account
        // auto-selection instead of hiding behind a generic allowlist message.
        await supabase.auth.signOut();
        goLogin('This account does not have admin access.');
        return;
      }

      if (active) setStatusMessage(`Signed in as ${email}. Opening the dashboardâ€¦`);
      navigate(nextPath, { replace: true });
    };

    void finish();
    return () => {
      active = false;
    };
  }, [dashboardHref, loginHref, navigate, searchParams]);

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <p className={styles.title}>Authenticating with Google</p>
        <p className={styles.hint}>{statusMessage}</p>
      </div>
    </div>
  );
}
