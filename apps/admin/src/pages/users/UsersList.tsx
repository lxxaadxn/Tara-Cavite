import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAdminPathPrefix } from '../../contexts/AdminPathPrefixContext';
import { useToast } from '../../components/Toast';
import { addAdminAllowlistEmail } from '../../lib/adminEmail';
import { createAccountWithPassword } from '../../lib/adminAccounts';
import {
  type AccountRole,
  type AdminTraveler,
  accountRoleLabel,
  fetchAdminTravelers,
  formatAdminDate,
  formatAdminRelative,
  isRecentlyActive,
  setListedAccountStatus,
} from '../../lib/adminUsers';
import { supabase } from '../../lib/supabase';
import crud from '../../components/ContentCrudPage.module.css';
import { RowMenu } from '../../components/RowMenu';
import { EyeIcon } from '../../components/rowIcons';
import styles from './UsersAdmin.module.css';
import { UsersFilterButton, type UserRoleFilter, type UserStatusFilter } from './UsersFilter';

type Mode = 'all' | 'active';

function StatusBadge({ status }: { status: AdminTraveler['accountStatus'] }) {
  if (status === 'disabled') return <span className={`${styles.badge} ${styles.tone_red}`}>Inactive</span>;
  if (status === 'deleted') return <span className={`${styles.badge} ${styles.tone_neutral}`}>Deleted</span>;
  return <span className={`${styles.badge} ${styles.tone_green}`}>Active</span>;
}

function PresenceBadge({ lastUsedAt }: { lastUsedAt: string | null }) {
  if (isRecentlyActive(lastUsedAt)) {
    return <span className={`${styles.badge} ${styles.tone_green}`}>Active</span>;
  }
  return <span className={`${styles.badge} ${styles.tone_neutral}`}>Idle</span>;
}

function RoleBadge({ role }: { role: AccountRole }) {
  const tone = role === 'admin' ? styles.tone_admin : role === 'establishment' ? styles.tone_amber : styles.tone_neutral;
  return <span className={`${styles.badge} ${tone}`}>{accountRoleLabel(role)}</span>;
}

export function UsersList({ mode }: { mode: Mode }) {
  const toast = useToast();
  const prefix = useAdminPathPrefix();
  const href = (path: string) => {
    if (!prefix) return path;
    return `${prefix.replace(/\/$/, '')}${path}`;
  };
  const viewHref = (user: AdminTraveler) =>
    user.role === 'establishment' ? href(`/web/establishments/${user.id}`) : href(`/web/users/${user.id}`);
  const [rows, setRows] = useState<AdminTraveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRoleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>('all');
  const [pending, setPending] = useState<AdminTraveler | null>(null);
  const [saving, setSaving] = useState(false);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [addAdminError, setAddAdminError] = useState('');
  const [addingAdmin, setAddingAdmin] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchAdminTravelers(supabase));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (mode === 'active' && row.accountStatus !== 'active') return false;
      if (roleFilter !== 'all' && row.role !== roleFilter) return false;
      if (mode === 'all' && statusFilter === 'active' && row.accountStatus !== 'active') return false;
      if (mode === 'all' && statusFilter === 'disabled' && row.accountStatus === 'active') return false;
      if (!q) return true;
      return (
        row.displayName.toLowerCase().includes(q) ||
        row.email.toLowerCase().includes(q) ||
        row.username.toLowerCase().includes(q) ||
        accountRoleLabel(row.role).toLowerCase().includes(q)
      );
    });
  }, [rows, query, roleFilter, statusFilter, mode]);

  const confirmDisable = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await setListedAccountStatus(supabase, pending, 'disabled');
      toast(`${pending.displayName} deactivated`, 'success');
      setPending(null);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not deactivate', 'error');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (user: AdminTraveler) => {
    try {
      await setListedAccountStatus(supabase, user, 'active');
      toast(`${user.displayName} activated`, 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not activate', 'error');
    }
  };

  const closeAddAdmin = () => {
    if (addingAdmin) return;
    setAddAdminOpen(false);
    setAdminEmail('');
    setAdminPassword('');
    setAddAdminError('');
  };

  const submitAddAdmin = async (e: FormEvent) => {
    e.preventDefault();
    setAddAdminError('');
    const trimmed = adminEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setAddAdminError('Enter a valid email address.');
      return;
    }
    const password = adminPassword.trim();
    if (password && password.length < 6) {
      setAddAdminError('Password must be at least 6 characters.');
      return;
    }
    setAddingAdmin(true);
    try {
      if (password) {
        // Create the real auth account (email confirmed) + allowlist entry.
        const result = await createAccountWithPassword(supabase, {
          email: trimmed,
          password,
          role: 'admin',
        });
        toast(
          result.updated
            ? `Password reset for existing account: ${trimmed}`
            : `Account created: ${trimmed}`,
          'success'
        );
      } else {
        const saved = await addAdminAllowlistEmail(supabase, trimmed);
        toast(`Added admin: ${saved}`, 'success');
      }
      setAddAdminOpen(false);
      setAdminEmail('');
      setAdminPassword('');
      await reload();
    } catch (err) {
      setAddAdminError(err instanceof Error ? err.message : 'Could not add admin email');
    } finally {
      setAddingAdmin(false);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <label className={styles.search}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            placeholder="Search name, email, role…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className={styles.headerActions}>
          <UsersFilterButton
            role={roleFilter}
            onRoleChange={setRoleFilter}
            showStatus={mode === 'all'}
            status={statusFilter}
            onStatusChange={setStatusFilter}
          />
          {mode === 'all' ? (
            <button type="button" className={styles.primaryBtn} onClick={() => setAddAdminOpen(true)}>
              Add Admin
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className={styles.loadError}>{error}</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>{mode === 'active' ? 'Last used' : 'Joined'}</th>
              <th className={crud.actionsHead}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className={styles.rowCard}>
                <td colSpan={6} className={styles.empty}>
                  Loading users…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr className={styles.rowCard}>
                <td colSpan={6} className={styles.empty}>
                  No users match your search.
                </td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className={styles.rowCard}>
                  <td>
                    <div className={styles.userCell}>
                      {user.avatarUrl ? (
                        <img className={styles.avatarImg} src={user.avatarUrl} alt="" />
                      ) : (
                        <span className={styles.avatar}>{user.initials}</span>
                      )}
                      <span>
                        <span className={styles.userName}>{user.displayName}</span>
                        {user.username ? <span className={styles.userMeta}>@{user.username}</span> : null}
                      </span>
                    </div>
                  </td>
                  <td>{user.email || '—'}</td>
                  <td>
                    <RoleBadge role={user.role} />
                  </td>
                  <td>
                    {mode === 'active' ? <PresenceBadge lastUsedAt={user.lastUsedAt} /> : <StatusBadge status={user.accountStatus} />}
                  </td>
                  <td>
                    {mode === 'active' ? (
                      <span title={user.lastUsedAt ? formatAdminDate(user.lastUsedAt) : undefined}>
                        {formatAdminRelative(user.lastUsedAt)}
                      </span>
                    ) : (
                      formatAdminDate(user.createdAt)
                    )}
                  </td>
                  <td className={crud.actionsHead}>
                    <div className={crud.rowTools}>
                      <Link
                        className={crud.iconBtn}
                        to={viewHref(user)}
                        aria-label={`View ${user.displayName}`}
                        title="View profile"
                      >
                        <EyeIcon />
                      </Link>
                      {user.role === 'admin' ? null : (
                        <RowMenu
                          label={`More actions for ${user.displayName}`}
                          items={
                            user.accountStatus === 'active'
                              ? [{ label: 'Deactivate', onSelect: () => setPending(user), danger: true }]
                              : [{ label: 'Activate', onSelect: () => void activate(user) }]
                          }
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? `Deactivate “${pending.displayName}”?` : 'Deactivate this user?'}
        message="They will be signed out of web and mobile and cannot use the app until you activate them again."
        confirmLabel="Deactivate"
        confirmingLabel="Deactivating…"
        confirming={saving}
        onConfirm={() => void confirmDisable()}
        onCancel={() => {
          if (!saving) setPending(null);
        }}
      />

      {addAdminOpen ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAddAdmin();
          }}
        >
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="add-admin-title">
            <h2 id="add-admin-title">Add Admin</h2>
            <p className={styles.modalHint}>
              Create the admin account with a password so it can sign in right away — or leave the
              password blank to only allowlist the email (that person then signs up themselves).
            </p>
            <form onSubmit={(e) => void submitAddAdmin(e)}>
              <label className={styles.label}>
                Email
                <input
                  className={styles.textInput}
                  type="email"
                  autoComplete="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  disabled={addingAdmin}
                />
              </label>
              <label className={styles.label}>
                Password
                <input
                  className={styles.textInput}
                  type="password"
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="Leave blank to allowlist only"
                  minLength={6}
                  disabled={addingAdmin}
                />
              </label>
              {addAdminError ? (
                <p className={styles.modalError} role="alert">
                  {addAdminError}
                </p>
              ) : null}
              <div className={styles.modalActions}>
                <button type="button" className={styles.secondaryBtn} onClick={closeAddAdmin} disabled={addingAdmin}>
                  Cancel
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={addingAdmin}>
                  {addingAdmin ? 'Saving…' : adminPassword.trim() ? 'Create account' : 'Add Admin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AllUsersPage() {
  return <UsersList mode="all" />;
}

export function ActiveUsersPage() {
  return <UsersList mode="active" />;
}
