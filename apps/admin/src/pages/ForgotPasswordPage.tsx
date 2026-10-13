import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AdminBrandMark } from '../components/AdminBrandMark';
import { supabase } from '../lib/supabase';
import styles from './LoginPage.module.css';

/**
 * Where the emailed reset link should land. Mirrors the app origin so
 * Supabase Redirect URLs only need the deployed origin (or localhost:3001 in dev).
 */
function passwordResetRedirect(): string {
  const { protocol, hostname, port } = window.location;
  const isPrivateLan =
    /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || hostname === '0.0.0.0';
  const host = isPrivateLan || hostname === '127.0.0.1' ? 'localhost' : hostname;
  const portPart = port ? `:${port}` : '';
  return `${protocol}//${host}${portPart}/auth/reset-password`;
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: passwordResetRedirect(),
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reset email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <AdminBrandMark variant="onLight" />
          <span className={styles.badge}>Admin</span>
        </div>
        <h1 className={styles.title}>Forgot password</h1>
        {sent ? (
          <p className={styles.hint} role="status">
            If <strong>{email.trim().toLowerCase()}</strong> is an admin account, a password reset
            link is on its way. Check your inbox (and spam), then open the link to set a new
            password.
          </p>
        ) : (
          <>
            <p className={styles.hint}>Enter your admin email and we will send you a reset link.</p>
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Email
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                                    required
                />
              </label>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          </>
        )}
        <p className={styles.forgotRow}>
          <Link to="/login" className={styles.forgotLink}>
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
