import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { setStatusBarStyle } from 'expo-status-bar';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { JamIcon } from '../components/JamIcon';
import { MapPlacePreviewCard } from '../components/MapPlacePreviewCard';
import { LeafletMapView } from '../components/LeafletMapView';
import type { LeafletMarker } from '../components/LeafletMapView';
import type { LeafletPreviewPoint } from '../components/leafletMapTypes';
import { getMainFloatingTabBarStyle, tabBarShowsLabels } from '../lib/mainTabBarStyle';
import { supabase } from '../lib/supabase';
import { fetchTrendingPlacesFromSupabase, logPlacesFetchError } from '../lib/placesFromSupabase';
import { placeMatchesSearchQuery } from '../lib/dashboardPlaceFilters';
import { placeImageSource } from '../lib/placeImageSource';
import { usePlaceRatingSummary } from '../lib/usePlaceReviewStats';
import { launchGoogleMapsDrivingTo } from '../lib/launchGoogleMapsDirections';
import { fetchSiteContent } from 'cavitour-shared/siteContent';
import { leafletPinIconOptions, resolveMapPinUrlForLabel } from 'cavitour-shared/mapPins';
import type { Place } from '../data/mockData';

const H_PAD = 16;
const OVERLAY_TOP = 10;
const GREEN = '#10A37F';
const TEAL = '#1B8A70';
const MUTED = '#7A7878';
const MAP_BG = '#E8E8E8';
const TITLE = '#241D13';
const STAR = '#FFC012';

const { height: SCREEN_H, width: SCREEN_W } = Dimensions.get('window');
const SHEET_PEEK_RATIO = 0.6;
const PREVIEW_CARD_HALF_W = 144;
const PREVIEW_ABOVE_OFFSET = 168;
const PREVIEW_BELOW_OFFSET = 14;
const PREVIEW_FLIP_TOP_THRESHOLD = 170;

export default function MapScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewSpotId, setPreviewSpotId] = useState<string | null>(null);
  const [previewPoint, setPreviewPoint] = useState<LeafletPreviewPoint | null>(null);
  const [dbMarkers, setDbMarkers] = useState<LeafletMarker[]>([]);
  const [dbPlaces, setDbPlaces] = useState<Place[]>([]);

  const selectedSpot = useMemo(
    () => (selectedId ? dbPlaces.find((p) => p.id === selectedId) : undefined),
    [selectedId, dbPlaces]
  );

  const previewPlace = useMemo(() => {
    if (!previewSpotId) return undefined;
    return dbPlaces.find((p) => p.id === previewSpotId);
  }, [previewSpotId, dbPlaces]);

  /** Reads published reviews for the open place and follows later review writes. */
  const rating = usePlaceRatingSummary(selectedId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [places, cms, ntdpRes] = await Promise.all([
          fetchTrendingPlacesFromSupabase(supabase, 600),
          fetchSiteContent(supabase).catch(() => ({})),
          supabase.from('ntdp_categories').select('ntdp_category_id, ntdp_category_name'),
        ]);
        setDbPlaces(places);
        const lookups = (ntdpRes.data ?? []).map((r) => ({
          tableId: r.ntdp_category_id,
          label: r.ntdp_category_name,
        }));
        const m: LeafletMarker[] = places.map((p) => {
          const label = p.ntdp_category ?? '';
          const url = resolveMapPinUrlForLabel(cms as Record<string, string>, lookups, label);
          const opts = leafletPinIconOptions(url, label);
          return {
            id: p.id,
            name: p.name,
            lat: p.latitude,
            lng: p.longitude,
            iconUrl: opts.iconUrl,
            iconRetinaUrl: opts.iconRetinaUrl,
          };
        });
        if (!cancelled) setDbMarkers(m);
      } catch (err) {
        logPlacesFetchError('fetchTrendingPlacesFromSupabase', err);
        if (!cancelled) {
          setDbPlaces([]);
          setDbMarkers([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** The search pill narrows the pins on the map rather than leaving the screen. */
  const combinedMarkers = useMemo(() => {
    const q = query.trim();
    if (!q) return dbMarkers;
    const matchIds = new Set(
      dbPlaces.filter((p) => placeMatchesSearchQuery(p, q)).map((p) => p.id)
    );
    return dbMarkers.filter((m) => matchIds.has(m.id));
  }, [dbMarkers, dbPlaces, query]);

  const sheetHeight = selectedSpot == null ? 0 : Math.round(SCREEN_H * SHEET_PEEK_RATIO);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setUserLocation({
          lat: current.coords.latitude,
          lng: current.coords.longitude,
        });
      } catch {
        /* ignore */
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 20,
        },
        (loc) => {
          setUserLocation({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
          });
        }
      );
    })();

    return () => {
      subscription?.remove();
    };
  }, []);

  /**
   * The sheet covers the pill, so hide it while it is open. This writes the Map
   * tab's own options, which outrank the route-based rule in App.tsx — so it has
   * to keep the bar hidden whenever the map isn't the screen on top, otherwise
   * the pill leaks onto pushed screens like About establishment.
   */
  const isFocused = useIsFocused();
  useLayoutEffect(() => {
    const tabNav = navigation.getParent();
    if (!tabNav) return;
    const hide = selectedSpot != null || !isFocused;
    tabNav.setOptions({
      tabBarStyle: hide
        ? { display: 'none' }
        : getMainFloatingTabBarStyle(insets.bottom, tabBarShowsLabels(SCREEN_W)),
    });
  }, [selectedSpot, isFocused, navigation, insets.bottom]);

  /** No teal app bar here, so the status bar reads against the map tiles. */
  useEffect(() => {
    if (isFocused) setStatusBarStyle('dark');
  }, [isFocused]);

  const clearPreview = () => {
    setPreviewSpotId(null);
    setPreviewPoint(null);
  };

  const sheetImage = selectedSpot ? placeImageSource(selectedSpot.image) : undefined;

  const openGoogleDirections = (place: Place) => {
    void launchGoogleMapsDrivingTo(place.latitude, place.longitude, userLocation);
  };

  const closeSheet = () => {
    setSelectedId(null);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeTop} edges={[]}>
        <View style={styles.mapFrame} accessibilityLabel="Map">
          <LeafletMapView
            style={styles.mapLayer}
            markers={combinedMarkers}
            userLocation={userLocation}
            onMarkerPreview={(id, point) => {
              setPreviewSpotId(id);
              setPreviewPoint(point);
            }}
            onMarkerPreviewEnd={clearPreview}
          />

          {previewPlace && previewPoint ? (
            <View
              style={[
                styles.previewAnchor,
                {
                  left: previewPoint.x,
                  top: previewPoint.y,
                  transform: [
                    { translateX: -PREVIEW_CARD_HALF_W },
                    {
                      translateY:
                        previewPoint.y < PREVIEW_FLIP_TOP_THRESHOLD
                          ? PREVIEW_BELOW_OFFSET
                          : -PREVIEW_ABOVE_OFFSET,
                    },
                  ],
                },
              ]}
              pointerEvents="box-none"
            >
              <MapPlacePreviewCard
                place={previewPlace}
                flipBelow={previewPoint.y < PREVIEW_FLIP_TOP_THRESHOLD}
                onSeeMore={() => {
                  clearPreview();
                  setSelectedId(previewPlace.id);
                }}
              />
            </View>
          ) : null}

          <View
            style={[
              styles.frameOverlay,
              { paddingTop: insets.top + OVERLAY_TOP, paddingHorizontal: H_PAD },
            ]}
            pointerEvents="box-none"
          >
            <View
              style={styles.wordmarkRow}
              accessible
              accessibilityRole="header"
              accessibilityLabel="Tara, Cavite!"
              pointerEvents="none"
            >
              <Text style={styles.wordmark}>
                <Text style={styles.wordmarkAccent}>Tara</Text>
                <Text style={styles.wordmarkPrimary}>, Cavite!</Text>
              </Text>
            </View>

            <View style={styles.searchWrap} accessibilityRole="search" pointerEvents="auto">
              <View style={styles.searchPill}>
                <JamIcon name="search" size={17} color={MUTED} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Where are you going?"
                  placeholderTextColor={MUTED}
                  style={styles.searchInput}
                  accessibilityLabel="Search map destinations"
                  returnKeyType="search"
                />
                {query.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => setQuery('')}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Clear map search"
                  >
                    <JamIcon ionicon="close-circle" size={18} color={MUTED} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {query.trim() && combinedMarkers.length === 0 ? (
                <Text style={styles.searchEmptyHint}>
                  No pins match “{query.trim()}”.
                </Text>
              ) : null}
            </View>
          </View>

          {selectedSpot ? (
            <Pressable style={styles.sheetBackdrop} onPress={closeSheet} accessibilityLabel="Dismiss" />
          ) : null}

          {selectedSpot ? (
            <View
              style={[
                styles.sheet,
                {
                  height: sheetHeight,
                  paddingBottom: Math.max(insets.bottom, 12),
                },
              ]}
            >
              <View style={styles.sheetHandle} accessibilityLabel="Sheet" />

              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {sheetImage ? (
                  <ExpoImage
                    source={sheetImage}
                    style={styles.previewImage}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={180}
                    accessibilityLabel={`${selectedSpot.name} photo`}
                  />
                ) : (
                  <View style={[styles.previewImage, styles.previewImagePh]}>
                    <JamIcon ionicon="image-outline" size={40} color={MUTED} />
                  </View>
                )}
                <Text style={styles.previewTitle}>{selectedSpot.name}</Text>
                <Text style={styles.previewAddress}>{selectedSpot.address}</Text>
                <View style={styles.previewRatingRow}>
                  <JamIcon ionicon="star" size={16} color={STAR} />
                  <Text style={styles.previewRatingText}>
                    {rating == null
                      ? 'Loading reviews…'
                      : rating.count
                        ? `${rating.average.toFixed(1)} (${rating.count} review${
                            rating.count === 1 ? '' : 's'
                          })`
                        : 'No reviews yet'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.aboutCta}
                  onPress={() => {
                    closeSheet();
                    (
                      navigation as unknown as { navigate: (name: string, params: object) => void }
                    ).navigate('AboutEstablishment', { place: selectedSpot });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="About establishment"
                >
                  <Text style={styles.aboutCtaLabel}>ABOUT ESTABLISHMENT</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.directionsCta}
                  onPress={() => openGoogleDirections(selectedSpot)}
                  accessibilityRole="button"
                  accessibilityLabel="Directions"
                >
                  <Text style={styles.directionsCtaLabel}>DIRECTIONS</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MAP_BG,
  },
  safeTop: {
    flex: 1,
    backgroundColor: MAP_BG,
  },
  mapFrame: {
    flex: 1,
    width: '100%',
    backgroundColor: MAP_BG,
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: MAP_BG,
  },
  previewAnchor: {
    position: 'absolute',
    zIndex: 4,
    width: 288,
  },
  frameOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: 10,
  },
  wordmark: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: 0.6,
  },
  wordmarkAccent: {
    color: GREEN,
  },
  wordmarkPrimary: {
    color: TEAL,
  },
  searchWrap: {
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 3,
    alignSelf: 'stretch',
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(122, 120, 120, 0.35)',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: '#000000',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.28)',
    zIndex: 2,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    zIndex: 3,
    paddingHorizontal: H_PAD,
    paddingTop: 8,
    flexDirection: 'column',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(122,120,120,0.35)',
    marginBottom: 8,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: 8,
  },
  previewImage: {
    width: '100%',
    height: 150,
    borderRadius: 14,
    backgroundColor: '#E8E8E8',
    marginBottom: 12,
  },
  previewImagePh: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    lineHeight: 26,
    color: TITLE,
    marginBottom: 6,
  },
  previewAddress: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    marginBottom: 8,
  },
  previewRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  previewRatingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: MUTED,
  },
  aboutCta: {
    marginBottom: 10,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: TEAL,
    backgroundColor: '#FFFFFF',
  },
  aboutCtaLabel: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 14,
    color: TEAL,
    letterSpacing: 0.4,
  },
  directionsCta: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: 'center',
  },
  directionsCtaLabel: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  searchEmptyHint: {
    marginTop: 10,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.94)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
    overflow: 'hidden',
  },
});
