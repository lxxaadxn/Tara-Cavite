import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Dimensions,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/Colors';
import { Header, HeaderAction } from '../components/Header';
import { JamIcon } from '../components/JamIcon';
import { Toast, type ToastData } from '../components/Toast';
import { AppDialog, type AppDialogData } from '../components/AppDialog';
import { LeafletMapView } from '../components/LeafletMapView';
import { SaveToListSheet, type SaveToListRow } from '../components/SaveToListSheet';
import type { PublishedItinerary } from '../data/publishedItineraries';
import type { Place } from '../data/mockData';
import { supabase } from '../lib/supabase';
import { fetchDashboardPlacesPool, logPlacesFetchError } from '../lib/placesFromSupabase';
import { fetchItineraryByIdOrSlug, subscribeItineraries } from 'cavitour-shared/itineraries';
import { formatRouteLine } from '../lib/itineraryFormat';
import {
  buildEnrichedItinerary,
  type EnrichedStop,
  itineraryMapPlaces,
  itineraryStopsDurationLine,
  resolveEstablishment,
  stopMapPoint,
  stopMapsQuery,
  stopVenueName,
} from '../lib/itineraryPlaces';
import { googleMapsItineraryUrl, googleMapsPlaceUrl } from '../lib/googleMapsDirections';
import {
  addItineraryToSavedList,
  fetchUserListsForPickerWithCounts,
  findOrCreateListByName,
  isItinerarySavedByUser,
  removeItineraryFromAllUserLists,
} from '../lib/savedListItems';
import {
  alertAfterSaveToList,
  SAVE_TO_LIST_CREATE_BUSY_ID,
} from '../lib/saveToListModalHelpers';
import { recordItineraryStart } from '../lib/itineraryStartsActivity';

const HEADER_GREEN = '#10A37F';
const TEAL = '#1B8A70';
const TITLE = '#241D13';
const MUTED = '#7A7878';
const PAGE_BG = '#F1F7F6';
const WHITE = '#FFFFFF';
const H_PAD = 16;
const { width: SCREEN_W } = Dimensions.get('window');
const HERO_H = Math.round(SCREEN_W * 0.52);

export type ItineraryDetailParams = {
  itineraryId: string;
};

export default function ItineraryDetailScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { itineraryId } = route.params as ItineraryDetailParams;

  const [template, setTemplate] = useState<PublishedItinerary | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [catalogPlaces, setCatalogPlaces] = useState<Place[]>([]);
  const [saved, setSaved] = useState(false);
  const [checkingSaved, setCheckingSaved] = useState(true);
  const [saveModalVisible, setSaveModalVisible] = useState(false);
  const [pickLists, setPickLists] = useState<SaveToListRow[]>([]);
  const [listNameDraft, setListNameDraft] = useState('My list');
  const [saveListBusyId, setSaveListBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [dialog, setDialog] = useState<AppDialogData | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    const load = () =>
      fetchItineraryByIdOrSlug(supabase, itineraryId, { publishedOnly: true })
        .then((row) => {
          if (cancelled) return;
          setTemplate((row ?? null) as PublishedItinerary | null);
          setLoadState(row ? 'ready' : 'missing');
        })
        .catch(() => {
          if (!cancelled) {
            setTemplate(null);
            setLoadState('missing');
          }
        });
    load();
    const unsub = subscribeItineraries(supabase, () => {
      fetchItineraryByIdOrSlug(supabase, itineraryId, { publishedOnly: true })
        .then((row) => {
          if (cancelled) return;
          setTemplate((row ?? null) as PublishedItinerary | null);
          setLoadState(row ? 'ready' : 'missing');
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [itineraryId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await fetchDashboardPlacesPool(supabase, 2000);
        if (!cancelled) setCatalogPlaces(list);
      } catch (err) {
        logPlacesFetchError('ItineraryDetailScreen.fetchDashboardPlacesPool', err);
        if (!cancelled) setCatalogPlaces([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enriched = useMemo(
    () => (template ? buildEnrichedItinerary(template, catalogPlaces) : null),
    [template, catalogPlaces]
  );

  const detail = enriched ?? template;

  const stops: EnrichedStop[] = (enriched?.stopList ?? []) as EnrichedStop[];
  const mapPlaces = useMemo(() => itineraryMapPlaces(stops), [stops]);

  const startItineraryUrl = useMemo(() => googleMapsItineraryUrl(mapPlaces), [mapPlaces]);

  const refreshSavedState = useCallback(async () => {
    if (!template) return;
    setCheckingSaved(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setSaved(false);
        return;
      }
      setSaved(await isItinerarySavedByUser(supabase, user.id, template.id));
    } catch {
      setSaved(false);
    } finally {
      setCheckingSaved(false);
    }
  }, [template]);

  useEffect(() => {
    refreshSavedState();
  }, [refreshSavedState]);

  useFocusEffect(
    useCallback(() => {
      refreshSavedState();
    }, [refreshSavedState])
  );

  const onBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      (navigation as { navigate: (n: string) => void }).navigate('ItinerariesMain');
    }
  };

  const startItinerary = async () => {
    if (!template) return;
    // Feed the profile's "Itineraries used" stat before opening Maps (best-effort).
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await recordItineraryStart(user.id, { id: template.id, title: detail?.title ?? template.title });
      }
    } catch {
      /* stat recording is best-effort */
    }
    if (!startItineraryUrl) {
      Alert.alert('Maps', 'No map location is available for this itinerary yet.');
      return;
    }
    Linking.openURL(startItineraryUrl).catch(() => {
      Alert.alert('Maps', 'Could not open Google Maps.');
    });
  };

  const openMaps = (stop: (typeof stops)[number]) => {
    const point = stopMapPoint(stop);
    const url = googleMapsPlaceUrl(point?.lat, point?.lng, stopMapsQuery(stop));
    if (!url) {
      Alert.alert('Maps', 'No map location is available for this stop yet.');
      return;
    }
    Linking.openURL(url).catch(() => {
      Alert.alert('Maps', 'Could not open Google Maps.');
    });
  };

  const openPlace = (placeId: string) => {
    const place = resolveEstablishment({ placeId }, catalogPlaces);
    if (!place) {
      Alert.alert('Not in catalog', 'This stop is not available in the catalog yet.');
      return;
    }
    (navigation as { navigate: (n: string, o: object) => void }).navigate('AboutEstablishment', {
      place,
    });
  };

  const openSaveToListPicker = async () => {
    if (!template) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Sign in', 'Sign in to save itineraries to your lists.');
      return;
    }
    try {
      const lists = await fetchUserListsForPickerWithCounts(supabase, user.id);
      setListNameDraft(detail?.tags?.[0] || 'My list');
      setPickLists(lists);
      setSaveModalVisible(true);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not load lists.');
    }
  };

  const onConfirmRemoveSave = () => {
    if (!template) return;
    setDialog({
      title: 'Remove from saved lists?',
      message: 'This removes this itinerary from every list it’s in.',
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
                await removeItineraryFromAllUserLists(supabase, user.id, template.id);
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

  const notifySaveResult = useCallback(
    (title: string, message: string, tone?: 'success' | 'error' | 'info') => {
      setToast({ message, tone: tone ?? 'info' });
    },
    []
  );

  const onPickList = async (list: SaveToListRow) => {
    if (!template) return;
    setSaveListBusyId(list.id);
    try {
      const res = await addItineraryToSavedList(supabase, list.id, template.id);
      alertAfterSaveToList(res, detail?.title ?? 'Itinerary', list.name, () => {
        setSaveModalVisible(false);
        setSaved(true);
      }, notifySaveResult);
    } finally {
      setSaveListBusyId(null);
    }
  };

  const onCreateList = async () => {
    if (!template) return;
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
      const res = await addItineraryToSavedList(supabase, list.id, template.id);
      alertAfterSaveToList(res, detail?.title ?? 'Itinerary', list.name, () => {
        setSaveModalVisible(false);
        setSaved(true);
      }, notifySaveResult);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not create list.');
    } finally {
      setSaveListBusyId(null);
    }
  };

  if (loadState === 'loading' && !template) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Header title="About" showBack darkBackground onBackPress={onBack} />
        <View style={styles.emptyWrap}>
          <ActivityIndicator color={HEADER_GREEN} />
        </View>
      </SafeAreaView>
    );
  }

  if (!template) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Header title="About" showBack darkBackground onBackPress={onBack} />
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Not found</Text>
          <Text style={styles.emptyBody}>This itinerary is no longer available.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onBack} accessibilityRole="button">
            <Text style={styles.primaryBtnText}>Back to itineraries</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const metaLine = itineraryStopsDurationLine(detail);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Header
        title="About"
        showBack
        darkBackground
        onBackPress={onBack}
        right={
          <HeaderAction
            onPress={saved ? onConfirmRemoveSave : openSaveToListPicker}
            disabled={checkingSaved}
            accessibilityLabel={saved ? 'Remove from saved lists' : 'Save to list'}
          >
            <JamIcon ionicon={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={WHITE} />
          </HeaderAction>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <LinearGradient
            colors={['#F1F7F6', '#F1F7F6', '#AACBC4']}
            style={styles.heroCopy}
          >
            {metaLine ? (
              <View style={[styles.heroPill, styles.heroPillDark, styles.heroMetaPill]}>
                <Text style={styles.heroPillTextDark}>{metaLine}</Text>
              </View>
            ) : null}
            <Text style={styles.heroTitle}>{detail?.title}</Text>
            <Text style={styles.heroRoute}>{formatRouteLine(detail!)}</Text>
            {detail?.tags?.length ? (
              <View style={styles.tagRow}>
                {detail.tags.map((tag) => (
                  <View key={tag} style={styles.heroTag}>
                    <Text style={styles.heroTagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </LinearGradient>
        </View>

        {stops.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Route & stops</Text>
              <Text style={styles.sectionSub}>Follow in order — each stop builds on the last.</Text>
            </View>
            <View style={styles.timeline}>
              <View style={styles.timelineLine} accessibilityElementsHidden />
              {stops.map((stop, index) => (
                <View key={`${stop.name}-${index}`} style={styles.stopRow}>
                  <View style={styles.stopNum}>
                    <Text style={styles.stopNumText}>{index + 1}</Text>
                  </View>
                  <View style={styles.stopContent}>
                    <Text style={styles.stopName}>{stopVenueName(stop) || stop.name}</Text>
                    {stop.timeWindow || stop.durationHint ? (
                      <Text style={styles.stopTime}>
                        {[stop.timeWindow, stop.durationHint].filter(Boolean).join(' · ')}
                      </Text>
                    ) : null}
                    {stop.costType || stop.expectTag ? (
                      <View style={styles.stopTagRow}>
                        {stop.costType ? (
                          <View style={styles.stopTag}>
                            <Text style={styles.stopTagText}>{stop.costType}</Text>
                          </View>
                        ) : null}
                        {stop.expectTag ? (
                          <View style={styles.stopTag}>
                            <Text style={styles.stopTagText}>{stop.expectTag}</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                    <View style={styles.stopActions}>
                      <TouchableOpacity
                        style={styles.mapsBtn}
                        activeOpacity={0.88}
                        onPress={() => openMaps(stop)}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${stopVenueName(stop) || stop.name} in Google Maps`}
                      >
                        <Text style={styles.mapsBtnText}>Open in Google Maps</Text>
                      </TouchableOpacity>
                      {stop.place?.id ? (
                        <TouchableOpacity
                          style={styles.appLinkBtn}
                          activeOpacity={0.88}
                          onPress={() => openPlace(stop.place!.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`View ${stop.place.name} in app`}
                        >
                          <Text style={styles.appLinkBtnText}>View in app</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {mapPlaces.length ? (
          <View style={styles.mapCard}>
            <LeafletMapView
              markers={mapPlaces}
              userLocation={null}
              onMarkerPress={(placeId) => {
                if (placeId && !placeId.startsWith('stop-')) openPlace(placeId);
              }}
            />
          </View>
        ) : (
          <View style={styles.mapEmpty}>
            <Text style={styles.mapEmptyText}>Map loads when locations are available</Text>
          </View>
        )}

        {startItineraryUrl ? (
          <TouchableOpacity
            style={styles.startBtn}
            onPress={startItinerary}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Start itinerary in Google Maps"
          >
            <Text style={styles.startBtnText}>Start itinerary</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      <Toast toast={toast} onDone={() => setToast(null)} />
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
      <SaveToListSheet
        visible={saveModalVisible}
        onClose={() => setSaveModalVisible(false)}
        title="Save itinerary"
        itemLabel={detail?.title}
        lists={pickLists}
        listNameDraft={listNameDraft}
        onListNameChange={setListNameDraft}
        onSelectList={onPickList}
        onCreateList={onCreateList}
        busyListId={saveListBusyId}
        countLabel="items"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PAGE_BG },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: H_PAD, paddingTop: 12 },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: H_PAD,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: TITLE,
    marginBottom: 8,
  },
  emptyBody: { fontSize: 15, color: MUTED, textAlign: 'center', marginBottom: 20 },
  primaryBtn: {
    backgroundColor: TEAL,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
  },
  primaryBtnText: { color: WHITE, fontFamily: 'Poppins_500Medium', fontSize: 15 },
  heroCard: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: WHITE,
    marginBottom: 12,
    borderWidth: 0,
    shadowColor: '#1B8A70',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  heroImgPlaceholder: { backgroundColor: '#e8ebe6' },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: HERO_H,
  },
  heroCopy: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  heroTag: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: '#cfe0b0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  heroTagText: {
    fontSize: 10,
    fontFamily: 'Poppins_700Bold',
    color: '#3d5210',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    lineHeight: 30,
    color: TITLE,
  },
  heroRoute: {
    fontSize: 15,
    lineHeight: 22,
    color: '#525252',
    marginTop: 8,
    fontFamily: 'Inter_400Regular',
  },
  heroMetaPill: { alignSelf: 'flex-start', marginBottom: 10 },
  heroPill: {
    backgroundColor: WHITE,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  heroPillDark: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  heroPillTextDark: {
    fontSize: 12,
    color: WHITE,
    fontFamily: 'Poppins_600SemiBold',
  },
  card: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    borderWidth: 0,
    shadowColor: '#1B8A70',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  mapCard: {
    height: 280,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: WHITE,
    marginBottom: 14,
    shadowColor: '#1B8A70',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  mapEmpty: {
    minHeight: 160,
    borderRadius: 20,
    backgroundColor: WHITE,
    marginBottom: 14,
    paddingHorizontal: 20,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapEmptyText: {
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },
  startBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TEAL,
    paddingVertical: 14,
    borderRadius: 999,
    marginBottom: 0,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  startBtnText: {
    color: WHITE,
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
  },
  sectionHead: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(27, 138, 112,0.08)',
    paddingBottom: 12,
    marginBottom: 16,
  },
  sectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
    color: TITLE,
  },
  sectionSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
    marginTop: 4,
  },
  body: { fontSize: 14, lineHeight: 22, color: MUTED, fontFamily: 'Inter_400Regular' },
  timeline: { position: 'relative' },
  timelineLine: {
    position: 'absolute',
    left: 15,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: 'rgba(16, 163, 127, 0.35)',
  },
  stopRow: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 24,
  },
  stopNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: HEADER_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  stopNumText: { color: WHITE, fontFamily: 'Poppins_700Bold', fontSize: 14 },
  stopContent: { flex: 1, minWidth: 0, paddingTop: 2 },
  stopName: { fontFamily: 'Poppins_700Bold', fontSize: 17, color: TITLE },
  stopTime: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#525252',
  },
  stopTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  stopTag: {
    backgroundColor: 'rgba(16, 163, 127, 0.16)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  stopTagText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.cta },
  stopActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  mapsBtn: {
    backgroundColor: HEADER_GREEN,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  mapsBtnText: { color: WHITE, fontFamily: 'Poppins_700Bold', fontSize: 12 },
  appLinkBtn: {
    borderWidth: 1,
    borderColor: '#AACBC4',
    backgroundColor: WHITE,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  appLinkBtnText: { color: TEAL, fontFamily: 'Poppins_700Bold', fontSize: 12 },
});
