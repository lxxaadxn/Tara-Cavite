import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { JamIcon } from '../components/JamIcon';
import { Header } from '../components/Header';
import { AppDialog, type AppDialogData } from '../components/AppDialog';
import { supabase } from '../lib/supabase';
import {
  fetchPublicListsPreview,
  type PublicListPreview,
} from '../lib/profileActivity';

const GREEN = '#10A37F';
const WHITE = '#FFFFFF';
const TITLE = '#241D13';
const MUTED = '#7A7878';
const TEAL = '#1B8A70';
const PAGE_BG = '#F1F7F6';
const PLACEHOLDER_IMG =
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80';

function formatUpdated(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (diff < 1) return 'Updated today';
    if (diff < 2) return 'Updated yesterday';
    if (diff < 7) return `Updated ${Math.floor(diff)} days ago`;
    return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  } catch {
    return '';
  }
}

/**
 * "Manage" target for the profile's Public lists card — shows ONLY the saved
 * lists the traveler has marked shared (public). Tapping a card opens its
 * contents in SavedListDetail; the trash button deletes it.
 */
const PublicListsScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [lists, setLists] = useState<PublicListPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AppDialogData | null>(null);

  const loadLists = async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLists([]);
        return;
      }
      setLists(await fetchPublicListsPreview(supabase, user.id));
    } catch (error) {
      console.error('Error loading public lists:', error);
      setLists([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    React.useCallback(() => {
      void loadLists(false);
    }, [])
  );

  const handleOpenList = (list: PublicListPreview) => {
    // SavedListDetail lives in the Saved stack, so target the tab and let it
    // pick the nested route (same pattern as the profile card).
    (
      navigation as unknown as { navigate: (name: string, params: object) => void }
    ).navigate('Saved', {
      screen: 'SavedListDetail',
      params: {
        listId: list.id,
        list: {
          id: list.id,
          name: list.name,
          description: list.description,
          icon_name: list.iconName,
          type: 'shared' as const,
        },
      },
    });
  };

  const handleDelete = (list: PublicListPreview) => {
    setDialog({
      title: 'Delete list',
      message: `Remove “${list.name}” and all items inside it? This can’t be undone.`,
      buttons: [
        { label: 'Cancel', variant: 'text', onPress: () => undefined },
        {
          label: 'Delete',
          variant: 'danger',
          onPress: () => {
            void (async () => {
              setDialog({
                title: 'Deleting…',
                message: 'Please wait a moment.',
                buttons: [{ label: 'Cancel', variant: 'text', onPress: () => undefined }],
              });
              setDeletingId(list.id);
              try {
                const { error } = await supabase.from('saved_lists').delete().eq('id', list.id);
                if (error) throw error;
                setLists((prev) => prev.filter((l) => l.id !== list.id));
                setDialog(null);
              } catch (error) {
                console.error('Error deleting public list:', error);
                setDialog({
                  title: 'Error',
                  message: 'Could not delete this list. Try again.',
                  buttons: [{ label: 'OK', onPress: () => undefined }],
                });
              } finally {
                setDeletingId(null);
              }
            })();
          },
        },
      ],
    });
  };

  const renderItem = ({ item }: { item: PublicListPreview }) => {
    const cover = String(item.cover ?? '').trim();
    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardMain}
          onPress={() => handleOpenList(item)}
          activeOpacity={0.75}
          accessibilityLabel={`${item.name}, ${item.itemCount} items, public`}
          accessibilityRole="button"
        >
          <Image
            source={cover ? { uri: cover } : { uri: PLACEHOLDER_IMG }}
            style={styles.thumb}
          />
          <View style={styles.cardText}>
            <Text style={styles.listTitle} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.publicPill}>Public</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.listSubtitle}>
                {item.itemCount} item{item.itemCount === 1 ? '' : 's'}
              </Text>
            </View>
            {item.description ? (
              <Text style={styles.descPreview} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
          </View>
          <JamIcon ionicon="chevron-forward" size={20} color={MUTED} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.trashBtn}
          onPress={() => handleDelete(item)}
          disabled={deletingId === item.id}
          accessibilityLabel={`Delete list ${item.name}`}
          accessibilityRole="button"
          hitSlop={12}
        >
          {deletingId === item.id ? (
            <ActivityIndicator size="small" color={MUTED} />
          ) : (
            <JamIcon ionicon="trash-outline" size={22} color="#C45C5C" />
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Header title="Public lists" showBack darkBackground />
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={styles.loadingText}>Loading your public lists…</Text>
        </View>
      ) : lists.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIconCircle}>
            <JamIcon name="bookmark" size={36} color={TEAL} />
          </View>
          <Text style={styles.emptyTitle}>No public lists</Text>
          <Text style={styles.emptySubtitle}>
            Mark a saved list as public so it shows on your profile.
          </Text>
          <TouchableOpacity
            style={styles.emptyCta}
            onPress={() => navigation.goBack()}
            activeOpacity={0.88}
          >
            <Text style={styles.emptyCtaText}>Go back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={lists}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: Math.max(insets.bottom, 24) + 24 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void loadLists(true)} />
          }
        />
      )}
      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontFamily: 'Poppins_500Medium',
    fontSize: 15,
    color: MUTED,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: WHITE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.08)',
    overflow: 'hidden',
    shadowColor: '#1B8A70',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    minWidth: 0,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#E8EEEA',
  },
  cardText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  listTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    lineHeight: 22,
    color: TITLE,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
  },
  publicPill: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: TEAL,
  },
  dot: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: MUTED,
    marginHorizontal: 6,
  },
  listSubtitle: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: MUTED,
  },
  descPreview: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
    color: MUTED,
    marginTop: 6,
  },
  trashBtn: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(122, 120, 120, 0.2)',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  emptyIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(27, 138, 112, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    marginTop: 12,
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: TITLE,
    textAlign: 'center',
  },
  emptySubtitle: {
    marginTop: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    color: MUTED,
    textAlign: 'center',
  },
  emptyCta: {
    marginTop: 24,
    backgroundColor: GREEN,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 14,
  },
  emptyCtaText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    color: WHITE,
  },
});

export default PublicListsScreen;

