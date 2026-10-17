import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DestinationMapPicker } from '../components/DestinationMapPicker';
import { useToast } from '../components/Toast';
import {
  type Destination,
  adminPlaceRowToDestination,
  deleteAdminPlace,
  fetchAdminDestinations,
  insertAdminPlace,
  persistGalleryUrls,
  updateAdminPlace,
} from '../lib/destinationPlaces';
import { fetchPlaceCheckinMap, type PlaceCheckinInfo } from '../lib/placeVisits';
import { supabase } from '../lib/supabase';
import styles from './TouristSpots.module.css';

export type { Destination } from '../lib/destinationPlaces';

const CATEGORY_OPTIONS = ['Historical', 'Mountain', 'Beach', 'Cultural', 'Park', 'Food', 'Shopping', 'Other'];

const emptyForm: Omit<Destination, 'id' | 'legacyEmoji' | 'sourceSlug'> = {
  name: '',
  category: '',
  city: '',
  status: 'active',
  address: '',
  description: '',
  lat: '',
  lng: '',
  operatingHours: '',
  phone: '',
  email: '',
  website: '',
  socialFacebook: '',
  socialInstagram: '',
  socialTwitter: '',
  images: [],
};

function destinationToForm(d: Destination): typeof emptyForm {
  const { id: _i, legacyEmoji: _l, sourceSlug: _s, ...rest } = d;
  return rest;
}

export function TouristSpots() {
  const [rows, setRows] = useState<Destination[]>([]);
  const [checkins, setCheckins] = useState<Map<string, PlaceCheckinInfo>>(new Map());
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>('loading');
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('All Cities');
  const [typeFilter, setTypeFilter] = useState('All Types');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Destination | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesAtOpenRef = useRef<string[]>([]);
  const editingSourceSlugRef = useRef('');
  const fileByBlobUrl = useRef<Map<string, File>>(new Map());
  const toast = useToast();

  const revokeUrls = useCallback((urls: string[]) => {
    urls.forEach((u) => {
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    });
  }, []);

  const reload = useCallback(async () => {
    setLoadState('loading');
    try {
      const data = await fetchAdminDestinations(supabase);
      const mapped = data.map(adminPlaceRowToDestination);
      setRows(mapped);
      try {
        const cmap = await fetchPlaceCheckinMap(
          supabase,
          mapped.map((d) => d.id)
        );
        setCheckins(cmap);
      } catch (e) {
        setCheckins(new Map());
        console.warn(e);
      }
      setLoadState('idle');
    } catch (e) {
      setLoadState('error');
      toast(e instanceof Error ? e.message : 'Failed to load destinations', 'error');
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = useCallback(() => {
    return rows.filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) &&
        (cityFilter === 'All Cities' || s.city === cityFilter) &&
        (typeFilter === 'All Types' || s.category === typeFilter)
    );
  }, [rows, search, cityFilter, typeFilter]);

  const openCreate = () => {
    setEditingId(null);
    editingSourceSlugRef.current = '';
    imagesAtOpenRef.current = [];
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (d: Destination) => {
    setEditingId(d.id);
    editingSourceSlugRef.current = d.sourceSlug ?? '';
    const next = destinationToForm(d);
    imagesAtOpenRef.current = [...d.images];
    setForm(next);
    setModalOpen(true);
  };

  const discardStagingBlobs = (currentImages: string[]) => {
    const atOpen = imagesAtOpenRef.current;
    const toRevoke = currentImages.filter((u) => u.startsWith('blob:') && !atOpen.includes(u));
    toRevoke.forEach((u) => fileByBlobUrl.current.delete(u));
    revokeUrls(toRevoke);
  };

  const closeModal = () => {
    discardStagingBlobs(form.images);
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm);
    imagesAtOpenRef.current = [];
    editingSourceSlugRef.current = '';
  };

  const onPickFiles = (files: FileList | null) => {
    if (!files?.length) return;
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i);
      if (f && f.type.startsWith('image/')) {
        const url = URL.createObjectURL(f);
        fileByBlobUrl.current.set(url, f);
        setForm((prev) => ({ ...prev, images: [...prev.images, url] }));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeImageAt = (idx: number) => {
    setForm((f) => {
      const url = f.images[idx];
      const wasStaged = url?.startsWith('blob:') && !imagesAtOpenRef.current.includes(url);
      if (wasStaged) {
        fileByBlobUrl.current.delete(url);
        URL.revokeObjectURL(url);
      }
      const images = f.images.filter((_, i) => i !== idx);
      return { ...f, images };
    });
  };

  // Paste-to-upload: while the edit modal is open, an image copied anywhere
  // (screenshot, right-click copy, etc.) can be pasted with Ctrl+V. It is
  // staged exactly like a picked file and uploaded on Save.
  useEffect(() => {
    if (!modalOpen) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const ext = (blob.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
            files.push(new File([blob], `pasted-${Date.now()}-${i}.${ext}`, { type: blob.type }));
          }
        }
      }
      if (files.length === 0) return;
      e.preventDefault();
      for (const file of files) {
        const url = URL.createObjectURL(file);
        fileByBlobUrl.current.set(url, file);
        setForm((prev) => ({ ...prev, images: [...prev.images, url] }));
      }
      toast(files.length === 1 ? 'Image pasted — remember to Save.' : `${files.length} images pasted — remember to Save.`);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [modalOpen, toast]);

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast('Please enter a destination name', 'error');
      return;
    }
    if (!form.category.trim()) {
      toast('Please choose or enter a category', 'error');
      return;
    }
    const latN = parseFloat(form.lat);
    const lngN = parseFloat(form.lng);
    if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
      toast('Please set valid latitude and longitude (use the map or type coordinates).', 'error');
      return;
    }

    setSaving(true);
    try {
      let placeId = editingId;
      if (!editingId) {
        const ins = await insertAdminPlace(supabase, form);
        placeId = ins.id;
        editingSourceSlugRef.current = ins.source_slug;
      } else {
        await updateAdminPlace(supabase, editingId, form, editingSourceSlugRef.current);
      }
      await persistGalleryUrls(supabase, placeId!, form.images, fileByBlobUrl.current);
      for (const u of form.images) {
        if (u.startsWith('blob:')) {
          fileByBlobUrl.current.delete(u);
          URL.revokeObjectURL(u);
        }
      }
      await reload();
      toast(editingId ? 'Destination updated.' : 'Destination added.');
      setModalOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      imagesAtOpenRef.current = [];
      editingSourceSlugRef.current = '';
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    const d = pendingDelete;
    setDeleting(true);
    try {
      d.images.filter((u) => u.startsWith('blob:')).forEach((u) => URL.revokeObjectURL(u));
      await deleteAdminPlace(supabase, d.id);
      await reload();
      setPendingDelete(null);
      toast('Destination deleted.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const thumbFor = (d: Destination) => {
    const first = d.images[0];
    if (first) {
      return <img src={first} alt="" className={styles.thumbImg} />;
    }
    if (d.legacyEmoji) {
      return <span className={styles.thumb}>{d.legacyEmoji}</span>;
    }
    return <span className={styles.thumb}>?</span>;
  };

  const list = filtered().slice().sort((a, b) => {
    const va = checkins.get(a.id)?.totalVisits ?? 0;
    const vb = checkins.get(b.id)?.totalVisits ?? 0;
    if (vb !== va) return vb - va;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Destinations</h1>
          <p>
            Each establishment gets its own check-in <strong>QR code</strong>. Print/display it at the venue —
            visitors scan with their phone camera and the visit counts for Admin and the establishment.
          </p>
        </div>
      </div>

      <div className={styles.specCard}>
        <strong>Visitor QR (shown on web + mobile app)</strong>
        <ul>
          <li>Each establishment has its own QR. Scanning only confirms check-in (thank-you popup) and counts the visit.</li>
          <li>Web / printed QR → phone opens a thank-you confirmation (keep <code>apps/web</code> running in dev).</li>
          <li>Mobile Expo QR → thank-you alert in the app — no other page opens.</li>
        </ul>
      </div>

      {loadState === 'error' && (
        <div className={styles.bannerErr}>
          <span>Could not load destinations. Check RLS and that the migration has been applied.</span>
          <button type="button" className={styles.retryBtn} onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            placeholder="Search by name, city, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className={styles.filters}>
          <button type="button" className={styles.iconBtn} title="Filter">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          </button>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option>All Cities</option>
            <option>Cavite</option>
            <option>Batangas</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option>All Types</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={styles.addBtn} onClick={openCreate} disabled={loadState === 'loading'}>
          <span>+</span> Add destination
        </button>
      </div>

      <div className={styles.tableWrap}>
        {loadState === 'loading' ? (
          <p className={styles.loading}>Loading destinations…</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Image</th>
                <th>Name</th>
                <th>Category</th>
                <th>City</th>
                <th>Visits</th>
                <th>Check-in QR</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((spot) => {
                const ci = checkins.get(spot.id);
                return (
                <tr key={spot.id} className={styles.row}>
                  <td>{thumbFor(spot)}</td>
                  <td>{spot.name}</td>
                  <td>{spot.category}</td>
                  <td>{spot.city}</td>
                  <td>{ci?.totalVisits ?? 0}</td>
                  <td>
                    {ci?.code ? (
                      <div className={styles.qrCell}>
                        <img src={ci.qrUrl} alt={`QR for ${spot.name}`} width={56} height={56} />
                        <code className={styles.qrCode}>{ci.code}</code>
                      </div>
                    ) : (
                      <span className={styles.muted}>No QR yet</span>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.badge} ${spot.status === 'active' ? styles.active : styles.hidden}`}>
                      {spot.status}
                    </span>
                  </td>
                  <td>
                    <div className={styles.rowActions}>
                      <button type="button" className={styles.linkBtn} onClick={() => openEdit(spot)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className={styles.dangerBtn}
                        onClick={() => setPendingDelete(spot)}
                        disabled={deleting}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        )}
        {loadState === 'idle' && list.length === 0 && (
          <p className={styles.empty}>No admin destinations yet. Add one to create an <code>admin:</code> place row.</p>
        )}
      </div>

      {modalOpen && (
        <div className={styles.overlay} role="presentation" onClick={closeModal}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dest-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="dest-modal-title">{editingId ? 'Edit destination' : 'Add destination'}</h2>
            {editingId && checkins.get(editingId)?.code ? (
              <div className={styles.qrPanel}>
                <img
                  src={checkins.get(editingId)!.qrUrl}
                  alt="Establishment check-in QR"
                  width={180}
                  height={180}
                />
                <div>
                  <p className={styles.qrPanelTitle}>This establishment’s QR (give this to the business)</p>
                  <p className={styles.qrPanelHint}>
                    Print or download this image and post it at the entrance. Visitors scan it with their phone —
                    they should not need to type anything. Visits appear here and on the establishment side.
                  </p>
                  <p>
                    Code: <code>{checkins.get(editingId)!.code}</code>
                  </p>
                  <p className={styles.qrPanelHint}>
                    Visits recorded: <strong>{checkins.get(editingId)!.totalVisits}</strong>
                  </p>
                  <div className={styles.qrActions}>
                    <a
                      href={checkins.get(editingId)!.qrUrl}
                      download={`cavitour-qr-${checkins.get(editingId)!.code}.png`}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.qrActionBtn}
                    >
                      Download QR image
                    </a>
                    <a
                      href={`/checkin/poster/${encodeURIComponent(checkins.get(editingId)!.code)}`}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.qrActionBtnPrimary}
                    >
                      Print QR poster
                    </a>
                    <a href={checkins.get(editingId)!.checkinUrl} target="_blank" rel="noreferrer">
                      Test check-in link
                    </a>
                  </div>
                </div>
              </div>
            ) : editingId ? (
              <p className={styles.qrPanelHint}>
                No QR yet — enable check-in codes for destinations, then reload this page.
              </p>
            ) : null}
            <div className={styles.form}>
              <label className={styles.fieldLabel}>
                Images (multiple)
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className={styles.fileInput}
                  onChange={(e) => onPickFiles(e.target.files)}
                />
              </label>
              <div
                className={styles.pasteZone}
                role="button"
                tabIndex={0}
                aria-label="Paste image from clipboard"
              >
                📋 Paste an image here — press <strong>&nbsp;Ctrl+V&nbsp;</strong> (works anywhere in this window)
              </div>
              <p className={styles.pasteZoneHint}>
                Copy an image first (screenshot tool, right-click → Copy image, or Ctrl+C in your
                file explorer), then paste it above. It uploads when you save.
              </p>
              {form.images.length > 0 && (
                <div className={styles.imageGrid}>
                  {form.images.map((url, idx) => (
                    <div key={`${url}-${idx}`} className={styles.imageTile}>
                      <img src={url} alt="" />
                      <button
                        type="button"
                        className={styles.removeImg}
                        onClick={() => removeImageAt(idx)}
                        aria-label="Remove image"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <DestinationMapPicker
                key={editingId ?? 'create'}
                lat={form.lat}
                lng={form.lng}
                onPick={(la, ln) => {
                  setForm((f) => ({
                    ...f,
                    lat: la.toFixed(6),
                    lng: ln.toFixed(6),
                  }));
                }}
              />

              <input
                placeholder="Destination name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
              <div className={styles.formRow2}>
                <input
                  placeholder="Latitude"
                  value={form.lat}
                  onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                  inputMode="decimal"
                />
                <input
                  placeholder="Longitude"
                  value={form.lng}
                  onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                  inputMode="decimal"
                />
              </div>
              <input
                placeholder="Address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
              <textarea
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
              <div className={styles.formRow2}>
                <input
                  list="dest-categories"
                  placeholder="Category"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                />
                <datalist id="dest-categories">
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <input placeholder="City" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'hidden' }))}
              >
                <option value="active">Active</option>
                <option value="hidden">Hidden</option>
              </select>

              <label className={styles.fieldLabelMuted}>Operating hours</label>
              <textarea
                placeholder="e.g. Mon–Fri 9:00–17:00, Sat 10:00–14:00"
                value={form.operatingHours}
                onChange={(e) => setForm((f) => ({ ...f, operatingHours: e.target.value }))}
                rows={2}
              />

              <label className={styles.fieldLabelMuted}>Contact</label>
              <div className={styles.formRow2}>
                <input
                  placeholder="Phone"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>

              <label className={styles.fieldLabelMuted}>Website &amp; social</label>
              <input
                placeholder="Website URL"
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              />
              <div className={styles.formRow3}>
                <input
                  placeholder="Facebook URL"
                  value={form.socialFacebook}
                  onChange={(e) => setForm((f) => ({ ...f, socialFacebook: e.target.value }))}
                />
                <input
                  placeholder="Instagram URL"
                  value={form.socialInstagram}
                  onChange={(e) => setForm((f) => ({ ...f, socialInstagram: e.target.value }))}
                />
                <input
                  placeholder="X / Twitter URL"
                  value={form.socialTwitter}
                  onChange={(e) => setForm((f) => ({ ...f, socialTwitter: e.target.value }))}
                />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button type="button" className={styles.cancelBtn} onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button type="button" className={styles.saveBtn} onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={pendingDelete ? `Delete “${pendingDelete.name}”?` : 'Delete destination?'}
        message="This cannot be undone."
        confirming={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </div>
  );
}
