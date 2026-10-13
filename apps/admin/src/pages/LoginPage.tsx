import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AdminBrandMark } from '../components/AdminBrandMark';
import { isAllowedAdminEmailAsync } from '../lib/adminEmail';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAdminHref } from '../contexts/AdminPathPrefixContext';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const dashboardHref = useAdminHref('/web/dashboard');
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && session) {
      navigate(dashboardHref, { replace: true });
    }
  }, [authLoading, session, dashboardHref, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) {
      setError('Enter email and password.');
      return;
    }

    setLoading(true);
    try {
      if (!(await isAllowedAdminEmailAsync(supabase, trimmed))) {
        setError('This account does not have admin access.');
        return;
      }

      const { data, error: err } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (err) throw err;

      const signedInEmail = data.user?.email?.trim().toLowerCase() ?? '';
      if (!(await isAllowedAdminEmailAsync(supabase, signedInEmail))) {
        await supabase.auth.signOut();
        setError('This account does not have admin access.');
        return;
      }

      navigate(dashboardHref, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
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

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email
            <input
              type="email"
              id="admin-email" name="email" autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              required
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              type="password"
              id="admin-password" name="password" autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              required
            />
          </label>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className={styles.submit} disabled={loading || authLoading}>
            {loading ? 'Signing inâ€¦' : 'Log in'}
          </button>
          <p className={styles.forgotRow}>
            <Link to="/forgot-password" className={styles.forgotLink}>
              Forgot password?
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
