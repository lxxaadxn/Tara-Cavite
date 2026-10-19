import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from 'react';
import { ContentCrudPage, CrudBadge } from '../../components/ContentCrudPage';
import { DestinationMapPicker } from '../../components/DestinationMapPicker';
import styles from '../../components/ContentCrudPage.module.css';
import { useToast } from '../../components/Toast';
import { persistStaAboutAndMedia } from '../../lib/staAttractionMedia';
import {
  type StaHighlight,
  type StaV3Form,
  computeIsListed,
  deleteStaV3Row,
  fetchStaV3Rows,
  insertStaV3Row,
  parseCoordsFromMapsUrl,
  rowImages,
  rowToForm,
  updateStaV3Row,
} from '../../lib/staV3CatalogAdmin';
import {
  type StaLookups,
  fetchStaLookups,
  mergeSelectOptions,
  tableSelectOptions,
} from '../../lib/staLookups';
import { fetchPlaceCheckinMap, type PlaceCheckinInfo } from '../../lib/placeVisits';
import { fetchCitiesAdmin, inferLguKind, type CityAdminRow } from '../../lib/staCitiesAdmin';
import { supabase } from '../../lib/supabase';
import { foldLguName } from 'cavitour-shared/lguKind';

/** Admin table/form row (string coords for inputs + About/media/hours/contact). */
type StaCrudRow = {
  id: string;
  ta_name: string;
  city_mun: string;
  barangay: string;
  address: string;
  google_maps_link: string;
  latitude: string;
  longitude: string;
  type_code: string;
  ta_category: string;
  ntdp_category: string;
  highlight: StaHighlight;
  sheet_name: string;
  is_listed: boolean;
  description: string;
  images: string[];
  openingHours: string;
  closingHours: string;
  phone: string;
  email: string;
  website: string;
  /** Search aliases */
  name: string;
  city: string;
};

const emptyForm: Omit<StaCrudRow, 'id'> = {
  ta_name: '',
  city_mun: '',
  barangay: '',
  address: '',
  google_maps_link: '',
  latitude: '',
  longitude: '',
  type_code: '',
  ta_category: '',
  ntdp_category: '',
  highlight: 'none',
  sheet_name: '',
  is_listed: false,
  description: '',
  images: [],
  openingHours: '',
  closingHours: '',
  phone: '',
  email: '',
  website: '',
  name: '',
  city: '',
};

const emptyLookups: StaLookups = {
  typeCodes: [],
  taCategories: [],
  ntdpCategories: [],
  cities: [],
};

function toCrudRow(
  formLike: StaV3Form & {
    id: string;
    is_listed: boolean;
    images?: string[];
  }
): StaCrudRow {
  return {
    id: formLike.id,
    ta_name: formLike.ta_name,
    city_mun: formLike.city_mun ?? '',
    barangay: formLike.barangay ?? '',
    address: formLike.address ?? '',
    google_maps_link: formLike.google_maps_link ?? '',
    latitude: formLike.latitude ?? '',
    longitude: formLike.longitude ?? '',
    type_code: formLike.type_code ?? '',
    ta_category: formLike.ta_category ?? '',
    ntdp_category: formLike.ntdp_category ?? '',
    highlight: formLike.highlight ?? 'none',
    sheet_name: formLike.sheet_name ?? '',
    is_listed: formLike.is_listed,
    description: formLike.description ?? '',
    images: formLike.images ?? [],
    openingHours: formLike.openingHours ?? '',
    closingHours: formLike.closingHours ?? '',
    phone: formLike.phone ?? '',
    email: formLike.email ?? '',
    website: formLike.website ?? '',
    name: formLike.ta_name,
    city: formLike.city_mun ?? '',
  };
}

function toStaForm(form: Omit<StaCrudRow, 'id'>): StaV3Form {
  const city = String(form.city_mun || form.city || '').trim();
  return {
    sheet_name: String(form.sheet_name || city || '').trim(),
    ta_name: String(form.ta_name || form.name || '').trim(),
    type_code: String(form.type_code ?? ''),
    ta_category: String(form.ta_category ?? ''),
    ntdp_category: String(form.ntdp_category ?? ''),
    city_mun: city,
    barangay: String(form.barangay ?? ''),
    address: String(form.address ?? ''),
    google_maps_link: String(form.google_maps_link ?? ''),
    latitude: String(form.latitude ?? ''),
    longitude: String(form.longitude ?? ''),
    highlight: form.highlight ?? 'none',
    description: String(form.description ?? ''),
    openingHours: String(form.openingHours ?? ''),
    closingHours: String(form.closingHours ?? ''),
    phone: String(form.phone ?? ''),
    email: String(form.email ?? ''),
    website: String(form.website ?? ''),
  };
}

function AttractionLocationMap({
  form,
  setForm,
}: {
  form: Omit<StaCrudRow, 'id'>;
  setForm: Dispatch<SetStateAction<Omit<StaCrudRow, 'id'>>>;
}) {
  const link = String(form.google_maps_link ?? '').trim();
  const lastSyncedLink = useRef<string | null>(null);

  useEffect(() => {
    const parsed = parseCoordsFromMapsUrl(link);
    if (lastSyncedLink.current === null) {
      lastSyncedLink.current = link;
      if (!parsed) return;
      setForm((f) => {
        const hasLat = Number.isFinite(parseFloat(String(f.latitude)));
        const hasLng = Number.isFinite(parseFloat(String(f.longitude)));
        if (hasLat && hasLng) return f;
        return {
          ...f,
          latitude: parsed.lat.toFixed(7),
          longitude: parsed.lng.toFixed(7),
        };
      });
      return;
    }
    if (lastSyncedLink.current === link) return;
    lastSyncedLink.current = link;
    if (!parsed) return;
    setForm((f) => ({
      ...f,
      latitude: parsed.lat.toFixed(7),
      longitude: parsed.lng.toFixed(7),
    }));
  }, [link, setForm]);

  const parsed = parseCoordsFromMapsUrl(link);
  const latN = parseFloat(String(form.latitude ?? ''));
  const lngN = parseFloat(String(form.longitude ?? ''));
  const mapLat = Number.isFinite(latN) ? String(latN) : parsed ? String(parsed.lat) : '';
  const mapLng = Number.isFinite(lngN) ? String(lngN) : parsed ? String(parsed.lng) : '';

  return (
    <div className={styles.spanFull}>
      <DestinationMapPicker
        lat={mapLat}
        lng={mapLng}
        onPick={(la, ln) => {
          setForm((f) => ({
            ...f,
            latitude: la.toFixed(7),
            longitude: ln.toFixed(7),
          }));
        }}
      />
    </div>
  );
}

function AttractionCheckinQr({
  editingId,
  checkins,
}: {
  editingId: string | null;
  checkins: Map<string, PlaceCheckinInfo>;
}) {
  if (!editingId) {
    return (
      <p className={styles.qrPanelHint}>
        Save this attraction first to generate its check-in QR code.
      </p>
    );
  }

  const ci = checkins.get(editingId);
  if (!ci) {
    return (
      <p className={styles.qrPanelHint}>
        No QR yet — run <code>PLACE_CHECKIN_ON_STA.sql</code> in Supabase (after STA collapse), then reload.
      </p>
    );
  }

  return (
    <div className={styles.qrPanel}>
      <img src={ci.qrUrl} alt="Establishment check-in QR" width={180} height={180} />
      <div>
        <p className={styles.qrPanelTitle}>Check-in QR (give this to the business)</p>
        <p className={styles.qrPanelHint}>
          Print or download and post at the entrance. Visitors scan with their phone — visits count for
          Admin analytics.
        </p>
        <p>
          Code: <code>{ci.code}</code>
        </p>
        <p className={styles.qrPanelHint}>
          Visits recorded: <strong>{ci.totalVisits}</strong>
        </p>
        <div className={styles.qrActions}>
          <a
            href={ci.qrUrl}
            download={`cavitour-qr-${ci.code}.png`}
            target="_blank"
            rel="noreferrer"
            className={styles.qrActionBtn}
          >
            Download QR image
          </a>
          <a
            href={`/checkin/poster/${encodeURIComponent(ci.code)}`}
            target="_blank"
            rel="noreferrer"
            className={styles.qrActionBtnPrimary}
          >
            Print QR poster
          </a>
          <a href={ci.checkinUrl} target="_blank" rel="noreferrer">
            Test check-in link
          </a>
        </div>
      </div>
    </div>
  );
}

function AttractionAboutPhotos({
  form,
  setForm,
  saving,
  toast,
  fileRef,
  fileByBlobUrl,
  imagesAtOpenRef,
}: {
  form: Omit<StaCrudRow, 'id'>;
  setForm: Dispatch<SetStateAction<Omit<StaCrudRow, 'id'>>>;
  saving: boolean;
  toast: ReturnType<typeof useToast>;
  fileRef: RefObject<HTMLInputElement | null>;
  fileByBlobUrl: MutableRefObject<Map<string, File>>;
  imagesAtOpenRef: MutableRefObject<string[]>;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Paste-to-upload: mounted only while the modal is open, so an image copied
  // anywhere (screenshot, right-click copy, etc.) can be pasted with Ctrl+V.
  // It is staged exactly like a picked file (blob URL registered in
  // fileByBlobUrl and appended to form.images — existing photos are untouched)
  // and uploaded on Save. Closing without saving discards staged blobs via
  // clearBlobMap in the page component.
  useEffect(() => {
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
        setForm((prev) => ({ ...prev, images: [...(prev.images ?? []), url] }));
      }
      toast(
        files.length === 1
          ? 'Image pasted — remember to Save.'
          : `${files.length} images pasted — remember to Save.`
      );
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [setForm, fileByBlobUrl, toast]);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxUrl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxUrl]);

  const reorderImages = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setForm((prev) => {
      const images = [...(prev.images ?? [])];
      if (from >= images.length || to >= images.length) return prev;
      const [item] = images.splice(from, 1);
      images.splice(to, 0, item);
      return { ...prev, images };
    });
  };

  return (
    <div className={styles.extraSection}>
      <div className={styles.formGrid}>
        <label className={styles.field}>
          Opening
          <input
            type="time"
            value={form.openingHours ?? ''}
            disabled={saving}
            onChange={(e) => setForm((prev) => ({ ...prev, openingHours: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Closing
          <input
            type="time"
            value={form.closingHours ?? ''}
            disabled={saving}
            onChange={(e) => setForm((prev) => ({ ...prev, closingHours: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Phone
          <input
            type="tel"
            value={form.phone ?? ''}
            placeholder="Optional"
            disabled={saving}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          />
        </label>
        <label className={styles.field}>
          Email
          <input
            type="email"
            value={form.email ?? ''}
            placeholder="Optional"
            disabled={saving}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          />
        </label>
        <label className={`${styles.field} ${styles.spanFull}`}>
          Social Media
          <input
            type="url"
            value={form.website ?? ''}
            placeholder="https://…"
            disabled={saving}
            onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
          />
        </label>
      </div>
      <label className={styles.field}>
        About
        <textarea
          value={form.description ?? ''}
          placeholder="Public about text…"
          rows={4}
          disabled={saving}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />
      </label>
      <div className={styles.field}>
        <span>Photos</span>
        <p className={styles.photoHint}>
          Drag the handle to change order. The first photo is the cover. You can also press Ctrl+V to
          paste an image copied anywhere — it uploads when you save.
        </p>
        {(form.images ?? []).length > 0 ? (
          <div className={styles.imageGrid}>
            {(form.images ?? []).map((url, idx) => (
              <div
                key={`${url}-${idx}`}
                className={`${styles.imageTile} ${dragFrom === idx ? styles.imageTileDragging : ''} ${
                  dragOver === idx && dragFrom !== null && dragFrom !== idx ? styles.imageTileDrop : ''
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOver !== idx) setDragOver(idx);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  if (Number.isFinite(from)) reorderImages(from, idx);
                  setDragFrom(null);
                  setDragOver(null);
                }}
              >
                <button
                  type="button"
                  className={styles.imageTileBtn}
                  aria-label={idx === 0 ? 'View cover image' : `View image ${idx + 1}`}
                  disabled={saving}
                  onClick={() => setLightboxUrl(url)}
                >
                  <img src={url} alt="" />
                </button>
                {idx === 0 ? <span className={styles.coverBadge}>Cover</span> : null}
                <button
                  type="button"
                  className={styles.imageGrip}
                  draggable={!saving}
                  disabled={saving}
                  aria-label={`Drag to reorder photo ${idx + 1}`}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(idx));
                    const tile = e.currentTarget.closest(`.${styles.imageTile}`);
                    if (tile) e.dataTransfer.setDragImage(tile, 44, 44);
                    setDragFrom(idx);
                  }}
                  onDragEnd={() => {
                    setDragFrom(null);
                    setDragOver(null);
                  }}
                >
                  <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden>
                    <circle cx="3" cy="3" r="1.4" />
                    <circle cx="9" cy="3" r="1.4" />
                    <circle cx="3" cy="8" r="1.4" />
                    <circle cx="9" cy="8" r="1.4" />
                    <circle cx="3" cy="13" r="1.4" />
                    <circle cx="9" cy="13" r="1.4" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={styles.removeImg}
                  aria-label="Remove image"
                  disabled={saving}
                  onClick={(e) => {
                    e.stopPropagation();
                    setForm((prev) => {
                      const images = [...(prev.images ?? [])];
                      const [removed] = images.splice(idx, 1);
                      if (
                        removed?.startsWith('blob:') &&
                        !imagesAtOpenRef.current.includes(removed)
                      ) {
                        fileByBlobUrl.current.delete(removed);
                        URL.revokeObjectURL(removed);
                      }
                      return { ...prev, images };
                    });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles.loadState}>No photos yet</p>
        )}
        <label className={styles.fileBtn}>
          Add images
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            disabled={saving}
            onChange={(e) => {
              const files = e.target.files;
              if (!files?.length) return;
              for (let i = 0; i < files.length; i++) {
                const f = files.item(i);
                if (f && f.type.startsWith('image/')) {
                  const url = URL.createObjectURL(f);
                  fileByBlobUrl.current.set(url, f);
                  setForm((prev) => ({ ...prev, images: [...(prev.images ?? []), url] }));
                }
              }
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
        </label>
      </div>
      {lightboxUrl ? (
        <div
          className={styles.lightbox}
          role="presentation"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            className={styles.lightboxClose}
            aria-label="Close"
            onClick={() => setLightboxUrl(null)}
          >
            ×
          </button>
          <img
            src={lightboxUrl}
            alt=""
            className={styles.lightboxImg}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ContentEstablishments() {
  const toast = useToast();
  const [rows, setRows] = useState<StaCrudRow[]>([]);
  const [checkins, setCheckins] = useState<Map<string, PlaceCheckinInfo>>(new Map());
  const [lookups, setLookups] = useState<StaLookups>(emptyLookups);
  const [lguRows, setLguRows] = useState<CityAdminRow[]>([]);
  const [locationFilter, setLocationFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileByBlobUrl = useRef<Map<string, File>>(new Map());
  const imagesAtOpenRef = useRef<string[]>([]);

  const clearBlobMap = useCallback(() => {
    for (const u of fileByBlobUrl.current.keys()) {
      URL.revokeObjectURL(u);
    }
    fileByBlobUrl.current.clear();
    imagesAtOpenRef.current = [];
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, nextLookups, nextLgus] = await Promise.all([
        fetchStaV3Rows(supabase),
        fetchStaLookups(supabase),
        fetchCitiesAdmin(supabase).catch(() => [] as CityAdminRow[]),
      ]);
      setLookups(nextLookups);
      setLguRows(nextLgus);
      const mapped = data.map((row) =>
        toCrudRow({
          id: row.id,
          is_listed: row.is_listed,
          ...rowToForm(row),
          images: rowImages(row),
        })
      );
      setRows(mapped);
      try {
        const cmap = await fetchPlaceCheckinMap(
          supabase,
          mapped.map((r) => r.id)
        );
        setCheckins(cmap);
        if (mapped.length > 0 && cmap.size === 0) {
          toast(
            'No check-in codes found for these places. Run PLACE_CHECKIN_ON_STA.sql in Supabase, then reload.',
            'error'
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load check-in QR codes';
        console.warn('[ContentEstablishments] check-in codes:', e);
        setCheckins(new Map());
        toast(msg, 'error');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load STA attractions';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const locationFilterOptions = useMemo(() => {
    const cities =
      lguRows.length > 0
        ? lguRows.filter((r) => r.kind === 'city').map((r) => r.name)
        : lookups.cities.filter((c) => inferLguKind(c.label) === 'city').map((c) => c.label);
    const municipalities =
      lguRows.length > 0
        ? lguRows.filter((r) => r.kind === 'municipality').map((r) => r.name)
        : lookups.cities.filter((c) => inferLguKind(c.label) === 'municipality').map((c) => c.label);
    return [
      { value: '', label: 'All locations' },
      ...cities.map((name) => ({ value: name, label: name })),
      ...municipalities.map((name) => ({ value: name, label: name })),
    ];
  }, [lguRows, lookups.cities]);
  const matchesLguFilter = useCallback(
    (row: StaCrudRow) => {
      if (!locationFilter) return true;
      return foldLguName(row.city_mun || row.city) === foldLguName(locationFilter);
    },
    [locationFilter]
  );
  const cityOptions = useMemo(() => tableSelectOptions(lookups.cities), [lookups.cities]);
  const taCategoryOptions = useMemo(
    () => tableSelectOptions(lookups.taCategories),
    [lookups.taCategories]
  );
  const typeCodeOptions = useMemo(
    () => mergeSelectOptions(
      lookups.typeCodes,
      rows.map((r) => r.type_code)
    ),
    [lookups.typeCodes, rows]
  );
  const ntdpOptions = useMemo(
    () => mergeSelectOptions(
      lookups.ntdpCategories,
      rows.map((r) => r.ntdp_category)
    ),
    [lookups.ntdpCategories, rows]
  );

  const saveStaAndMedia = async (form: Omit<StaCrudRow, 'id'>, staId?: string) => {
    const staForm = toStaForm(form);
    const saved = staId
      ? await updateStaV3Row(supabase, staId, staForm)
      : await insertStaV3Row(supabase, staForm);
    await persistStaAboutAndMedia(supabase, {
      staId: saved.id,
      description: String(form.description ?? ''),
      images: form.images ?? [],
      fileByBlobUrl: fileByBlobUrl.current,
      openingHours: String(form.openingHours ?? ''),
      closingHours: String(form.closingHours ?? ''),
      phone: String(form.phone ?? ''),
      email: String(form.email ?? ''),
      website: String(form.website ?? ''),
    });
    for (const u of form.images ?? []) {
      if (u.startsWith('blob:')) {
        fileByBlobUrl.current.delete(u);
        URL.revokeObjectURL(u);
      }
    }
    imagesAtOpenRef.current = [];
    return saved;
  };

  const handleCreate = async (form: Omit<StaCrudRow, 'id'>) => {
    await saveStaAndMedia(form);
    toast('Attraction created', 'success');
    await reload();
  };

  const handleUpdate = async (id: string, form: Omit<StaCrudRow, 'id'>) => {
    await saveStaAndMedia(form, id);
    toast('Attraction updated', 'success');
    await reload();
  };

  const handleDelete = async (id: string) => {
    await deleteStaV3Row(supabase, id);
    toast('Attraction deleted', 'success');
    await reload();
  };

  const toggleListing = async (row: StaCrudRow, nextHighlight: StaHighlight) => {
    const form: Omit<StaCrudRow, 'id'> = {
      ...emptyForm,
      ...row,
      name: row.ta_name,
      city: row.city_mun,
      description: row.description ?? '',
      images: [...(row.images ?? [])],
      openingHours: row.openingHours ?? '',
      closingHours: row.closingHours ?? '',
      phone: row.phone ?? '',
      email: row.email ?? '',
      website: row.website ?? '',
      highlight: nextHighlight,
    };
    await saveStaAndMedia(form, row.id);
    if (nextHighlight === 'red') {
      toast('Attraction hidden', 'success');
    } else {
      const willList = computeIsListed({
        address: form.address,
        google_maps_link: form.google_maps_link,
        highlight: nextHighlight,
      });
      if (willList) toast('Attraction listed', 'success');
      else {
        toast(
          'Display set, but it still needs an address and Google Maps link to appear as Listed.',
          'info'
        );
      }
    }
    await reload();
  };

  const tableColumns = useMemo(
    () => [
      {
        key: 'photo',
        header: 'Photo',
        render: (r: StaCrudRow) =>
          r.images[0] ? (
            <img src={r.images[0]} alt="" className={styles.tableThumb} />
          ) : (
            <span className={styles.tableThumbEmpty}>—</span>
          ),
      },
      { key: 'name', header: 'Name', render: (r: StaCrudRow) => <strong>{r.ta_name}</strong> },
      { key: 'city', header: 'City', render: (r: StaCrudRow) => r.city_mun || '—' },
      { key: 'barangay', header: 'Barangay', render: (r: StaCrudRow) => r.barangay || '—' },
      {
        key: 'visits',
        header: 'Visits',
        render: (r: StaCrudRow) => checkins.get(r.id)?.totalVisits ?? 0,
      },
      {
        key: 'qr',
        header: 'Check-in QR',
        render: (r: StaCrudRow) => {
          const ci = checkins.get(r.id);
          if (!ci) return <span className={styles.muted}>No code</span>;
          return (
            <div className={styles.qrCell}>
              <img src={ci.qrUrl} alt={`QR for ${r.ta_name}`} width={48} height={48} />
              <code className={styles.qrCode}>{ci.code}</code>
            </div>
          );
        },
      },
      {
        key: 'highlight',
        header: 'Display',
        render: (r: StaCrudRow) => {
          if (r.highlight === 'red') return <CrudBadge label="Hidden" tone="neutral" />;
          if (r.highlight === 'yellow') return <CrudBadge label="Festivals" tone="amber" />;
          return <CrudBadge label="Display" tone="green" />;
        },
      },
    ],
    [checkins]
  );

  return (
    <ContentCrudPage<StaCrudRow>
      title="Tourist Attractions"
      modalSize="wide"
      rows={rows}
      loading={loading}
      error={error}
      emptyForm={emptyForm}
      addLabel="Add attraction"
      onCreate={handleCreate}
      onUpdate={handleUpdate}
      onDelete={handleDelete}
      onModalClose={() => {
        clearBlobMap();
      }}
      onOpenCreate={() => {
        clearBlobMap();
        imagesAtOpenRef.current = [];
      }}
      toForm={(row) => {
        clearBlobMap();
        imagesAtOpenRef.current = [...(row.images ?? [])];
        return {
          ...emptyForm,
          ...row,
          name: row.ta_name,
          city: row.city_mun,
          description: row.description ?? '',
          images: [...(row.images ?? [])],
          openingHours: row.openingHours ?? '',
          closingHours: row.closingHours ?? '',
          phone: row.phone ?? '',
          email: row.email ?? '',
          website: row.website ?? '',
        };
      }}
      searchKeys={[
        'ta_name',
        'city_mun',
        'barangay',
        'address',
        'name',
        'city',
        'type_code',
        'ta_category',
        'ntdp_category',
        'description',
        'phone',
        'email',
        'website',
      ]}
      statusFilter={{
        options: [
          { value: 'listed', label: 'Listed' },
          { value: 'hidden', label: 'Hidden' },
        ],
        match: (row, value) => (value === 'listed' ? row.is_listed : !row.is_listed),
      }}
      selectFilters={[
        {
          key: 'location',
          label: 'City or municipality',
          value: locationFilter,
          options: locationFilterOptions,
          onChange: setLocationFilter,
        },
      ]}
      rowFilter={matchesLguFilter}
      fields={[
        { key: 'ta_name', label: 'Name', required: true, span: 'full' },
        {
          key: 'city_mun',
          label: 'City / Municipality',
          type: 'select',
          required: true,
          options: cityOptions,
        },
        { key: 'barangay', label: 'Barangay' },
        { key: 'address', label: 'Address', type: 'textarea', span: 'full' },
        { key: 'google_maps_link',
          label: 'Google Maps link',
          placeholder: 'https://www.google.com/maps/...',
          span: 'full',
        },
        { key: 'latitude', label: 'Latitude', placeholder: 'From Maps link if empty' },
        { key: 'longitude', label: 'Longitude', placeholder: 'From Maps link if empty' },
        {
          key: 'type_code',
          label: 'Type code',
          type: 'select',
          options: typeCodeOptions,
        },
        {
          key: 'ta_category',
          label: 'TA category',
          type: 'select',
          options: taCategoryOptions,
        },
        {
          key: 'ntdp_category',
          label: 'NTDP category',
          type: 'select',
          options: ntdpOptions,
        },
        {
          key: 'highlight',
          label: 'Display',
          type: 'select',
          options: [
            { value: 'none', label: 'Display' },
            { value: 'red', label: 'Hidden' },
            { value: 'yellow', label: 'Festivals' },
          ],
        },
      ]}
      renderAfterField={(key, { form, setForm }) =>
        key === 'google_maps_link' ? <AttractionLocationMap form={form} setForm={setForm} /> : null
      }
      renderExtraForm={({ form, setForm, saving, editingId }) => (
        <>
          <AttractionCheckinQr editingId={editingId} checkins={checkins} />
          <AttractionAboutPhotos
            form={form}
            setForm={setForm}
            saving={saving}
            toast={toast}
            fileRef={fileRef}
            fileByBlobUrl={fileByBlobUrl}
            imagesAtOpenRef={imagesAtOpenRef}
          />
        </>
      )}
      columns={tableColumns}
      getColumns={(tab) =>
        tab === 'listed' || tab === 'hidden'
          ? tableColumns.filter((col) => col.key !== 'highlight')
          : tableColumns
      }
      rowMenuItems={(row, { status: tab, saving }) =>
        tab === 'hidden' && !saving
          ? [{ label: 'Show on app', onSelect: () => void toggleListing(row, 'none') }]
          : []
      }
    />
  );
}
