import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { Header } from '../components/Header';
import { JamIcon } from '../components/JamIcon';
import { SaveToListSheet, type SaveToListRow } from '../components/SaveToListSheet';
import { Toast, type ToastData } from '../components/Toast';
import { AppDialog, type AppDialogData } from '../components/AppDialog';
import { Place } from '../data/mockData';
import { parsePlaceCoords } from '../lib/placeCoords';
import { placeImageSource } from '../lib/placeImageSource';
import { formatNtdpCategoryTagLabel } from '../lib/ntdpDisplayLabels';
import {
  fetchDrivingRoute,
  fetchFootRoute,
  formatDistanceM,
  formatDurationS,
  type OsrmRouteResult,
} from '../lib/fetchOsrmRoute';
import { commuterDirectStepInstruction } from '../lib/commuterRouteNarration';
import { buildCommuterGuideSteps } from 'cavitour-shared/commuterGuideBuilder';
import type { DirectionsMapPayload } from '../lib/directionsMapBridge';
import { supabase } from '../lib/supabase';
import {
  isSupabasePlaceId,
  isPlaceSavedByUser,
  isItinerarySavedByUser,
  removePlaceFromAllUserLists,
  removeItineraryFromAllUserLists,
  addPlaceToSavedList,
  addItineraryToSavedList,
  placeRowExists,
  fetchUserListsForPickerWithCounts,
  findOrCreateListByName,
} from '../lib/savedListItems';
import {
  alertAfterSaveToList,
  SAVE_TO_LIST_CREATE_BUSY_ID,
  suggestedSaveListName,
} from '../lib/saveToListModalHelpers';
import { recordDestinationReached } from '../lib/destinationReachedActivity';
import { recordPlaceVisit } from 'cavitour-shared/placeCheckin';
import { fetchPlaceById, haversineDistanceKm } from '../lib/placesFromSupabase';
import { DirectionsMapView } from '../components/DirectionsMapView';

const GREEN = '#10A37F';
const TEAL = '#1B8A70';
const OLIVE = '#213502';
const TITLE = '#241D13';
const MUTED = '#868686';
const WHITE = '#FFFFFF';
const PAGE_BG = '#FAFAF8';
const CARD_BORDER = 'rgba(122, 120, 120, 0.18)';
/** Shown above route content — commuters are the primary audience. */
const COMMUTER_DISCLAIMER =
  'Steps follow the mapped road (OSRM / OpenStreetMap), not live transit schedules. Confirm signs, fares, and stops with operators.';

const COMMUTER_FOOTNOTE = 'Roads and stops change — double-check locally, especially if you drive.';

const PILL_STYLES = {
  green: { bg: 'rgba(16, 163, 127, 0.5)', text: GREEN },
  teal: { bg: 'rgba(27, 138, 112, 0.5)', text: TEAL },
} as const;

type PillVariant = keyof typeof PILL_STYLES;

export type DirectionsScreenParams = {
  place: Place;
  /** Live GPS updates on the map while this screen is open (foreground). */
  caviTrip?: boolean;
};

function shouldShowTaCategoryTag(place: Place, includeTaCategory: boolean): boolean {
  if (includeTaCategory) return true;
  const ta = place.ta_category?.trim();
  if (!ta) return true;
  const typeLabel = (place.type || '').trim();
  if (!typeLabel) return false;
  return typeLabel.toLowerCase() !== ta.toLowerCase();
}

function buildTags(
  place: Place,
  options?: { includeTaCategory?: boolean }
): { label: string; variant: PillVariant }[] {
  const includeTaCategory = options?.includeTaCategory !== false;
  const out: { label: string; variant: PillVariant }[] = [];
  if (place.type && shouldShowTaCategoryTag(place, includeTaCategory)) {
    out.push({ label: place.type, variant: 'green' });
  }
  if (place.ntdp_category) {
    out.push({ label: formatNtdpCategoryTagLabel(place.ntdp_category), variant: 'teal' });
  } else if (!place.ntdp_category) {
    out.push({ label: 'Alfresco', variant: 'teal' });
  }
  return out;
}

function commuterStepHint(index: number, total: number, stepDistanceM: number): string {
  if (total <= 0 || stepDistanceM < 200) return '';
  if (index === total - 1) {
    return 'PUVs may stop before narrow streets — ask to alight at a main corner if needed.';
  }
  return 'If your ride leaves this road, transfer at a crossing or nearby stop.';
}

function placeImageUriForActivity(place: Place): string | undefined {
  const img = place.image as unknown;
  if (img == null) return undefined;
  if (typeof img === 'number') return undefined;
  if (typeof img === 'object' && img !== null && 'uri' in img) {
    return String((img as { uri: string }).uri);
  }
  return undefined;
}

/**
 * Route & map flow: same green chrome as establishment details (no legacy purple header).
 * Opened from “Get directions” with `{ place }`.
 */
const DirectionsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const raw = route.params as DirectionsScreenParams | undefined;
  const place = raw?.place;
  const caviTrip = Boolean(raw?.caviTrip);

  const isItinerary = place?.type === 'Itinerary';
  const [catalogCoords, setCatalogCoords] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!place?.id) {
      setCatalogCoords(null);
      return;
    }
    let cancelled = false;
    fetchPlaceById(supabase, place.id)
      .then((catalog) => {
        if (cancelled) return;
        setCatalogCoords(catalog ? parsePlaceCoords(catalog) : null);
      })
      .catch(() => {
        if (!cancelled) setCatalogCoords(null);
      });
    return () => {
      cancelled = true;
    };
  }, [place?.id]);

  const destCoords = useMemo(() => {
    if (catalogCoords) return catalogCoords;
    return place ? parsePlaceCoords(place) : null;
  }, [place, catalogCoords]);

  const [tab, setTab] = useState<'routeSteps' | 'stepGuide'>(caviTrip ? 'stepGuide' : 'routeSteps');
  const [userPt, setUserPt] = useState<{ lat: number; lng: number } | null>(null);
  /** Updated while CaviTrip is on — map dot follows you; route stays from the first fix. */
  const [liveUserPt, setLiveUserPt] = useState<{ lat: number; lng: number } | null>(null);
  const [locStatus, setLocStatus] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [routeDriving, setRouteDriving] = useState<OsrmRouteResult | null>(null);
  const [routeFoot, setRouteFoot] = useState<OsrmRouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [saved, setSaved] = useState(false);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [pickLists, setPickLists] = useState<SaveToListRow[]>([]);
  const [listNameDraft, setListNameDraft] = useState('');
  const [saveListBusyId, setSaveListBusyId] = useState<string | null>(null);
  const [checkingSaved, setCheckingSaved] = useState(false);
  const [destinationReachedBusy, setDestinationReachedBusy] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [dialog, setDialog] = useState<AppDialogData | null>(null);

  const tags = useMemo(
    () => (place ? buildTags(place, { includeTaCategory: !caviTrip }) : []),
    [place, caviTrip]
  );
  const commuteFromLabel = userPt ? 'Your current location' : 'Current location';

  useEffect(() => {
    if (!place) return;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        setLocStatus('denied');
        return;
      }
      setLocStatus('granted');
      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) {
          const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserPt(pt);
          if (caviTrip) setLiveUserPt(pt);
        }
      } catch {
        if (!cancelled) {
          setLocStatus('denied');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place, caviTrip]);

  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);
  const destinationRecordedRef = useRef(false);

  useEffect(() => {
    if (caviTrip && tab === 'routeSteps') {
      setTab('stepGuide');
    }
  }, [caviTrip, tab]);

  useEffect(() => {
    if (!place || !caviTrip || locStatus !== 'granted') {
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
      return;
    }
    let cancelled = false;
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 8000,
        distanceInterval: 35,
      },
      (loc) => {
        if (!cancelled) {
          setLiveUserPt({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        }
      }
    )
      .then((sub) => {
        if (cancelled) {
          sub.remove();
          return;
        }
        locationWatchRef.current?.remove();
        locationWatchRef.current = sub;
      })
      .catch(() => {
        /* keep last live position */
      });
    return () => {
      cancelled = true;
      locationWatchRef.current?.remove();
      locationWatchRef.current = null;
    };
  }, [place, caviTrip, locStatus]);

  useEffect(() => {
    if (!place || !destCoords || !userPt) {
      setRouteDriving(null);
      setRouteFoot(null);
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setRouteLoading(true);
      setRouteError(null);
      try {
        const [d, f] = await Promise.all([
          fetchDrivingRoute(userPt, destCoords),
          fetchFootRoute(userPt, destCoords),
        ]);
        if (cancelled) return;
        setRouteDriving(d);
        setRouteFoot(f);
        if (!d) {
          setRouteError(
            'No road corridor found between you and this place. Open the full map to plan transfers or walk links manually.'
          );
        }
      } catch {
        if (!cancelled) {
          setRouteDriving(null);
          setRouteFoot(null);
          setRouteError('Could not load this corridor. Check your connection and try again.');
        }
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place, destCoords, userPt]);

  const routeSegmentsGeoJson = useMemo(() => {
    const main = routeDriving?.geometry ?? routeFoot?.geometry ?? null;
    if (!main?.coordinates?.length || main.coordinates.length <= 1) return null;
    return [main];
  }, [routeDriving?.geometry, routeFoot?.geometry]);

  const commuterGuideSteps = useMemo(() => {
    if (!place) return [];
    return buildCommuterGuideSteps({
      userPt,
      destPt: destCoords,
      destinationName: place.name,
      destMunicipality: place.city_mun,
      osrmSteps: routeDriving?.steps ?? [],
    });
  }, [place, userPt, destCoords, routeDriving?.steps]);

  const mapUserPt = caviTrip ? liveUserPt ?? userPt : userPt;

  const mapPayload: DirectionsMapPayload = useMemo(
    () => ({
      userLat: mapUserPt?.lat ?? null,
      userLng: mapUserPt?.lng ?? null,
      destLat: destCoords?.lat ?? 0,
      destLng: destCoords?.lng ?? 0,
      routeGeoJson: routeDriving?.geometry ?? routeFoot?.geometry ?? null,
      routeSegmentsGeoJson,
    }),
    [mapUserPt, destCoords, routeDriving, routeFoot, routeSegmentsGeoJson]
  );

  const refreshSavedState = useCallback(async () => {
    if (!place) {
      setSaved(false);
      setCheckingSaved(false);
      return;
    }
    setCheckingSaved(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setSaved(false);
        return;
      }
      if (isItinerary) {
        const yes = await isItinerarySavedByUser(supabase, user.id, place.id);
        setSaved(yes);
        return;
      }
      if (!isSupabasePlaceId(place.id)) {
        setSaved(false);
        return;
      }
      const yes = await isPlaceSavedByUser(supabase, user.id, place.id);
      setSaved(yes);
    } catch {
      setSaved(false);
    } finally {
      setCheckingSaved(false);
    }
  }, [place, isItinerary]);

  useEffect(() => {
    refreshSavedState();
  }, [refreshSavedState]);

  useFocusEffect(
    useCallback(() => {
      refreshSavedState();
    }, [refreshSavedState])
  );

  const saveItemToList = async (listId: string) => {
    if (!place) return { ok: false as const, duplicate: false, message: 'Missing place.' };
    if (isItinerary) return addItineraryToSavedList(supabase, listId, place.id);
    if (!isSupabasePlaceId(place.id)) {
      return { ok: false as const, duplicate: false, message: 'Invalid place id.' };
    }
    return addPlaceToSavedList(supabase, listId, place.id);
  };

  const openSaveToListPicker = async () => {
    if (!place) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setDialog({
        title: 'Sign in',
        message: 'Sign in to save to your lists.',
        buttons: [{ label: 'OK', onPress: () => undefined }],
      });
      return;
    }

    if (!isItinerary) {
      if (!isSupabasePlaceId(place.id)) {
        setToast({
          message: 'Only catalog locations with a database id can be added to a saved list.',
          tone: 'info',
        });
        return;
      }
      const exists = await placeRowExists(supabase, place.id);
      if (!exists) {
        setToast({ message: 'This location is not in the catalog yet and can’t be saved.', tone: 'error' });
        return;
      }
    }

    try {
      const lists = await fetchUserListsForPickerWithCounts(supabase, user.id);
      setListNameDraft(suggestedSaveListName(place.ntdp_category));
      setPickLists(lists);
      setSaveModalVisible(true);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not load lists.', tone: 'error' });
    }
  };

  const onConfirmRemoveSave = () => {
    if (!place) return;
    setDialog({
      title: 'Remove from saved lists?',
      message: 'This removes the item from every list it’s in.',
      buttons: [
        { label: 'Cancel', variant: 'text', onPress: () => undefined },
        {
          label: 'Remove',
          variant: 'danger',
          onPress: () => {
            void (async () => {
              try {
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (!user) {
                  setSaved(false);
                  return;
                }
                if (isItinerary) {
                  await removeItineraryFromAllUserLists(supabase, user.id, place.id);
                } else if (isSupabasePlaceId(place.id)) {
                  await removePlaceFromAllUserLists(supabase, user.id, place.id);
                }
                setSaved(false);
                setToast({ message: 'Removed from saved lists', tone: 'success' });
              } catch (e) {
                setDialog({
                  title: 'Error',
                  message: e instanceof Error ? e.message : 'Could not update saved lists.',
                  buttons: [{ label: 'OK', onPress: () => undefined }],
                });
              }
            })();
          },
        },
      ],
    });
  };

  const onPressSaveFab = () => {
    if (saved) onConfirmRemoveSave();
    else openSaveToListPicker();
  };

  const notifySaveResult = useCallback(
    (title: string, message: string, tone?: 'success' | 'error' | 'info') => {
      setToast({ message, tone: tone ?? 'info' });
    },
    []
  );

  const onPickList = async (list: SaveToListRow) => {
    if (!place) return;
    setSaveListBusyId(list.id);
    try {
      const res = await saveItemToList(list.id);
      alertAfterSaveToList(res, place.name, list.name, () => {
        setSaveModalVisible(false);
        setSaved(true);
      }, notifySaveResult);
    } finally {
      setSaveListBusyId(null);
    }
  };

  const onCreateList = async () => {
    if (!place) return;
    const trimmed = listNameDraft.trim();
    if (!trimmed) return;
    setSaveListBusyId(SAVE_TO_LIST_CREATE_BUSY_ID);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const list = await findOrCreateListByName(supabase, user.id, trimmed);
      if (!list) return;
      const res = await saveItemToList(list.id);
      alertAfterSaveToList(res, place.name, list.name, () => {
        setSaveModalVisible(false);
        setSaved(true);
      }, notifySaveResult);
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Could not create list.', tone: 'error' });
    } finally {
      setSaveListBusyId(null);
    }
  };

  const openFullMap = async () => {
    if (!destCoords || !place) {
      Alert.alert('Map unavailable', 'This destination does not have map coordinates yet.');
      return;
    }
    const routeOrigin = userPt ?? mapUserPt;
    let routeGeoJson = mapPayload.routeGeoJson;
    if (!routeGeoJson && routeOrigin) {
      try {
        const d = await fetchDrivingRoute(routeOrigin, destCoords);
        routeGeoJson = d?.geometry ?? routeFoot?.geometry ?? null;
      } catch {
        routeGeoJson = routeFoot?.geometry ?? null;
      }
    }
    const outgoing = {
      userLat: mapUserPt?.lat ?? null,
      userLng: mapUserPt?.lng ?? null,
      destLat: destCoords.lat,
      destLng: destCoords.lng,
      routeGeoJson,
      routeSegmentsGeoJson: routeSegmentsGeoJson ?? (routeGeoJson ? [routeGeoJson] : null),
    };
    (navigation as { navigate: (name: string, params: object) => void }).navigate('FullRouteMap', {
      mapPayload: outgoing,
      destinationName: place.name,
    });
  };

  useEffect(() => {
    destinationRecordedRef.current = false;
  }, [place?.id]);

  const tryRecordDestinationReached = useCallback(async () => {
    if (!place?.id || destinationRecordedRef.current) return false;
    if (!isSupabasePlaceId(place.id)) {
      destinationRecordedRef.current = true;
      return false;
    }
    setDestinationReachedBusy(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        destinationRecordedRef.current = true;
        return false;
      }
      await recordDestinationReached(user.id, place.id, {
        name: place.name,
        image: placeImageUriForActivity(place),
      });
      try {
        await recordPlaceVisit(supabase, place.id, 'destination_reached');
      } catch {
        // Local visit still saved; cloud visit may fail if SQL not applied yet.
      }
      destinationRecordedRef.current = true;
      setToast({ message: 'Thank you and enjoy your trip!', tone: 'success' });
      return true;
    } catch {
      return false;
    } finally {
      setDestinationReachedBusy(false);
    }
  }, [place]);

  const onDestinationReached = useCallback(() => {
    void tryRecordDestinationReached();
  }, [tryRecordDestinationReached]);

  /** CaviTrip: record visit automatically when within ~200 m of the destination. */
  useEffect(() => {
    if (!caviTrip || !liveUserPt || !destCoords || destinationRecordedRef.current) return;
    const km = haversineDistanceKm(
      liveUserPt.lat,
      liveUserPt.lng,
      destCoords.lat,
      destCoords.lng
    );
    if (km > 0.2) return;
    void tryRecordDestinationReached();
  }, [caviTrip, liveUserPt, destCoords, tryRecordDestinationReached]);

  if (!place) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 24, backgroundColor: PAGE_BG }]}>
        <Text style={styles.missingText}>No destination selected.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.missingBack}>
          <Text style={styles.missingBackLabel}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: PAGE_BG }]}>
      <Header title={place.name} showBack darkBackground />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {!caviTrip ? (
          <View style={styles.heroWrap}>
            {placeImageSource(place.image) ? (
              <Image
                source={placeImageSource(place.image)!}
                style={styles.heroImage}
                resizeMode="cover"
                accessibilityLabel={`${place.name} photo`}
              />
            ) : (
              <View style={[styles.heroImage, styles.heroPlaceholder]}>
                <JamIcon ionicon="image-outline" size={48} color={MUTED} />
              </View>
            )}
          </View>
        ) : null}

        {caviTrip && destCoords ? (
          <View style={styles.caviTripMapCard}>
            <DirectionsMapView payload={mapPayload} style={styles.caviTripMapInner} />
            {locStatus === 'denied' ? (
              <Text style={styles.caviTripMapHint}>
                Allow location access to see your position and the blue route on the map.
              </Text>
            ) : routeLoading && !routeDriving ? (
              <Text style={styles.caviTripMapHint}>Loading route…</Text>
            ) : null}
          </View>
        ) : null}

        <Text style={styles.placeName}>{place.name}</Text>

        <View style={styles.tagsAndActionsRow}>
          <View style={styles.pillRow}>
            {tags.map((t) => {
              const ps = PILL_STYLES[t.variant];
              return (
                <View key={`${t.label}-${t.variant}`} style={[styles.pill, { backgroundColor: ps.bg }]}>
                  <Text style={[styles.pillText, { color: ps.text }]}>{t.label}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.actionPair}>
            <TouchableOpacity
              style={[styles.fab, styles.fabSave, saved && styles.fabSaveActive]}
              onPress={onPressSaveFab}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove save' : 'Save'}
              activeOpacity={0.82}
              disabled={checkingSaved}
            >
              {checkingSaved ? (
                <ActivityIndicator size="small" color={saved ? WHITE : GREEN} />
              ) : (
                <JamIcon ionicon="bookmark-outline" size={20} color={saved ? WHITE : GREEN} />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.segmentWrap} accessibilityRole="tablist">
          {!caviTrip ? (
            <Pressable
              onPress={() => setTab('routeSteps')}
              style={[styles.segmentSlot, tab === 'routeSteps' && styles.segmentSlotActive]}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === 'routeSteps' }}
            >
              <Text
                style={[
                  styles.segmentLabel,
                  styles.segmentLabelCompact,
                  tab === 'routeSteps' ? styles.segmentLabelOn : styles.segmentLabelOff,
                ]}
                numberOfLines={2}
              >
                Commute steps
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setTab('stepGuide')}
            style={[styles.segmentSlot, tab === 'stepGuide' && styles.segmentSlotActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'stepGuide' }}
          >
            <Text
              style={[
                styles.segmentLabel,
                styles.segmentLabelCompact,
                tab === 'stepGuide' ? styles.segmentLabelOn : styles.segmentLabelOff,
              ]}
              numberOfLines={2}
            >
              Commuter guide
            </Text>
          </Pressable>
        </View>

        {tab === 'routeSteps' && !caviTrip ? (
          <View style={styles.routeCard}>
            <View style={styles.mapsPlannerCard}>
              <View style={styles.mapsInputCard}>
                <View style={styles.mapsInputRow}>
                  <JamIcon ionicon="radio-button-off-outline" size={16} color={TITLE} />
                  <Text style={styles.mapsInputText} numberOfLines={1}>
                    {commuteFromLabel}
                  </Text>
                </View>
                <View style={styles.mapsInputDivider} />
                <View style={styles.mapsInputRow}>
                  <JamIcon ionicon="location" size={16} color="#d22b2b" />
                  <Text style={styles.mapsInputText} numberOfLines={1}>
                    {place.name}
                  </Text>
                </View>
              </View>
              {routeDriving ? (
                <View style={styles.routeTripSummaryBox}>
                  <Text style={styles.routeTripSummaryLabel}>Trip length (driving route)</Text>
                  <Text style={styles.routeTripSummaryValue}>
                    {formatDistanceM(routeDriving.distanceM)}
                    {routeDriving.durationS ? ` · ~${formatDurationS(routeDriving.durationS)}` : ''} from your location
                    to {place.name}
                  </Text>
                </View>
              ) : routeLoading && userPt && destCoords ? (
                <Text style={styles.routeTripSummaryLoading}>Calculating road distance…</Text>
              ) : userPt && destCoords ? (
                <View style={styles.routeTripSummaryBox}>
                  <Text style={styles.routeTripSummaryLabel}>Straight-line hint</Text>
                  <Text style={styles.routeTripSummaryValue}>
                    ~{formatDistanceM(haversineDistanceKm(userPt.lat, userPt.lng, destCoords.lat, destCoords.lng) * 1000)}{' '}
                    as the crow flies — open Commute steps when the road route loads
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.commuterBadge}>
              <Text style={styles.commuterBadgeLabel}>Commuter-first</Text>
            </View>
            <Text style={styles.routeOsrmDisclaimer}>{COMMUTER_DISCLAIMER}</Text>
            <Text style={styles.routeFootnote}>{COMMUTER_FOOTNOTE}</Text>
            {routeLoading ? <ActivityIndicator style={styles.routeSpinner} color={GREEN} /> : null}
            {routeError ? <Text style={styles.routeErrorText}>{routeError}</Text> : null}
            {!userPt && locStatus === 'denied' ? (
              <Text style={styles.routeHint}>
                Location is off — turn it on to load segments from where you are. You can still open the full map to
                plan transfers and walking.
              </Text>
            ) : null}
            {routeDriving && routeDriving.steps.length > 0 ? (
              <>
                <Text style={styles.routeSummaryLabel}>Whole corridor (road length)</Text>
                <Text style={styles.routeSummary}>
                  {formatDistanceM(routeDriving.distanceM)} · {formatDurationS(routeDriving.durationS)} if driven
                  end-to-end — commute time depends on waits and transfers
                </Text>
                {routeFoot ? (
                  <Text style={styles.routeFootHint}>
                    Walking-only reference (same endpoints): {formatDistanceM(routeFoot.distanceM)} ·{' '}
                    {formatDurationS(routeFoot.durationS)} — use for short links between rides, not as a full commute
                    time
                  </Text>
                ) : null}
                {routeDriving.steps.map((step, index) => {
                  const stepHint = commuterStepHint(index, routeDriving.steps.length, step.distanceM);
                  return (
                    <View key={`corridor-${index}-${Math.round(step.distanceM)}`} style={styles.routeStepRow}>
                      <Text style={styles.routeStepNum}>{index + 1}</Text>
                      <View style={styles.routeStepBody}>
                        <Text style={styles.routeStepInstruction}>
                          {commuterDirectStepInstruction(step, index, routeDriving.steps.length, place.name)}
                        </Text>
                        <Text style={styles.routeStepMeta}>
                          {formatDistanceM(step.distanceM)} · ~{formatDurationS(step.durationS)} driving reference
                        </Text>
                        {stepHint ? <Text style={styles.commuterStepHint}>{stepHint}</Text> : null}
                      </View>
                    </View>
                  );
                })}
              </>
            ) : !routeLoading && userPt ? (
              <Text style={styles.routeHint}>No segments returned for this corridor — try the map or another nearby road.</Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.routeCard}>
            <View style={styles.commuterBadge}>
              <Text style={styles.commuterBadgeLabel}>Commuter-first</Text>
            </View>
            <Text style={styles.routeOsrmDisclaimer}>
              Follow the mapped road corridor toward this place, then confirm jeep or bus signboards locally.{' '}
              {COMMUTER_DISCLAIMER}
            </Text>
            <Text style={styles.routeFootnote}>{COMMUTER_FOOTNOTE}</Text>
            {commuterGuideSteps.map((step, index) => (
              <View key={`guide-${step.title}-${index}`} style={styles.guideStepBlock}>
                <View style={styles.guideStepHeader}>
                  <Text style={styles.guideStepNum}>{index + 1}</Text>
                  <Text style={styles.guideStepTitle}>{step.title}</Text>
                </View>
                <Text style={styles.guideStepBody}>{step.body}</Text>
                {step.signboards?.map((sign) => (
                  <View key={sign} style={styles.guideSignChip}>
                    <Text style={styles.guideSignLabel}>Sign to look for: &ldquo;{sign}&rdquo;</Text>
                  </View>
                ))}
                {step.hint ? <Text style={styles.guideStepHint}>{step.hint}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {!caviTrip ? (
          <View style={styles.destinationReachedWrap}>
            <Text style={styles.destinationReachedHint}>
              After you arrive, tap Destination Reached below to record this visit. Opening See full map does not count
              toward Activity this month.
            </Text>
            <TouchableOpacity
              onPress={onDestinationReached}
              style={[styles.destinationReachedButton, destinationReachedBusy && styles.destinationReachedButtonDisabled]}
              activeOpacity={0.92}
              accessibilityRole="button"
              accessibilityLabel="Destination Reached"
              disabled={destinationReachedBusy}
            >
              {destinationReachedBusy ? (
                <ActivityIndicator size="small" color={WHITE} />
              ) : (
                <Text style={styles.destinationReachedButtonLabel}>Destination Reached</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={openFullMap}
          style={styles.directionsButton}
          activeOpacity={0.92}
          accessibilityRole="button"
          accessibilityLabel="See full map"
        >
          <Text style={styles.directionsButtonLabel}>See full map</Text>
        </TouchableOpacity>
      </ScrollView>

      <SaveToListSheet
        visible={saveModalVisible}
        onClose={() => setSaveModalVisible(false)}
        itemLabel={place.name}
        lists={pickLists}
        listNameDraft={listNameDraft}
        onListNameChange={setListNameDraft}
        onSelectList={onPickList}
        onCreateList={onCreateList}
        busyListId={saveListBusyId}
        countLabel="items"
      />

      <Toast toast={toast} onDone={() => setToast(null)} />
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  missingText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    color: TITLE,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  missingBack: {
    marginTop: 20,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  missingBackLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    color: GREEN,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  heroWrap: {
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
  },
  heroImage: {
    width: '100%',
    aspectRatio: 16 / 10,
    backgroundColor: '#E8E8E8',
  },
  heroPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeName: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 20,
    lineHeight: 24,
    color: TITLE,
    marginBottom: 12,
  },
  caviTripMapCard: {
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: WHITE,
  },
  caviTripMapInner: {
    minHeight: 220,
    borderRadius: 0,
  },
  caviTripMapHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  caviTripBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(27, 138, 112, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.12)',
    marginBottom: 14,
  },
  caviTripBannerText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: TITLE,
  },
  tagsAndActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 12,
  },
  pillRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    minWidth: 0,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  pillText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    lineHeight: 15,
  },
  actionPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  fab: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabSave: {
    backgroundColor: 'rgba(16, 163, 127, 0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 163, 127, 0.45)',
  },
  fabSaveActive: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  fabShare: {
    backgroundColor: WHITE,
    borderWidth: 1.5,
    borderColor: 'rgba(27, 138, 112, 0.28)',
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'rgba(16, 163, 127, 0.12)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(16, 163, 127, 0.22)',
  },
  segmentSlot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 11,
    minWidth: 0,
  },
  segmentSlotActive: {
    backgroundColor: WHITE,
    shadowColor: OLIVE,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    lineHeight: 18,
  },
  segmentLabelCompact: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  segmentLabelOn: {
    color: GREEN,
    fontFamily: 'Inter_700Bold',
  },
  segmentLabelOff: {
    color: MUTED,
  },
  routeCard: {
    backgroundColor: WHITE,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: OLIVE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
    marginBottom: 4,
  },
  mapsPlannerCard: {
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.15)',
    backgroundColor: '#fff',
    padding: 10,
  },
  routeTripSummaryBox: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(27, 138, 112, 0.12)',
  },
  routeTripSummaryLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 4,
  },
  routeTripSummaryValue: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    lineHeight: 20,
    color: TITLE,
  },
  routeTripSummaryLoading: {
    marginTop: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
  },
  routeModeSection: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 163, 127, 0.28)',
    backgroundColor: 'rgba(16, 163, 127, 0.06)',
  },
  routeModeSectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13,
    color: TEAL,
  },
  routeModeSectionHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    color: MUTED,
    marginTop: 4,
    marginBottom: 10,
  },
  routeModeToggle: {
    gap: 10,
  },
  routeModeOption: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(27, 138, 112, 0.2)',
    backgroundColor: WHITE,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  routeModeOptionOn: {
    borderColor: GREEN,
    backgroundColor: 'rgba(16, 163, 127, 0.12)',
  },
  routeModeOptionText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: TITLE,
  },
  routeModeOptionTextOn: {
    color: GREEN,
  },
  routeModeOptionSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 15,
    color: MUTED,
    marginTop: 4,
  },
  mapsModeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  mapsModeChip: {
    minHeight: 28,
    minWidth: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.2)',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    gap: 4,
  },
  mapsModeChipActive: {
    backgroundColor: 'rgba(118, 214, 255, 0.35)',
    borderColor: 'rgba(27, 138, 112, 0.3)',
  },
  mapsModeChipText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 11,
    color: TITLE,
  },
  mapsInputCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.18)',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  mapsInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  mapsInputText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: TITLE,
  },
  mapsInputDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(122, 120, 120, 0.35)',
    marginHorizontal: 10,
  },
  transportChoiceTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13,
    lineHeight: 18,
    color: TEAL,
    marginBottom: 8,
  },
  transportChoiceRow: {
    gap: 8,
    paddingBottom: 10,
  },
  transportChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.22)',
    backgroundColor: WHITE,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  transportChipActive: {
    backgroundColor: 'rgba(16, 163, 127, 0.18)',
    borderColor: GREEN,
  },
  transportChipText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 12,
    color: TEAL,
  },
  transportChipTextActive: {
    color: GREEN,
    fontFamily: 'Poppins_700Bold',
  },
  commuterBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(16, 163, 127, 0.18)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 12,
  },
  commuterBadgeLabel: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 11,
    lineHeight: 14,
    color: GREEN,
    letterSpacing: 0.3,
  },
  routeOsrmDisclaimer: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: TITLE,
    marginBottom: 10,
  },
  routeFootnote: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginBottom: 14,
  },
  routeSpinner: {
    marginVertical: 12,
  },
  routeErrorText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: '#b45309',
    marginBottom: 10,
  },
  routeHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: MUTED,
    marginBottom: 8,
  },
  routeSummaryLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 16,
    color: TEAL,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  routeSummary: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    lineHeight: 22,
    color: TITLE,
    marginBottom: 8,
  },
  routeFootHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: TEAL,
    marginBottom: 14,
  },
  routeStepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(122, 120, 120, 0.2)',
    gap: 12,
  },
  routeStepNum: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 14,
    lineHeight: 22,
    color: GREEN,
    width: 22,
  },
  routeStepBody: {
    flex: 1,
    minWidth: 0,
  },
  routeStepInstruction: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: TITLE,
  },
  routeStepMeta: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginTop: 4,
  },
  commuterStepHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: TEAL,
    marginTop: 8,
    fontStyle: 'italic',
  },
  guideBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 24,
    color: TITLE,
  },
  guideStepBlock: {
    marginTop: 16,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CARD_BORDER,
  },
  guideStepHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  guideStepNum: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: WHITE,
    backgroundColor: OLIVE,
    width: 26,
    height: 26,
    lineHeight: 26,
    textAlign: 'center',
    borderRadius: 13,
    overflow: 'hidden',
  },
  guideStepTitle: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 22,
    color: TITLE,
  },
  guideStepBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: TITLE,
    marginTop: 8,
    marginLeft: 36,
  },
  guideSignChip: {
    marginTop: 8,
    marginLeft: 36,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 163, 127, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 163, 127, 0.35)',
  },
  guideSignLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
    color: OLIVE,
  },
  guideStepHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginTop: 6,
    marginLeft: 36,
    fontStyle: 'italic',
  },
  destinationReachedWrap: {
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  destinationReachedHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: MUTED,
    marginBottom: 10,
  },
  destinationReachedButton: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: TEAL,
  },
  destinationReachedButtonDisabled: {
    opacity: 0.7,
  },
  destinationReachedButtonLabel: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    color: WHITE,
  },
  directionsButton: {
    marginTop: 20,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 28,
    minHeight: 54,
    borderRadius: 9999,
    backgroundColor: GREEN,
  },
  directionsButtonLabel: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 17,
    lineHeight: 22,
    color: WHITE,
    textAlign: 'center',
  },
});

export default DirectionsScreen;
