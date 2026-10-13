import { useEffect, useState, type FormEvent } from 'react';
import { SelectMenu } from '../../components/SelectMenu';
import { useToast } from '../../components/Toast';
import { createAccountWithPassword } from '../../lib/adminAccounts';
import {
  deleteEstablishmentDraft,
  establishmentSetupRedirect,
  inviteEstablishment,
  saveEstablishmentDraft,
  updateEstablishmentProfile,
  type AdminEstablishment,
  type EstablishmentDraft,
} from '../../lib/adminEstablishments';
import { fetchCitiesAdmin, type CityAdminRow } from '../../lib/staCitiesAdmin';
import { fetchStaLookups, type StaLookupOption } from '../../lib/staLookups';
import { supabase } from '../../lib/supabase';
import styles from '../../components/ContentCrudPage.module.css';

const emptyForm = {
  businessName: '',
  email: '',
  fullName: '',
  businessType: '',
  address: '',
  lgu: '',
  barangay: '',
  phone: '',
  inviteMessage: '',
};

type Form = typeof emptyForm;

function formFromDraft(draft: EstablishmentDraft): Form {
  return {
    businessName: draft.businessName,
    email: draft.email,
    fullName: draft.fullName,
    businessType: draft.businessType,
    address: draft.address,
    lgu: draft.lgu,
    barangay: draft.barangay,
    phone: draft.phone,
    inviteMessage: draft.inviteMessage,
  };
}

function formFromEstablishment(row: AdminEstablishment): Form {
  return {
    businessName: row.businessName,
    email: row.email,
    fullName: row.fullName,
    businessType: row.businessType,
    address: row.address,
    lgu: row.lgu,
    barangay: row.barangay,
    phone: row.phone,
    inviteMessage: row.inviteMessage,
  };
}

/** The owner's own record, as the establishment portal knows it. */
export type OwnerProfileInput = {
  id: string;
  businessName: string;
  email: string;
  fullName: string;
  businessType: string;
  address: string;
  lgu: string;
  barangay: string;
  phone: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  /** Draft being edited, if the modal was opened from the Drafts tab. */
  draft?: EstablishmentDraft | null;
  /** Invited establishment being edited, if opened from a row's pencil. */
  establishment?: AdminEstablishment | null;
  /**
   * 'owner' is the establishment portal editing itself: no invitation controls,
   * and the fields the tourism office owns are shown read-only.
   */
  mode?: 'admin' | 'owner';
  ownerProfile?: OwnerProfileInput | null;
  /** Called after an invitation, draft, or edit is saved so the list can refresh. */
  onSaved: (kind: 'invited' | 'draft' | 'updated') => void;
};

function formFromOwner(owner: OwnerProfileInput): Form {
  return {
    businessName: owner.businessName,
    email: owner.email,
    fullName: owner.fullName,
    businessType: owner.businessType,
    address: owner.address,
    lgu: owner.lgu,
    barangay: owner.barangay,
    phone: owner.phone,
    inviteMessage: '',
  };
}

export function EstablishmentAddModal({
  open,
  onClose,
  draft,
  establishment,
  mode = 'admin',
  ownerProfile,
  onSaved,
}: Props) {
  const toast = useToast();
  const isOwner = mode === 'owner';

  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState('');
  const [categories, setCategories] = useState<StaLookupOption[]>([]);
  const [cities, setCities] = useState<CityAdminRow[]>([]);

  useEffect(() => {
    // Owners cannot change their category or city, so the lookups are dead weight.
    if (!open || isOwner) return;
    let active = true;
    Promise.all([fetchStaLookups(supabase), fetchCitiesAdmin(supabase)])
      .then(([lookups, cityRows]) => {
        if (!active) return;
        setCategories(lookups.ntdpCategories);
        setCities(cityRows);
      })
      .catch(() => {
        /* dropdowns stay empty; admin can still pick later on the detail page */
      });
    return () => {
      active = false;
    };
  }, [open, isOwner]);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    if (ownerProfile) setForm(formFromOwner(ownerProfile));
    else if (establishment) setForm(formFromEstablishment(establishment));
    else setForm(draft ? formFromDraft(draft) : emptyForm);
  }, [open, draft, establishment, ownerProfile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.businessName.trim() || !form.email.trim() || !form.businessType.trim()) {
      toast('Establishment name, email, and category are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (isOwner && ownerProfile) {
        // The "Owners can update own owner row" policy covers exactly these columns;
        // updateEstablishmentProfile would trip its admin-only guard instead.
        const { error } = await supabase
          .from('establishment_owners')
          .update({
            full_name: form.fullName.trim() || null,
            phone: form.phone.trim() || null,
            barangay: form.barangay.trim() || null,
            address: form.address.trim() || null,
          })
          .eq('id', ownerProfile.id);
        if (error) throw new Error(error.message);
        toast('Your details were saved', 'success');
        onSaved('updated');
        onClose();
        return;
      }
      if (establishment) {
        await updateEstablishmentProfile(supabase, establishment.id, {
          ...form,
          googleMapsLink: establishment.googleMapsLink,
        });
        toast(`${form.businessName.trim()} updated`, 'success');
        onSaved('updated');
        onClose();
        return;
      }
      const accountPassword = password.trim();
      if (accountPassword) {
        if (accountPassword.length < 6) {
          toast('Password must be at least 6 characters.', 'error');
          return;
        }
        // Create the account immediately with the given password — no invite email.
        const result = await createAccountWithPassword(supabase, {
          email: form.email,
          password: accountPassword,
          role: 'establishment',
          fullName: form.fullName,
          businessName: form.businessName,
          businessType: form.businessType,
          lgu: form.lgu,
          barangay: form.barangay,
          address: form.address,
          phone: form.phone,
        });
        if (draft) await deleteEstablishmentDraft(supabase, draft.id).catch(() => undefined);
        toast(
          result.updated
            ? `Password reset for existing account: ${form.email.trim().toLowerCase()}`
            : `Account created for ${form.email.trim().toLowerCase()}`,
          'success'
        );
        setForm(emptyForm);
        setPassword('');
        onSaved('invited');
        onClose();
        return;
      }
      await inviteEstablishment(supabase, { ...form }, establishmentSetupRedirect());
      if (draft) await deleteEstablishmentDraft(supabase, draft.id).catch(() => undefined);
      toast(`Invitation sent to ${form.email.trim().toLowerCase()}`, 'success');
      setForm(emptyForm);
      onSaved('invited');
      onClose();
    } catch (err) {
      const fallback = establishment ? 'Could not save changes' : 'Could not send invitation';
      toast(err instanceof Error ? err.message : fallback, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!form.businessName.trim() && !form.email.trim()) {
      toast('Add an establishment name or email before saving a draft.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveEstablishmentDraft(supabase, { ...form }, draft?.id);
      toast(draft ? 'Draft updated' : 'Saved as draft', 'success');
      setForm(emptyForm);
      onSaved('draft');
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save draft', 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Form, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
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
        className={`${styles.modal} ${styles.modalWide}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="est-add-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="est-add-title">
          {isOwner
            ? 'Edit establishment details'
            : establishment
              ? 'Edit establishment'
              : draft
                ? 'Edit draft establishment'
                : 'Add establishment'}
        </h2>

        <div className={styles.formGrid}>
          <label className={`${styles.field} ${styles.spanFull}`}>
            <span>
              Establishment name
              {isOwner ? null : (
                <span className={styles.req} aria-hidden>
                  *
                </span>
              )}
            </span>
            <input
              value={form.businessName}
              onChange={(e) => field('businessName', e.target.value)}
              disabled={saving}
              readOnly={isOwner}
              required
              autoFocus={!isOwner}
            />
          </label>
          <label className={styles.field}>
            <span>
              Establishment email
              {isOwner ? null : (
                <span className={styles.req} aria-hidden>
                  *
                </span>
              )}
            </span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => field('email', e.target.value)}
              disabled={saving}
              readOnly={isOwner}
              required
            />
          </label>
          <label className={styles.field}>
            Contact person
            <input
              value={form.fullName}
              onChange={(e) => field('fullName', e.target.value)}
              disabled={saving}
              autoFocus={isOwner}
            />
          </label>
          <label className={styles.field}>
            Phone (optional)
            <input value={form.phone} onChange={(e) => field('phone', e.target.value)} disabled={saving} />
          </label>
          {isOwner || establishment ? null : (
            <label className={`${styles.field} ${styles.spanFull}`}>
              Password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave blank to send an invite link instead"
                minLength={6}
                disabled={saving}
              />
              <span className={styles.fieldHelp}>
                Set a password to create the account right away — the establishment signs in with the
                email above and this password. Leave it blank to email a setup link instead.
              </span>
            </label>
          )}
          {isOwner ? (
            <label className={styles.field}>
              Category
              <input value={form.businessType} readOnly disabled={saving} />
            </label>
          ) : (
            <div className={styles.field}>
              <span id="est-add-category">
                Category<span className={styles.req} aria-hidden>*</span>
              </span>
              <SelectMenu
                value={form.businessType}
                options={categories.map((opt) => ({ value: opt.value, label: opt.label }))}
                onChange={(next) => field('businessType', next)}
                placeholder="Select a category"
                disabled={saving}
                labelledBy="est-add-category"
              />
            </div>
          )}
          {isOwner ? (
            <label className={styles.field}>
              City / Municipality
              <input value={form.lgu} readOnly disabled={saving} />
            </label>
          ) : (
            <div className={styles.field}>
              <span id="est-add-lgu">City / Municipality</span>
              <SelectMenu
                value={form.lgu}
                options={cities.map((city) => ({ value: city.name, label: city.name }))}
                onChange={(next) => field('lgu', next)}
                placeholder="Select a city or municipality"
                disabled={saving}
                labelledBy="est-add-lgu"
              />
            </div>
          )}
          <label className={styles.field}>
            Barangay / District
            <input value={form.barangay} onChange={(e) => field('barangay', e.target.value)} disabled={saving} />
          </label>
          <label className={`${styles.field} ${styles.spanFull}`}>
            Address
            <input value={form.address} onChange={(e) => field('address', e.target.value)} disabled={saving} />
          </label>
          {isOwner ? null : (
            <label className={`${styles.field} ${styles.spanFull}`}>
              Custom invitation message (optional)
              <textarea
                rows={3}
                value={form.inviteMessage}
                onChange={(e) => field('inviteMessage', e.target.value)}
                placeholder="e.g. Maraming salamat for joining the Cavite tourism directory — reach us at tourism@cavite.gov.ph for help."
                disabled={saving}
              />
              <span className={styles.fieldHelp}>
                {establishment
                  ? 'Kept on the record and reused whenever you resend the invitation.'
                  : 'Added to the invitation email and kept on the establishment record.'}
              </span>
            </label>
          )}
        </div>

        <p className={styles.requiredNote}>
          {isOwner ? null : (
            <>
              <span className={styles.req} aria-hidden>
                *
              </span>{' '}
            </>
          )}
          {isOwner
            ? 'The Cavite Tourism Administration owns your name, email, category, and city.'
            : establishment
              ? 'Required on the establishment record.'
              : 'Required to send an invitation. A draft can be saved with just a name or email.'}
        </p>

        <div className={styles.modalActions}>
          {isOwner || establishment ? (
            <span className={styles.modalActionsSpacer} aria-hidden />
          ) : (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => void saveDraft()}
              disabled={saving}
            >
              {draft ? 'Save draft' : 'Save as draft'}
            </button>
          )}
          <div className={styles.modalActionsRight}>
            <button type="button" className={styles.actionBtn} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={styles.primaryBtn} disabled={saving}>
              {isOwner || establishment
                ? saving
                  ? 'Saving…'
                  : 'Save changes'
                : saving
                  ? 'Working…'
                  : password.trim()
                    ? 'Create account'
                    : 'Send invitation'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
