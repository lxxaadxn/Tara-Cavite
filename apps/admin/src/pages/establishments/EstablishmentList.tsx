import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { CrudBadge } from '../../components/ContentCrudPage';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { EyeIcon, PencilIcon } from '../../components/rowIcons';
import { EstablishmentAddModal } from './EstablishmentAdd';
import { EstablishmentConnectModal } from './EstablishmentConnect';
import { useAdminPathPrefix } from '../../contexts/AdminPathPrefixContext';
import { useToast } from '../../components/Toast';
import {
  type AdminEstablishment,
  type EstablishmentDraft,
  type EstablishmentListMode,
  deleteEstablishmentDraft,
  establishmentSetupRedirect,
  fetchAdminEstablishments,
  fetchEstablishmentDrafts,
  formatAdminDate,
  inviteEstablishment,
  isPendingSetup,
  matchesEstablishmentList,
  setEstablishmentAccountStatus,
  setEstablishmentPublicVisible,
  setupLabel,
  toTitleCase,
  verificationLabel,
} from '../../lib/adminEstablishments';
import { supabase } from '../../lib/supabase';
import crud from '../../components/ContentCrudPage.module.css';
import list from './EstablishmentList.module.css';

const PAGE_SIZE = 30;

const TABS: { mode: EstablishmentListMode; label: string; to: string }[] = [
  { mode: 'all', label: 'All', to: '/web/establishments' },
  { mode: 'pending', label: 'Pending Setup', to: '/web/establishments/pending' },
  { mode: 'deactivated', label: 'Deactivated', to: '/web/establishments/deactivated' },
  { mode: 'drafts', label: 'Drafts', to: '/web/establishments/drafts' },
];

/** "City, Barangay" for the Location cell, falling back to the address. */
function locationLine(row: { lgu: string; barangay: string; address: string }): string {
  const parts = [row.lgu, row.barangay].filter(Boolean).map(toTitleCase);
  if (parts.length > 0) return parts.join(', ');
  return row.address ? toTitleCase(row.address) : '';
}

/** One pill per row: recognition state, with public visibility as an icon. */
function StatusBadge({ row }: { row: AdminEstablishment }) {
  const hidden = !row.publicVisible;
  const visibility = hidden ? 'Hidden from the public site' : 'Visible on the public site';
  const icon = <EyeIcon hidden={hidden} size={13} />;

  if (row.accountStatus === 'disabled') {
    return <CrudBadge label="Deactivated" tone="red" icon={icon} title={`Deactivated · ${visibility}`} />;
  }
  if (isPendingSetup(row)) {
    return <CrudBadge label="Pending invitation" tone="amber" icon={icon} title={`Pending invitation · ${visibility}`} />;
  }
  if (row.verificationStatus === 'approved') {
    return (
      <CrudBadge
        label={verificationLabel(row.verificationStatus)}
        tone="green"
        icon={icon}
        title={`Recognized · ${visibility}`}
      />
    );
  }
  return <CrudBadge label={setupLabel(row)} tone="neutral" icon={icon} title={`${setupLabel(row)} · ${visibility}`} />;
}

const EMPTY: Record<EstablishmentListMode, string> = {
  all: 'No establishments yet. Use Add establishment to invite a recognized business.',
  pending: 'No invitations waiting on password setup.',
  deactivated: 'No deactivated establishments.',
  drafts: 'No drafts saved. Use Save as draft while you are still gathering details.',
};

function pageList(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) out.push('gap');
    out.push(page);
  });
  return out;
}

export function EstablishmentList({ mode }: { mode: EstablishmentListMode }) {
  const toast = useToast();
  const prefix = useAdminPathPrefix();
  const withPrefix = (path: string) => {
    if (!prefix) return path;
    return `${prefix.replace(/\/$/, '')}${path}`;
  };
  const detailHref = (id: string) => withPrefix(`/web/establishments/${id}`);

  const isDrafts = mode === 'drafts';

  const [rows, setRows] = useState<AdminEstablishment[]>([]);
  const [drafts, setDrafts] = useState<EstablishmentDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pendingDisable, setPendingDisable] = useState<AdminEstablishment | null>(null);
  const [pendingDraftDelete, setPendingDraftDelete] = useState<EstablishmentDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<EstablishmentDraft | null>(null);
  const [editingRow, setEditingRow] = useState<AdminEstablishment | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDrafts) setDrafts(await fetchEstablishmentDrafts(supabase));
      else setRows(await fetchAdminEstablishments(supabase));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load establishments');
    } finally {
      setLoading(false);
    }
  }, [isDrafts]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const inMode = useMemo(
    () => (isDrafts ? [] : rows.filter((row) => matchesEstablishmentList(row, mode))),
    [rows, mode, isDrafts]
  );

  const source = isDrafts ? drafts : inMode;

  const matchesFilters = useCallback(
    (row: AdminEstablishment | EstablishmentDraft) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return [row.businessName, row.fullName, row.email, row.businessType, row.lgu, row.barangay, row.address].some(
        (v) => v.toLowerCase().includes(q)
      );
    },
    [query]
  );

  const filtered = useMemo(() => inMode.filter(matchesFilters), [inMode, matchesFilters]);
  const filteredDrafts = useMemo(() => drafts.filter(matchesFilters), [drafts, matchesFilters]);

  useEffect(() => {
    setPage(1);
  }, [query, mode]);

  const total = isDrafts ? filteredDrafts.length : filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);
  const visibleDrafts = filteredDrafts.slice(start, start + PAGE_SIZE);
  const shownCount = isDrafts ? visibleDrafts.length : visible.length;

  const confirmDisable = async () => {
    if (!pendingDisable) return;
    setSaving(true);
    try {
      await setEstablishmentAccountStatus(supabase, pendingDisable.id, 'disabled');
      toast(`${toTitleCase(pendingDisable.businessName)} deactivated`, 'success');
      setPendingDisable(null);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not deactivate', 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDraftDelete = async () => {
    if (!pendingDraftDelete) return;
    setSaving(true);
    try {
      await deleteEstablishmentDraft(supabase, pendingDraftDelete.id);
      toast('Draft deleted', 'success');
      setPendingDraftDelete(null);
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete draft', 'error');
    } finally {
      setSaving(false);
    }
  };

  const activate = async (row: AdminEstablishment) => {
    try {
      await setEstablishmentAccountStatus(supabase, row.id, 'active');
      toast(`${toTitleCase(row.businessName)} activated`, 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not activate', 'error');
    }
  };

  const toggleVisibility = async (row: AdminEstablishment) => {
    const next = !row.publicVisible;
    try {
      await setEstablishmentPublicVisible(supabase, row.id, next);
      toast(next ? 'Listing is now public' : 'Listing hidden from the public', 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not update visibility', 'error');
    }
  };

  const resendInvite = async (row: AdminEstablishment) => {
    try {
      await inviteEstablishment(
        supabase,
        {
          businessName: row.businessName,
          email: row.email,
          fullName: row.fullName,
          businessType: row.businessType,
          address: row.address,
          lgu: row.lgu,
          barangay: row.barangay,
          phone: row.phone,
          inviteMessage: row.inviteMessage,
        },
        establishmentSetupRedirect(),
        true
      );
      toast(`Setup email sent again to ${row.email}`, 'success');
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not resend invitation', 'error');
    }
  };

  const rowMenuItems = (row: AdminEstablishment): RowMenuItem[] => {
    const items: RowMenuItem[] = [
      {
        label: row.publicVisible ? 'Hide from public' : 'Show publicly',
        onSelect: () => void toggleVisibility(row),
      },
    ];
    if (isPendingSetup(row) && row.email) {
      items.push({ label: 'Resend invitation', onSelect: () => void resendInvite(row) });
    }
    items.push(
      row.accountStatus === 'disabled'
        ? { label: 'Activate account', onSelect: () => void activate(row) }
        : { label: 'Deactivate account', onSelect: () => setPendingDisable(row), danger: true }
    );
    return items;
  };

  return (
    <div className={crud.page}>
      <div className={crud.toolbar}>
        <div className={crud.tabs} role="tablist" aria-label="Establishment status">
          {TABS.map((tab) => (
            <Link
              key={tab.mode}
              role="tab"
              aria-selected={tab.mode === mode}
              className={`${crud.tab} ${list.tabLink} ${tab.mode === mode ? crud.tabActive : ''}`}
              to={withPrefix(tab.to)}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        <div className={crud.toolbarRight}>
          <label className={crud.search}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          {mode === 'all' || isDrafts ? (
            <button
              type="button"
              className={crud.primaryBtn}
              onClick={() => {
                setEditingDraft(null);
                setEditingRow(null);
                setAddOpen(true);
              }}
            >
              Add establishment
            </button>
          ) : null}
          {mode === 'all' ? (
            <button
              type="button"
              className={crud.actionBtn}
              onClick={() => setConnectOpen(true)}
            >
              Connect account
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className={crud.loadError}>{error}</p> : null}

      <div className={list.card}>
        <div className={list.cardBody}>
          <table className={`${crud.table} ${list.tableFixed}`}>
            <colgroup>
              <col style={{ width: '24%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '92px' }} />
            </colgroup>
            <thead className={list.tableHead}>
              <tr>
                <th>Establishment</th>
                <th>Contact Person</th>
                <th>Category</th>
                <th>Location</th>
                <th>{mode === 'pending' ? 'Date Invited' : isDrafts ? 'Last Saved' : 'Date Added'}</th>
                <th className={list.statusCell}>Status</th>
                <th className={list.actionsCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className={crud.rowCard}>
                  <td colSpan={7} className={crud.empty}>
                    Loading establishments…
                  </td>
                </tr>
              ) : shownCount === 0 ? (
                <tr className={crud.rowCard}>
                  <td colSpan={7} className={crud.empty}>
                    {error
                      ? 'Could not load establishments.'
                      : total === 0 && source.length > 0
                        ? 'No establishments match your search.'
                        : EMPTY[mode]}
                  </td>
                </tr>
              ) : isDrafts ? (
                visibleDrafts.map((draft) => (
                  <tr key={draft.id} className={`${crud.rowCard} ${list.row}`}>
                    <td className={list.clamp}>
                      <span className={list.cellName} title={toTitleCase(draft.businessName)}>
                        {draft.businessName ? toTitleCase(draft.businessName) : 'Untitled draft'}
                      </span>
                    </td>
                    <td className={list.clamp}>
                      <span className={list.cellName}>{draft.fullName ? toTitleCase(draft.fullName) : '—'}</span>
                    </td>
                    <td className={list.clampCell} title={draft.businessType || undefined}>
                      <span className={list.clamp2}>
                        {draft.businessType ? toTitleCase(draft.businessType) : '—'}
                      </span>
                    </td>
                    <td className={list.clamp}>
                      <span className={list.cellLine} title={draft.address || draft.lgu || undefined}>
                        {locationLine(draft) || '—'}
                      </span>
                    </td>
                    <td className={list.dateCell}>{formatAdminDate(draft.updatedAt || draft.createdAt)}</td>
                    <td className={list.statusCell}>
                      <CrudBadge label="Draft" tone="neutral" />
                    </td>
                    <td className={list.actionsCell}>
                      <div className={crud.rowTools}>
                        <button
                          type="button"
                          className={crud.iconBtn}
                          aria-label={`Edit ${draft.businessName || 'draft'}`}
                          title="Edit draft"
                          onClick={() => {
                            setEditingRow(null);
                            setEditingDraft(draft);
                            setAddOpen(true);
                          }}
                        >
                          <PencilIcon />
                        </button>
                        <RowMenu
                          label={`More actions for ${draft.businessName || 'this draft'}`}
                          items={[
                            {
                              label: 'Delete draft',
                              onSelect: () => setPendingDraftDelete(draft),
                              danger: true,
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                visible.map((row) => (
                  <tr key={row.id} className={`${crud.rowCard} ${list.row}`}>
                    <td className={list.clamp}>
                      <Link className={list.nameLink} to={detailHref(row.id)} title={toTitleCase(row.businessName)}>
                        {toTitleCase(row.businessName)}
                      </Link>
                    </td>
                    <td className={list.clamp}>
                      <span className={list.cellName} title={row.fullName ? toTitleCase(row.fullName) : undefined}>
                        {row.fullName ? toTitleCase(row.fullName) : '—'}
                      </span>
                    </td>
                    <td className={list.clampCell} title={row.businessType || undefined}>
                      <span className={list.clamp2}>{row.businessType ? toTitleCase(row.businessType) : '—'}</span>
                    </td>
                    <td className={list.clamp}>
                      <span className={list.cellLine} title={row.address || locationLine(row) || undefined}>
                        {locationLine(row) || '—'}
                      </span>
                      {row.googleMapsLink ? (
                        <a
                          className={list.mapChip}
                          href={row.googleMapsLink}
                          target="_blank"
                          rel="noreferrer"
                          title="Open in Google Maps"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden
                          >
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          Map
                        </a>
                      ) : null}
                    </td>
                    <td className={list.dateCell}>{formatAdminDate(row.invitedAt || row.createdAt)}</td>
                    <td className={list.statusCell}>
                      <StatusBadge row={row} />
                    </td>
                    <td className={list.actionsCell}>
                      <div className={crud.rowTools}>
                        <button
                          type="button"
                          className={crud.iconBtn}
                          aria-label={`Edit ${toTitleCase(row.businessName)}`}
                          title="Edit establishment"
                          onClick={() => {
                            setEditingRow(row);
                            setAddOpen(true);
                          }}
                        >
                          <PencilIcon />
                        </button>
                        <RowMenu
                          label={`More actions for ${toTitleCase(row.businessName)}`}
                          items={rowMenuItems(row)}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className={list.pagination}>
          <span className={list.pageInfo}>
            {total === 0
              ? `Showing 0 ${isDrafts ? 'drafts' : 'establishments'}`
              : `Showing ${start + 1}–${start + shownCount} of ${total} ${isDrafts ? 'drafts' : 'establishments'}`}
          </span>
          <div className={list.pageBtns}>
            <button
              type="button"
              className={list.pageBtn}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              Prev
            </button>
            {pageList(currentPage, pageCount).map((item, index) =>
              item === 'gap' ? (
                <span key={`gap-${index}`} className={list.pageGap}>
                  …
                </span>
              ) : (
                <button
                  key={item}
                  type="button"
                  className={`${list.pageBtn} ${item === currentPage ? list.pageBtnActive : ''}`}
                  aria-current={item === currentPage ? 'page' : undefined}
                  onClick={() => setPage(item)}
                >
                  {item}
                </button>
              )
            )}
            <button
              type="button"
              className={list.pageBtn}
              onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
              disabled={currentPage >= pageCount}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <EstablishmentAddModal
        open={addOpen}
        draft={editingDraft}
        establishment={editingRow}
        onClose={() => {
          setAddOpen(false);
          setEditingDraft(null);
          setEditingRow(null);
        }}
        onSaved={() => void reload()}
      />

      <EstablishmentConnectModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onSaved={() => void reload()}
      />

      <ConfirmDialog
        open={Boolean(pendingDisable)}
        title={
          pendingDisable ? `Deactivate “${toTitleCase(pendingDisable.businessName)}”?` : 'Deactivate this account?'
        }
        message="They will not be able to sign in until you activate the account again. Public visibility stays under your control."
        confirmLabel="Deactivate"
        confirmingLabel="Deactivating…"
        confirming={saving}
        onConfirm={() => void confirmDisable()}
        onCancel={() => {
          if (!saving) setPendingDisable(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDraftDelete)}
        title={
          pendingDraftDelete?.businessName
            ? `Delete draft “${toTitleCase(pendingDraftDelete.businessName)}”?`
            : 'Delete this draft?'
        }
        message="The saved contact details will be removed. No invitation was ever sent for this draft."
        confirmLabel="Delete"
        confirmingLabel="Deleting…"
        confirming={saving}
        onConfirm={() => void confirmDraftDelete()}
        onCancel={() => {
          if (!saving) setPendingDraftDelete(null);
        }}
      />
    </div>
  );
}

export function AllEstablishmentsPage() {
  return <EstablishmentList mode="all" />;
}

export function PendingEstablishmentsPage() {
  return <EstablishmentList mode="pending" />;
}

export function DeactivatedEstablishmentsPage() {
  return <EstablishmentList mode="deactivated" />;
}

export function DraftEstablishmentsPage() {
  return <EstablishmentList mode="drafts" />;
}
