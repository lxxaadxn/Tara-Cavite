import { useEffect, useState, type FormEvent } from 'react';
import { SelectMenu } from '../../components/SelectMenu';
import { useToast } from '../../components/Toast';
import { createAccountWithPassword } from '../../lib/adminAccounts';
import { supabase } from '../../lib/supabase';
import styles from '../../components/ContentCrudPage.module.css';

type CatalogOption = {
  id: string;
  label: string;
  businessName: string;
  lgu: string;
  barangay: string;
  address: string;
  phone: string;
  email: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Called after the account is created and linked so the list can refresh. */
  onSaved: () => void;
};

/**
 * Connect an EXISTING STA catalog establishment to a brand-new account:
 * pick the establishment, set the login email + password, done. The owner
 * record is linked to the catalog row (sta_place_id) instead of creating a
 * duplicate catalog entry.
 */
export function EstablishmentConnectModal({ open, onClose, onSaved }: Props) {
  const toast = useToast();
  const [options, setOptions] = useState<CatalogOption[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoadingCatalog(true);
    (async () => {
      try {
        // Catalog rows not already linked to an account.
        const [catalogRes, ownersRes] = await Promise.all([
          supabase
            .from('sta_v3_cavite_2025')
            .select('id, ta_name, city_mun, barangay, address, phone, email')
            .order('ta_name', { ascending: true }),
          supabase.from('establishment_owners').select('sta_place_id'),
        ]);
        if (catalogRes.error) throw new Error(catalogRes.error.message);
        if (ownersRes.error) throw new Error(ownersRes.error.message);
        if (!active) return;
        const linked = new Set(
          (ownersRes.data ?? [])
            .map((r: { sta_place_id: unknown }) => String(r.sta_place_id ?? ''))
            .filter(Boolean)
        );
        const opts: CatalogOption[] = (catalogRes.data ?? [])
          .map((r: Record<string, unknown>) => {
            const id = String(r.id ?? '');
            const name = String(r.ta_name ?? '').trim();
            if (!id || !name || linked.has(id)) return null;
            const lgu = String(r.city_mun ?? '').trim();
            return {
              id,
              businessName: name,
              label: lgu ? `${name} — ${lgu}` : name,
              lgu,
              barangay: String(r.barangay ?? '').trim(),
              address: String(r.address ?? '').trim(),
              phone: String(r.phone ?? '').trim(),
              email: String(r.email ?? '').trim(),
            } satisfies CatalogOption;
          })
          .filter((o): o is CatalogOption => o !== null);
        setOptions(opts);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load establishments.');
      } finally {
        if (active) setLoadingCatalog(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const selected = options.find((o) => o.id === selectedId) ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selected) {
      setError('Select the establishment to connect.');
      return;
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.trim().length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    try {
      const result = await createAccountWithPassword(supabase, {
        email: trimmedEmail,
        password: password.trim(),
        role: 'establishment',
        staPlaceId: selected.id,
        fullName: fullName.trim(),
        businessName: selected.businessName,
        lgu: selected.lgu,
        barangay: selected.barangay,
        address: selected.address,
        phone: selected.phone || undefined,
      });
      toast(
        result.updated
          ? `Password set — ${selected.businessName} is connected to ${trimmedEmail}`
          : `Account created — ${selected.businessName} is connected to ${trimmedEmail}`,
        'success'
      );
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect the account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="est-connect-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="est-connect-title">Connect account to establishment</h2>

        <div className={styles.formGrid}>
          <div className={`${styles.field} ${styles.spanFull}`}>
            <span id="est-connect-select">Establishment</span>
            {loadingCatalog ? (
              <p className={styles.fieldHelp}>Loading catalog…</p>
            ) : options.length === 0 ? (
              <p className={styles.fieldHelp}>
                Every catalog establishment already has an account. Use “Add establishment” instead.
              </p>
            ) : (
              <SelectMenu
                value={selectedId}
                options={options.map((o) => ({ value: o.id, label: o.label }))}
                onChange={setSelectedId}
                placeholder="Select an establishment from the catalog"
                disabled={saving}
                labelledBy="est-connect-select"
              />
            )}
            <span className={styles.fieldHelp}>
              Lists catalog establishments that do not have an account yet. The account will be
              linked to this catalog entry — no duplicate listing is created.
            </span>
          </div>

          {selected ? (
            <label className={styles.field}>
              Contact person (optional)
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={saving}
                placeholder={selected.businessName}
              />
            </label>
          ) : null}

          <label className={`${styles.field} ${styles.spanFull}`}>
            <span>
              Login email
              <span className={styles.req} aria-hidden>
                *
              </span>
            </span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving || !selected}
              placeholder={selected?.email || 'owner@example.com'}
              required
            />
          </label>

          <label className={`${styles.field} ${styles.spanFull}`}>
            <span>
              Password
              <span className={styles.req} aria-hidden>
                *
              </span>
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving || !selected}
              placeholder="At least 6 characters"
              minLength={6}
              required
            />
            <span className={styles.fieldHelp}>
              The establishment signs in to its portal with this email and password right away.
            </span>
          </label>
        </div>

        {error ? (
          <p className={styles.requiredNote} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.modalActions}>
          <span className={styles.modalActionsSpacer} aria-hidden />
          <div className={styles.modalActionsRight}>
            <button type="button" className={styles.actionBtn} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving || !selected}>
              {saving ? 'Connecting…' : 'Create & connect'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
