import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { JamIcon } from '../components/JamIcon';
import { Header } from '../components/Header';
import { AppDialog, type AppDialogData } from '../components/AppDialog';
import type { JamIconName } from '../lib/jamSvgMap';
import { legacyIoniconToJam } from '../lib/legacyIoniconToJam';
import { supabase } from '../lib/supabase';
import { fetchSavedItemCountsByListId } from '../lib/savedListItems';

interface SavedList {
  id: string;
  name: string;
  description?: string;
  icon_name: string;
  type: 'private' | 'shared';
  place_count: number;
  created_at?: string;
  updated_at?: string;
}

const GREEN = '#10A37F';
const WHITE = '#FFFFFF';
const TITLE = '#241D13';
const MUTED = '#7A7878';
const CTA_DARK = '#213502';
const TEAL = '#1B8A70';
const PAGE_BG = '#F1F7F6';

function listIconVisual(iconName: string): { name: JamIconName; color: string } {
  const jam = legacyIoniconToJam(iconName);
  const colorMap: Record<string, string> = {
    heart: '#E85D5D',
    bookmark: '#9C27B0',
    bus: '#2196F3',
    car: '#2196F3',
    flag: '#61D0EC',
    star: '#FFC107',
    smiley: GREEN,
    'map-marker': '#2196F3',
    building: '#2196F3',
  };
  return { name: jam, color: colorMap[jam] ?? TEAL };
}

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

const SavedListScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [lists, setLists] = useState<SavedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AppDialogData | null>(null);
  const [query, setQuery] = useState('');

  const filteredLists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.description ?? '').toLowerCase().includes(q)
    );
  }, [lists, query]);

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

      const { data, error } = await supabase
        .from('saved_lists')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error loading lists:', error);
        setLists([]);
        return;
      }

      const rows = data || [];
      const listIds = rows.map((l) => l.id);
      let counts: Record<string, number> = {};
      try {
        counts = await fetchSavedItemCountsByListId(supabase, listIds);
      } catch (e) {
        console.error('Error loading list place counts:', e);
      }
      setLists(rows.map((l) => ({ ...l, place_count: counts[l.id] ?? 0 })));
    } catch (error) {
      console.error('Error loading lists:', error);
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

  const handleDelete = (list: SavedList) => {
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
                buttons: [
                  { label: 'Cancel', variant: 'text', onPress: () => undefined },
                ],
              });
              setDeletingId(list.id);
              try {
                const { error } = await supabase.from('saved_lists').delete().eq('id', list.id);
                if (error) throw error;
                setLists((prev) => prev.filter((l) => l.id !== list.id));
                setDialog(null);
              } catch (error) {
                console.error('Error deleting list:', error);
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

  const handleOpenList = (list: SavedList) => {
    (
      navigation as unknown as { navigate: (name: string, params: object) => void }
    ).navigate('SavedListDetail', {
      listId: list.id,
      list: {
        id: list.id,
        name: list.name,
        description: list.description,
        icon_name: list.icon_name,
        type: list.type,
      },
    });
  };

  const renderPageHeader = () => <Header title="Saved" showBack darkBackground />;

  const renderListItem = ({ item }: { item: SavedList }) => {
    const { name: iconJam, color: iconColor } = listIconVisual(item.icon_name);
    const updatedLabel = formatUpdated(item.updated_at || item.created_at);
    return (
      <View style={styles.card}>
        <TouchableOpacity
          style={styles.cardMain}
          onPress={() => handleOpenList(item)}
          activeOpacity={0.75}
          accessibilityLabel={`${item.name}, ${item.place_count} items`}
          accessibilityRole="button"
        >
          <View style={[styles.iconBubble, { backgroundColor: `${iconColor}18` }]}>
            <JamIcon name={iconJam} size={24} color={iconColor} />
          </View>
          <View style={styles.cardText}>
            <Text style={styles.listTitle} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.metaRow}>
              <Text style={styles.privacyPill}>{item.type === 'private' ? 'Private' : 'Public'}</Text>
              <Text style={styles.dot}>·</Text>
              <Text style={styles.listSubtitle}>
                {item.place_count} item{item.place_count === 1 ? '' : 's'}
              </Text>
            </View>
            {updatedLabel ? <Text style={styles.updatedHint}>{updatedLabel}</Text> : null}
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

  if (loading) {
    return (
      <View style={styles.root}>
        {renderPageHeader()}
        <View style={styles.loadingBody}>
          <ActivityIndicator size="large" color={GREEN} />
          <Text style={styles.loadingText}>Loading your lists…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {renderPageHeader()}

      <View style={styles.body}>
        {lists.length > 0 ? (
          <View style={styles.searchRow}>
            <View style={styles.searchPill}>
              <JamIcon name="search" size={18} color={GREEN} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search lists"
                placeholderTextColor="#B3AAAA"
                value={query}
                onChangeText={setQuery}
                accessibilityLabel="Search lists"
              />
              {query.length > 0 ? (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  accessibilityLabel="Clear search"
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <JamIcon ionicon="close" size={18} color={MUTED} />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              style={styles.addListCircle}
              onPress={() => navigation.navigate('NewList' as never)}
              activeOpacity={0.88}
              accessibilityLabel="Create new list"
              accessibilityRole="button"
            >
              <JamIcon ionicon="plus" size={24} color={WHITE} />
            </TouchableOpacity>
          </View>
        ) : null}

        {lists.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIconCircle}>
              <JamIcon ionicon="bookmark-outline" size={36} color={TEAL} />
            </View>
            <Text style={styles.emptyTitle}>Nothing saved yet</Text>
            <Text style={styles.emptySubtitle}>
              Browse places and tap save to add them to a list.
            </Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={() => navigation.navigate('NewList' as never)}
              activeOpacity={0.88}
            >
              <Text style={styles.emptyCtaText}>Create your first list</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filteredLists}
            renderItem={renderListItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: Math.max(insets.bottom, 20) + 32 },
            ]}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              query.trim() ? (
                <Text style={styles.noMatch}>No lists match “{query.trim()}”.</Text>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void loadLists(true)}
                tintColor={GREEN}
                colors={[GREEN]}
              />
            }
          />
        )}
      </View>

      <AppDialog dialog={dialog} onClose={() => setDialog(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  body: {
    flex: 1,
  },
  loadingBody: {
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
  addListCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: CTA_DARK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 12,
    gap: 10,
  },
  searchPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: WHITE,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(122, 120, 120, 0.28)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontSize: 14,
    fontFamily: 'Poppins_500Medium',
    color: TITLE,
  },
  noMatch: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: MUTED,
    textAlign: 'center',
    marginTop: 24,
  },
  listContent: {
    paddingHorizontal: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: WHITE,
    borderRadius: 16,
    marginBottom: 4,
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
    paddingVertical: 14,
    paddingLeft: 14,
    paddingRight: 8,
    minWidth: 0,
  },
  iconBubble: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
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
  privacyPill: {
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
  updatedHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: MUTED,
    marginTop: 4,
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

export default SavedListScreen;
