import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Dimensions,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import { navigateNamed } from '../lib/navigateNamed';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import { JamIcon } from '../components/JamIcon';
import { FilterModal } from '../components/FilterModal';
import { Header } from '../components/Header';
import type { Place } from '../data/mockData';
import { supabase } from '../lib/supabase';
import {
  fetchDashboardPlacesPool,
  haversineDistanceKm,
  logPlacesFetchError,
} from '../lib/placesFromSupabase';
import { placeImageSource, placeHasDisplayImage } from '../lib/placeImageSource';
import { usePlaceReviewStats } from '../lib/usePlaceReviewStats';
import { fetchMostVisitedPlaceIds, orderByVisitRank } from '../lib/mostVisitedPlaces';
import {
  fetchLguLabelLookup,
  groupPlacesByLgu,
  type LguLabelLookup,
} from '../lib/groupPlacesByLgu';
import {
  countActiveFilters,
  placeMatchesSearchQuery,
  placePassesAppliedFilters,
  type AppliedPlaceFilters,
} from '../lib/dashboardPlaceFilters';
import { getFloatingTabBarScrollPadding, tabBarShowsLabels } from '../lib/mainTabBarStyle';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const H_PAD = 16;
const CARD_GAP = 40;
const CARD_WIDTH = Math.min(320, Math.round(SCREEN_WIDTH * 0.74));
const IMAGE_HEIGHT = Math.round(CARD_WIDTH * 0.58);
const LIST_CARD_W = SCREEN_WIDTH - H_PAD * 2;
const LIST_IMAGE_H = Math.round(LIST_CARD_W * 0.48);

const FIGMA = {
  textTitle: '#241D13',
  textSubtitle: '#425466',
  textMuted: '#868686',
  star: '#FFC012',
  searchGreen: '#10A37F',
  white: '#FFFFFF',
  bg: '#FFFFFF',
};
const TEAL = '#1B8A70';
const SEARCH_PLACEHOLDER = '#B3AAAA';
/** Cards kept in each LGU rail. */
const LGU_RAIL_LIMIT = 12;

type HomeSection =
  | {
      key: string;
      kind: 'rail';
      title: string;
      data: Place[];
      ranked?: boolean;
      emptyHint?: string;
    }
  | { key: string; kind: 'offline' };

const HomeScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const reviewStats = usePlaceReviewStats();
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<AppliedPlaceFilters | null>(null);
  const [catalogPlaces, setCatalogPlaces] = useState<Place[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogFromSupabase, setCatalogFromSupabase] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [visitRankIds, setVisitRankIds] = useState<string[]>([]);
  const [userPt, setUserPt] = useState<{ lat: number; lng: number } | null>(null);
  const [lguLookup, setLguLookup] = useState<LguLabelLookup | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        const list = await fetchDashboardPlacesPool(supabase, 1500);
        if (!cancelled) {
          setCatalogPlaces(list);
          setCatalogFromSupabase(list.length > 0);
          setCatalogError(list.length > 0 ? '' : 'No geocoded establishments in Supabase.');
        }
      } catch (err) {
        logPlacesFetchError('fetchDashboardPlacesPool', err);
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : 'Could not load establishments.');
          setCatalogPlaces([]);
          setCatalogFromSupabase(false);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids = await fetchMostVisitedPlaceIds(supabase, {});
      if (!cancelled) setVisitRankIds(ids);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lookup = await fetchLguLabelLookup();
      if (!cancelled) setLguLookup(lookup);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled || status !== 'granted') return;
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!cancelled) {
          setUserPt({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        }
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const searchActive = searchQuery.trim().length > 0;
  const filterActive = countActiveFilters(appliedFilters) > 0;
  const browseMode = searchActive || filterActive;

  const filteredSorted = useMemo(() => {
    const withImages = catalogPlaces.filter((p) => placeHasDisplayImage(p));
    const pool = browseMode ? catalogPlaces : withImages;
    return pool
      .filter((p) => placePassesAppliedFilters(p, appliedFilters))
      .filter((p) => placeMatchesSearchQuery(p, searchQuery));
  }, [catalogPlaces, appliedFilters, searchQuery, browseMode]);

  const mostVisitedRow = useMemo(
    () =>
      orderByVisitRank(
        filteredSorted.filter((p) => placeHasDisplayImage(p)),
        (p) => p.id,
        visitRankIds
      ),
    [filteredSorted, visitRankIds]
  );

  const nearbyRow = useMemo(() => {
    const pictured = filteredSorted.filter((p) => placeHasDisplayImage(p));
    if (!userPt) return pictured;
    const scored = pictured.map((p) => ({
      place: p,
      km: haversineDistanceKm(userPt.lat, userPt.lng, p.latitude, p.longitude),
    }));
    scored.sort((a, b) => a.km - b.km);
    return scored.map((s) => s.place);
  }, [filteredSorted, userPt]);

  /** Every LGU that has at least one pictured establishment in the pool. */
  const lguGroups = useMemo(() => {
    const pictured = filteredSorted.filter((p) => placeHasDisplayImage(p));
    return groupPlacesByLgu(pictured, lguLookup);
  }, [filteredSorted, lguLookup]);

  const openPlace = useCallback(
    (place: Place) => {
      (navigation as { navigate: (name: string, params: object) => void }).navigate('PlaceDetail', { place });
    },
    [navigation]
  );

  const renderPlaceCard = useCallback(
    (place: Place, portrait = false, rank?: number) => (
    <TouchableOpacity
      key={place.id}
      style={portrait ? styles.cardPortrait : styles.card}
      onPress={() => openPlace(place)}
      accessibilityLabel={`${place.name}, ${place.address}`}
      accessibilityRole="button"
      activeOpacity={0.9}
    >
      <View style={portrait ? styles.cardImagePortrait : styles.cardImage}>
        {placeImageSource(place.image) ? (
          <ExpoImage
            source={placeImageSource(place.image)!}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={200}
            accessibilityLabel={`${place.name} image`}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.imagePlaceholder]}>
            <JamIcon ionicon="image-outline" size={40} color={FIGMA.textMuted} />
          </View>
        )}
        {rank != null ? (
          <View style={styles.rankBadge}>
            <Text style={styles.rankBadgeText}>#{rank}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardTitleRow}>
        <Text style={styles.placeTitle} numberOfLines={2}>
          {place.name}
        </Text>
        {/* No stars until the place actually has published reviews, as on web. */}
        {reviewStats[place.id]?.count ? (
          <View style={styles.ratingWrap}>
            <JamIcon ionicon="star" size={14} color={FIGMA.star} />
            <Text style={styles.ratingText}>
              {reviewStats[place.id].average.toFixed(1)}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.placeSubtitle} numberOfLines={2}>
        {place.address}
      </Text>
    </TouchableOpacity>
    ),
    [openPlace, reviewStats]
  );

  const sections = useMemo<HomeSection[]>(() => {
    const out: HomeSection[] = [];
    out.push({
      key: 'most-visited',
      kind: 'rail',
      title: 'Most visited in Cavite',
      data: mostVisitedRow,
      ranked: true,
      emptyHint:
        'No pictured establishments match your filters. Try resetting filters or another city.',
    });
    out.push({
      key: 'nearby',
      kind: 'rail',
      title: userPt ? 'Nearby Places' : 'More places',
      data: nearbyRow,
      emptyHint: 'No pictured establishments match your filters.',
    });
    for (const group of lguGroups) {
      out.push({
        key: `lgu-${group.fold}`,
        kind: 'rail',
        title: group.label,
        data: group.places.slice(0, LGU_RAIL_LIMIT),
      });
    }
    if (!catalogFromSupabase && !catalogLoading) out.push({ key: 'offline', kind: 'offline' });
    return out;
  }, [mostVisitedRow, nearbyRow, lguGroups, userPt, catalogFromSupabase, catalogLoading]);

  const renderSection = useCallback(
    ({ item: section }: { item: HomeSection }) => {
      if (section.kind === 'offline') {
        return (
          <Text style={styles.offlineHint}>
            {catalogError
              ? `Could not load Cavite catalog (${catalogError}). Showing sample listings.`
              : 'Showing sample listings — connect to load full Cavite catalog.'}
          </Text>
        );
      }

      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {section.title}
          </Text>
          {catalogLoading ? (
            <View style={styles.rowLoading}>
              <ActivityIndicator color={FIGMA.searchGreen} />
            </View>
          ) : section.data.length === 0 ? (
            <Text style={styles.emptyHint}>{section.emptyHint}</Text>
          ) : (
            <FlatList
              horizontal
              data={section.data}
              keyExtractor={(item) => item.id}
              renderItem={({ item, index }) =>
                renderPlaceCard(item, false, section.ranked && index < 10 ? index + 1 : undefined)
              }
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hScrollContent}
              windowSize={5}
              initialNumToRender={4}
              maxToRenderPerBatch={4}
              removeClippedSubviews
            />
          )}
        </View>
      );
    },
    [catalogError, catalogLoading, renderPlaceCard]
  );

  const listBottom = getFloatingTabBarScrollPadding(
    insets.bottom,
    tabBarShowsLabels(SCREEN_WIDTH)
  );

  return (
    <View style={styles.container}>
      <Header title="" homeBranding showNotification showProfile />
      <View style={styles.searchFilterRow}>
        <View style={styles.searchPill}>
          <JamIcon name="search" size={18} color={FIGMA.searchGreen} />
          <TextInput
            style={styles.searchInput}
            placeholder="Where to?"
            placeholderTextColor={SEARCH_PLACEHOLDER}
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => undefined}
            returnKeyType="search"
            accessibilityLabel="Search for destinations"
          />
        </View>
        <TouchableOpacity
          style={styles.filterCircle}
          onPress={() => setFiltersVisible((v) => !v)}
          accessibilityLabel={filtersVisible ? 'Hide filters' : 'Show filters'}
          accessibilityRole="button"
        >
          <JamIcon name="filter" size={20} color={TEAL} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.filterCircle}
          onPress={() => navigateNamed(navigation, 'Announcements')}
          accessibilityLabel="View announcements"
          accessibilityRole="button"
        >
          <JamIcon name="flag" size={20} color={TEAL} />
        </TouchableOpacity>
      </View>
      {browseMode ? (
        catalogLoading ? (
          <View style={styles.rowLoading}>
            <ActivityIndicator color={FIGMA.searchGreen} />
          </View>
        ) : (
          <FlatList
            style={styles.scroll}
            data={filteredSorted}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => renderPlaceCard(item, true)}
            contentContainerStyle={[styles.browseList, { paddingBottom: listBottom }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListHeaderComponent={
              <Text style={styles.resultsTitle}>
                {filteredSorted.length} place{filteredSorted.length === 1 ? '' : 's'}
              </Text>
            }
            ListEmptyComponent={
              <Text style={styles.emptyHint}>
                No places match. Try another name, city, or reset filters.
              </Text>
            }
          />
        )
      ) : (
        <FlatList
          style={styles.scroll}
          data={sections}
          keyExtractor={(section) => section.key}
          renderItem={renderSection}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: listBottom }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={3}
          maxToRenderPerBatch={2}
          windowSize={5}
          removeClippedSubviews
        />
      )}

      <FilterModal
        visible={filtersVisible}
        onClose={() => setFiltersVisible(false)}
        appliedFilters={appliedFilters}
        onApply={setAppliedFilters}
        places={catalogPlaces}
        resultNoun="place"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FIGMA.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
  },
  browseList: {
    paddingHorizontal: H_PAD,
    paddingTop: 4,
  },
  resultsTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textTitle,
    marginBottom: 14,
  },
  cardPortrait: {
    width: '100%',
    marginBottom: 22,
  },
  cardImagePortrait: {
    width: '100%',
    height: LIST_IMAGE_H,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: '#E8E8E8',
    marginBottom: 10,
  },
  searchFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: H_PAD,
    paddingTop: 14,
    paddingBottom: 12,
    gap: 8,
  },
  searchPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 17,
    backgroundColor: '#FFFFFF',
    borderRadius: 29,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#000000',
  },
  filterCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 2,
    elevation: 3,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textTitle,
    paddingHorizontal: H_PAD,
    marginBottom: 14,
  },
  hScrollContent: {
    paddingLeft: H_PAD,
    paddingRight: H_PAD,
    flexDirection: 'row',
  },
  card: {
    width: CARD_WIDTH,
    marginRight: CARD_GAP,
  },
  cardImage: {
    width: '100%',
    height: IMAGE_HEIGHT,
    borderRadius: 21,
    overflow: 'hidden',
    backgroundColor: '#E8E8E8',
    marginBottom: 10,
  },
  rankBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(27, 138, 112, 0.92)',
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  rankBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 4,
  },
  placeTitle: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 16,
    lineHeight: 24,
    color: FIGMA.textTitle,
  },
  ratingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingTop: 2,
  },
  ratingText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 24,
    color: FIGMA.textMuted,
  },
  placeSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: FIGMA.textSubtitle,
  },
  rowLoading: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: FIGMA.textMuted,
    paddingHorizontal: H_PAD,
    paddingVertical: 8,
  },
  offlineHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    color: FIGMA.textMuted,
    paddingHorizontal: H_PAD,
    paddingBottom: 16,
    textAlign: 'center',
  },
});

export default HomeScreen;
