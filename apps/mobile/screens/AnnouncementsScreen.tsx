import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Linking,
  RefreshControl,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fetchPublishedAnnouncements } from 'cavitour-shared/announcements';
import {
  AnnouncementCard,
  AnnouncementDetailModal,
  type AnnouncementCardItem,
} from '../components/announcementCards';
import { Header } from '../components/Header';
import { supabase } from '../lib/supabase';

const PAGE_BG = '#FAFAFA';
const TEAL = '#1B8A70';
const MUTED = '#7A7878';

/** Deep link target from a notification row. */
export type AnnouncementsParams = { focusId?: string };

/** Card grid from the web announcements page, stacked one-up for phones. */
const AnnouncementsScreen: React.FC = () => {
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const { focusId } = (route.params ?? {}) as AnnouncementsParams;
  const [items, setItems] = useState<AnnouncementCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AnnouncementCardItem | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const rows = (await fetchPublishedAnnouncements(supabase)) as AnnouncementCardItem[];
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load announcements.');
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening from a notification row lands straight on that announcement.
  useEffect(() => {
    if (!focusId || !items.length) return;
    const match = items.find((item) => item.id === focusId);
    if (match) setDetail(match);
  }, [focusId, items]);

  const onRegister = useCallback((item: AnnouncementCardItem) => {
    if (item.actionUrl) void Linking.openURL(item.actionUrl);
  }, []);

  return (
    <View style={styles.safe}>
      <Header title="Announcements" showBack darkBackground />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={TEAL} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <AnnouncementCard item={item} onSeeMore={setDetail} onRegister={onRegister} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={TEAL}
              colors={[TEAL]}
            />
          }
          ListHeaderComponent={error ? <Text style={styles.error}>{error}</Text> : null}
          ListEmptyComponent={
            error ? null : (
              <Text style={styles.empty}>No announcements yet. Check back soon.</Text>
            )
          }
        />
      )}

      <AnnouncementDetailModal
        item={detail}
        onClose={() => setDetail(null)}
        onRegister={onRegister}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingHorizontal: 24,
    paddingTop: 30,
    gap: 14,
  },
  error: {
    color: '#DC2626',
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    paddingVertical: 12,
  },
  empty: {
    color: MUTED,
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    paddingVertical: 12,
  },
});

export default AnnouncementsScreen;
