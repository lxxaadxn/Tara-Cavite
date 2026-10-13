import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ItineraryProductCard } from '../components/ItineraryProductCard';
import { Header } from '../components/Header';
import type { Place } from '../data/mockData';
import type { PublishedItinerary } from '../data/publishedItineraries';
import { supabase } from '../lib/supabase';
import { fetchDashboardPlacesPool, logPlacesFetchError } from '../lib/placesFromSupabase';
import { buildEnrichedItinerary } from '../lib/itineraryPlaces';
import { fetchPublishedItineraries, subscribeItineraries } from 'cavitour-shared/itineraries';

const PAGE_BG = '#F1F7F6';

const ItinerariesScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [catalogPlaces, setCatalogPlaces] = useState<Place[]>([]);
  const [published, setPublished] = useState<PublishedItinerary[]>([]);

  const openDetail = (itineraryId: string) => {
    (navigation as { navigate: (n: string, p: object) => void }).navigate('ItineraryDetail', {
      itineraryId,
    });
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [list, itineraries] = await Promise.all([
          fetchDashboardPlacesPool(supabase, 2000),
          fetchPublishedItineraries(supabase),
        ]);
        if (cancelled) return;
        setCatalogPlaces(list);
        setPublished((itineraries ?? []) as PublishedItinerary[]);
      } catch (err) {
        logPlacesFetchError('ItinerariesScreen.fetchDashboardPlacesPool', err);
        if (!cancelled) {
          setCatalogPlaces([]);
          setPublished([]);
        }
      }
    };
    load();
    const unsub = subscribeItineraries(supabase, () => {
      fetchPublishedItineraries(supabase)
        .then((itineraries) => {
          if (!cancelled) setPublished((itineraries ?? []) as PublishedItinerary[]);
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const items = useMemo(
    () => published.map((it) => buildEnrichedItinerary(it, catalogPlaces) ?? it),
    [catalogPlaces, published]
  );

  return (
    <View style={styles.safe}>
      <Header title="Itineraries" showBack darkBackground />

      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: it }) => (
          <ItineraryProductCard itinerary={it} onPress={() => openDetail(it.id)} />
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  listContent: {
    paddingHorizontal: 24,
    paddingTop: 30,
    gap: 18,
  },
});

export default ItinerariesScreen;
