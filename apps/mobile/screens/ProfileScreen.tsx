import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useState, useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaviteVisitMap } from '../components/CaviteVisitMap';
import { JamIcon, type JamIconName } from '../components/JamIcon';
import { supabase } from '../lib/supabase';
import {
  DESTINATION_REACHED_UPDATED_EVENT,
} from '../lib/destinationReachedActivity';
import {
  getItineraryStartsCount,
  ITINERARY_STARTS_UPDATED_EVENT,
} from '../lib/itineraryStartsActivity';
import { navigateNamed } from '../lib/navigateNamed';
import { countDistinctSavedPlacesForUser } from '../lib/savedListItems';
import {
  fetchProfileActivity,
  fetchPublicListsPreview,
  type ProfileReview,
  type ProfileVisit,
  type PublicListPreview,
} from '../lib/profileActivity';
import {
  AVATAR_UPDATED_EVENT,
  COVER_UPDATED_EVENT,
  deriveProfile,
  displayBirthday,
  emitAvatarUpdated,
  fetchProfileRow,
  removeUserAvatar,
  removeUserCover,
  type TravelerProfileView,
  uploadUserCover,
  usernameForRow,
} from '../lib/travelerProfile';
import { Header } from '../components/Header';
import {
  imageExtensionFromUri,
  imageMimeType,
  readLocalImageBytes,
} from '../lib/readImageBytes';

const PAGE_BG = '#F1F7F6';
const CARD_WHITE = '#ffffff';
const TITLE = '#171717';
const MUTED = '#737373';
const BODY = '#525252';
const TEAL = '#1B8A70';
const OLIVE = '#10A37F';
const NEUTRAL_50 = '#FAFAFA';
const PLACEHOLDER_IMG = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80';

/** Which sheet the single modal host is showing. RN modals do not stack reliably. */
type ModalView = 'reviews' | 'history' | null;

function formatVisitDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const d = raw.length <= 10 ? new Date(`${raw}T00:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function AboutMeta({ name, children }: { name: JamIconName; children: string }) {
  return (
    <View style={styles.infoRow}>
      <JamIcon name={name} size={16} color={TEAL} />
      <Text style={styles.infoText}>{children}</Text>
    </View>
  );
}

function StarRating({ rating }: { rating: number }) {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
  return (
    <View style={styles.starRow} accessibilityLabel={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <JamIcon key={i} name="star" size={13} color={i <= n ? TEAL : '#E5E5E5'} />
      ))}
    </View>
  );
}

function StatBox({
  icon,
  value,
  label,
  onPress,
}: {
  icon: JamIconName;
  value: number;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.statBox}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={styles.statIcon}>
        <JamIcon name={icon} size={16} color={TEAL} />
      </View>
      <View style={styles.statCopy}>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function SettingsRow({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: JamIconName;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.settingsRow}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={styles.settingsIcon}>
        <JamIcon name={icon} size={18} color={TEAL} />
      </View>
      <View style={styles.settingsCopy}>
        <Text style={styles.settingsRowLabel}>{title}</Text>
        <Text style={styles.settingsHint}>{hint}</Text>
      </View>
      <JamIcon name="chevron-right" size={16} color="#a3a3a3" />
    </TouchableOpacity>
  );
}

function EmptyPanel({
  title,
  description,
  ctaLabel,
  onCta,
}: {
  title: string;
  description: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <View style={styles.emptyPanel}>
      <View style={styles.emptyGlyph}>
        <JamIcon name="map-marker" size={26} color={TEAL} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{description}</Text>
      {ctaLabel && onCta ? (
        <TouchableOpacity
          style={styles.emptyCta}
          onPress={onCta}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
        >
          <Text style={styles.emptyCtaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const ProfileScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<TravelerProfileView>(() => deriveProfile(null, null));
  const [checkinCount, setCheckinCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviews, setReviews] = useState<ProfileReview[]>([]);
  const [visits, setVisits] = useState<ProfileVisit[]>([]);
  const [itinerariesUsedCount, setItinerariesUsedCount] = useState(0);
  const [savedPlaceCount, setSavedPlaceCount] = useState(0);
  const [publicLists, setPublicLists] = useState<PublicListPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [modalView, setModalView] = useState<ModalView>(null);

  const loadProfileData = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const {
        data: { user: u },
      } = await supabase.auth.getUser();

      if (!u) {
        setProfile(deriveProfile(null, null));
        setCheckinCount(0);
        setReviewCount(0);
        setReviews([]);
        setVisits([]);
        setItinerariesUsedCount(0);
        setSavedPlaceCount(0);
        setPublicLists([]);
        return;
      }

      const profileRow = await fetchProfileRow(supabase, u.id);
      setProfile(deriveProfile(u, profileRow));

      const [activity, itStartsCount, savedCount, lists] = await Promise.all([
        fetchProfileActivity(supabase, u.id),
        getItineraryStartsCount(u.id),
        countDistinctSavedPlacesForUser(supabase, u.id).catch(() => 0),
        fetchPublicListsPreview(supabase, u.id).catch(() => [] as PublicListPreview[]),
      ]);

      setCheckinCount(activity.checkinCount);
      setReviewCount(activity.reviewCount);
      setReviews(activity.reviews);
      setVisits(activity.visits);
      setItinerariesUsedCount(itStartsCount);
      setSavedPlaceCount(savedCount);
      setPublicLists(lists);
    } catch (e) {
      console.error('Profile load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfileData(false);
    }, [loadProfileData])
  );

  useEffect(() => {
    const events = [
      DESTINATION_REACHED_UPDATED_EVENT,
      AVATAR_UPDATED_EVENT,
      COVER_UPDATED_EVENT,
      ITINERARY_STARTS_UPDATED_EVENT,
    ];
    const subs = events.map((name) =>
      DeviceEventEmitter.addListener(name, () => {
        void loadProfileData(true);
      })
    );
    return () => subs.forEach((s) => s.remove());
  }, [loadProfileData]);

  const go = (name: string, params?: object) => {
    navigateNamed(navigation, name, params);
  };

  const openEdit = (focusPassword = false) => {
    go('UserDetails', { focusPassword });
  };

  const openPlace = (placeId: string) => {
    setModalView(null);
    if (placeId) go('PlaceDetail', { placeId });
  };

  const openPublicList = (list: PublicListPreview) => {
    // SavedListDetail lives in the Saved stack, so the Profile stack cannot reach it
    // directly — target the tab and let it pick the nested route.
    go('Saved', {
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

  const pickCoverImage = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to photos to change your cover banner.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setUploading(true);
    try {
      await uploadUserCover(
        supabase,
        { uri: asset.uri, mimeType: asset.mimeType ?? undefined },
        profile.nickname
      );
      await loadProfileData(true);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not update cover banner.');
    } finally {
      setUploading(false);
    }
  };

  const confirmRemoveCover = () => {
    Alert.alert(
      'Remove cover photo?',
      'Your uploaded cover picture will be deleted and the default gradient will be used.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove cover',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setUploading(true);
              try {
                await removeUserCover(supabase, profile.nickname);
                await loadProfileData(true);
              } catch (e) {
                Alert.alert('Edit profile', e instanceof Error ? e.message : 'Could not remove cover photo.');
              } finally {
                setUploading(false);
              }
            })();
          },
        },
      ]
    );
  };

  const pickImage = async () => {
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to photos to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    setUploading(true);
    try {
      const fileBuffer = await readLocalImageBytes(uri);
      const ext = imageExtensionFromUri(uri);
      const mimeType = imageMimeType(ext, asset.mimeType);
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, fileBuffer, {
        upsert: true,
        contentType: mimeType,
        cacheControl: '3600',
      });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      const nick = usernameForRow({ nickname: profile.nickname, name: profile.name }, user);

      const { error: profileErr } = await supabase.from('user_profiles').upsert(
        {
          id: user.id,
          username: nick,
          avatar_url: publicUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (profileErr) throw profileErr;

      const { error: metaErr } = await supabase.auth.updateUser({
        data: {
          ...user.user_metadata,
          avatar_url: publicUrl,
          picture: publicUrl,
          cavitour_use_default_avatar: false,
        },
      });
      if (metaErr) throw metaErr;
      await supabase.auth.refreshSession();
      emitAvatarUpdated();
      await loadProfileData(true);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : 'Could not update profile picture.');
    } finally {
      setUploading(false);
    }
  };

  const confirmRemoveAvatar = () => {
    Alert.alert(
      'Remove profile photo?',
      'Your uploaded picture will be deleted and the default avatar will be used. You can upload a new photo anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove photo',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setUploading(true);
              try {
                await removeUserAvatar(supabase, profile.nickname);
                await loadProfileData(true);
              } catch (e) {
                Alert.alert('Edit profile', e instanceof Error ? e.message : 'Could not remove photo.');
              } finally {
                setUploading(false);
              }
            })();
          },
        },
      ]
    );
  };

  const handleLogout = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to access your profile and saved lists.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            await supabase.auth.signOut();
            await AsyncStorage.removeItem('isAuthenticated');
          } catch {
            Alert.alert('Error', 'Could not sign out. Please try again.');
          }
        },
      },
    ]);
  };

  const scrollBottom = Math.max(insets.bottom, 16) + 24;
  const showAvatarImage = profile.hasCustomPhoto && profile.avatarUrl.startsWith('http');

  if (loading && !refreshing) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator size="large" color={OLIVE} />
        <Text style={styles.loadingText}>Loading profile…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header title="Profile" showBack darkBackground />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadProfileData(true)}
            tintColor={OLIVE}
            colors={[OLIVE]}
          />
        }
      >
        <View style={styles.identityCard}>
          <View style={styles.coverWrap}>
            {profile.coverUrl ? (
              <Image source={{ uri: profile.coverUrl }} style={styles.coverImage} resizeMode="cover" />
            ) : (
              <LinearGradient
                colors={['#1B8A70', '#2A9B7F', '#D4EFE8']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.coverGradient}
              />
            )}
            <TouchableOpacity
              style={styles.coverEditBtn}
              onPress={() => void pickCoverImage()}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Upload cover banner"
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <JamIcon name="picture" size={14} color="#ffffff" />
              )}
            </TouchableOpacity>
            {profile.coverUrl ? (
              <TouchableOpacity
                style={styles.coverRemoveBtn}
                onPress={confirmRemoveCover}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel="Remove cover banner"
              >
                <JamIcon name="trash" size={14} color="#ffffff" />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.identityBody}>
            <View style={styles.avatarOverlapContainer}>
              <View style={styles.avatarRing}>
                {showAvatarImage ? (
                  <Image
                    source={{ uri: profile.avatarUrl }}
                    style={styles.avatar}
                    resizeMode="cover"
                    accessibilityLabel="Profile picture"
                  />
                ) : (
                  <View style={styles.avatarPlaceholder} accessibilityLabel="Default profile picture">
                    <JamIcon name="user" size={44} color="#b8c4ce" />
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={styles.avatarEditBtn}
                onPress={() => void pickImage()}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel="Upload profile photo"
              >
                {uploading ? (
                  <ActivityIndicator size="small" color={MUTED} />
                ) : (
                  <JamIcon name="pencil" size={14} color={MUTED} />
                )}
              </TouchableOpacity>
              {profile.hasCustomPhoto ? (
                <TouchableOpacity
                  style={styles.avatarRemoveBtn}
                  onPress={confirmRemoveAvatar}
                  disabled={uploading}
                  accessibilityRole="button"
                  accessibilityLabel="Remove profile photo"
                >
                  <JamIcon name="trash" size={14} color="#b91c1c" />
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.nickname}>{profile.nickname || 'Add a nickname'}</Text>
            {profile.bio ? <Text style={styles.bioText}>{profile.bio}</Text> : null}

            {profile.interestTags?.length ? (
              <View style={styles.interestsWrap}>
                {profile.interestTags.map((tag) => (
                  <View key={tag} style={styles.interestChip}>
                    <Text style={styles.interestChipText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <View style={styles.aboutDivider} />
            <Text style={styles.aboutHeading}>About</Text>
            <View style={styles.infoGrid}>
              <AboutMeta name="user">{profile.name}</AboutMeta>
              <AboutMeta name="document">{profile.email}</AboutMeta>
              <AboutMeta name="world">{profile.phone || 'Add phone in Edit profile'}</AboutMeta>
              <AboutMeta name="map-marker">{profile.city || 'Add location in Edit profile'}</AboutMeta>
              <AboutMeta name="calendar">
                {displayBirthday(profile.birthday) || 'Add birthday in Edit profile'}
              </AboutMeta>
            </View>

            <TouchableOpacity
              style={styles.editProfileBtn}
              onPress={() => openEdit(false)}
              accessibilityRole="button"
              accessibilityLabel="Edit profile"
            >
              <Text style={styles.editProfileBtnText}>Edit profile</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.signOutBtn}
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
            >
              <Text style={styles.signOutBtnText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.statsGrid}>
            <StatBox
              icon="map-marker"
              value={checkinCount}
              label="Destinations"
              onPress={() => setModalView('history')}
            />
            <StatBox
              icon="star"
              value={reviewCount}
              label="Reviews"
              onPress={() => setModalView('reviews')}
            />
            <StatBox
              icon="map"
              value={itinerariesUsedCount}
              label="Itineraries used"
              onPress={() => go('Itineraries')}
            />
            <StatBox
              icon="heart"
              value={savedPlaceCount}
              label="Saved places"
              onPress={() => go('Saved')}
            />
          </View>
        </View>

        <CaviteVisitMap visits={visits} />

        <View style={[styles.card, styles.publicCard]}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.sectionTitle}>Public lists</Text>
            <TouchableOpacity
              onPress={() => go('PublicLists')}
              accessibilityRole="button"
              accessibilityLabel="Manage public lists"
            >
              <Text style={styles.manageLink}>Manage</Text>
            </TouchableOpacity>
          </View>
          {publicLists.length === 0 ? (
            <EmptyPanel
              title="No public lists"
              description="Mark a saved list as public so it shows on your profile."
              ctaLabel="Go to Saved"
              onCta={() => go('Saved')}
            />
          ) : (
            <View style={styles.publicList}>
              {publicLists.map((list) => (
                <TouchableOpacity
                  key={list.id}
                  style={styles.publicRow}
                  onPress={() => openPublicList(list)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${list.name}, ${list.itemCount} items`}
                >
                  <Image
                    source={{ uri: list.cover || PLACEHOLDER_IMG }}
                    style={styles.publicThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.publicCopy}>
                    <Text style={styles.publicName} numberOfLines={1}>
                      {list.name}
                    </Text>
                    <Text style={styles.publicMeta}>
                      {list.itemCount === 1 ? '1 item' : `${list.itemCount} items`}
                    </Text>
                    <View style={styles.publicChip}>
                      <Text style={styles.publicChipText}>Public</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account settings</Text>
          <SettingsRow
            icon="cog"
            title="Account security"
            hint="Password and account access"
            onPress={() => openEdit(true)}
          />
          <SettingsRow
            icon="document"
            title="Privacy Policy"
            hint="How we handle your information"
            onPress={() => go('PrivacyPolicy')}
          />
          <SettingsRow
            icon="book"
            title="Terms of Use"
            hint="The rules for using Tara, Cavite!"
            onPress={() => go('Terms')}
          />
        </View>
      </ScrollView>

      <Modal
        visible={modalView !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setModalView(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setModalView(null)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>
                {modalView === 'reviews' ? 'Your reviews' : 'Travel history'}
              </Text>
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setModalView(null)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <JamIcon name="close" size={16} color={MUTED} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {modalView === 'reviews' ? (
                reviews.length === 0 ? (
                  <EmptyPanel
                    title="No reviews yet"
                    description="Rate places you’ve visited so others can discover Cavite with you."
                    ctaLabel="Explore destinations"
                    onCta={() => {
                      setModalView(null);
                      go('Dashboard');
                    }}
                  />
                ) : (
                  reviews.map((review) => (
                    <TouchableOpacity
                      key={review.id}
                      style={styles.reviewRow}
                      onPress={() => openPlace(review.placeId)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`Review of ${review.placeName}`}
                    >
                      <View style={styles.reviewHead}>
                        <View style={styles.reviewCopy}>
                          <Text style={styles.reviewPlace} numberOfLines={1}>
                            {review.placeName}
                          </Text>
                          <Text style={styles.reviewDate}>{formatVisitDate(review.createdAt)}</Text>
                        </View>
                        <StarRating rating={review.rating} />
                      </View>
                      {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
                    </TouchableOpacity>
                  ))
                )
              ) : visits.length === 0 ? (
                <EmptyPanel
                  title="No visits yet"
                  description="Reach a destination or check in to start your travel history across Cavite."
                  ctaLabel="Explore destinations"
                  onCta={() => {
                    setModalView(null);
                    go('Dashboard');
                  }}
                />
              ) : (
                visits.map((visit) => (
                  <TouchableOpacity
                    key={visit.id}
                    style={styles.visitRow}
                    onPress={() => openPlace(visit.placeId)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`${visit.placeName}, ${visit.checkedIn ? 'checked in' : 'reached'}`}
                  >
                    <View style={styles.visitCopy}>
                      <Text style={styles.visitPlace} numberOfLines={1}>
                        {visit.placeName}
                      </Text>
                      <Text style={styles.visitMeta}>
                        {[visit.cityMun || 'Cavite', formatVisitDate(visit.createdAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <View style={[styles.visitChip, visit.checkedIn ? styles.visitChipOn : null]}>
                      <Text
                        style={[styles.visitChipText, visit.checkedIn ? styles.visitChipTextOn : null]}
                      >
                        {visit.checkedIn ? 'Checked in' : 'Reached'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
  },
  android: { elevation: 3 },
  default: {},
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: MUTED,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    flexGrow: 1,
    gap: 14,
  },
  card: {
    backgroundColor: CARD_WHITE,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  publicCard: {
    marginBottom: 4,
  },
  identityCard: {
    backgroundColor: CARD_WHITE,
    borderRadius: 20,
    overflow: 'hidden',
    ...cardShadow,
  },
  coverWrap: {
    height: 110,
    width: '100%',
    position: 'relative',
    backgroundColor: TEAL,
  },
  coverGradient: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  coverImage: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  coverEditBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverRemoveBtn: {
    position: 'absolute',
    right: 52,
    top: 12,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityBody: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    alignItems: 'center',
  },
  avatarOverlapContainer: {
    marginTop: -52,
    position: 'relative',
    marginBottom: 8,
  },
  avatarRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 4,
    borderColor: '#ffffff',
    backgroundColor: '#e8ecef',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  avatarPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#e8ecef',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEditBtn: {
    position: 'absolute',
    right: -4,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CARD_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  avatarRemoveBtn: {
    position: 'absolute',
    left: -4,
    bottom: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fef2f2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  nickname: {
    marginTop: 4,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 20,
    lineHeight: 26,
    color: TITLE,
    textAlign: 'center',
  },
  bioText: {
    marginTop: 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: BODY,
    textAlign: 'center',
  },
  interestsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  interestChip: {
    backgroundColor: PAGE_BG,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.2)',
  },
  interestChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: TEAL,
  },
  aboutDivider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e5e5',
    marginTop: 18,
    marginBottom: 14,
  },
  aboutHeading: {
    alignSelf: 'flex-start',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#a3a3a3',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  infoGrid: {
    width: '100%',
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  infoText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: BODY,
  },
  editProfileBtn: {
    width: '100%',
    height: 44,
    borderRadius: 22,
    backgroundColor: TEAL,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  editProfileBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: '#ffffff',
  },
  signOutBtn: {
    width: '100%',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  signOutBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: MUTED,
  },
  sectionTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    lineHeight: 22,
    color: TITLE,
  },
  cardHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  manageLink: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: TEAL,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    backgroundColor: NEUTRAL_50,
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexGrow: 1,
    flexBasis: '45%',
    minWidth: 0,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CARD_WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
  },
  statCopy: {
    flex: 1,
    minWidth: 0,
  },
  statValue: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 18,
    lineHeight: 22,
    color: TITLE,
  },
  statLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
  },
  settingsRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  settingsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PAGE_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsCopy: {
    flex: 1,
    minWidth: 0,
  },
  settingsRowLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: TITLE,
  },
  settingsHint: {
    marginTop: 2,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: MUTED,
  },
  publicList: {
    marginTop: 14,
    gap: 12,
  },
  publicRow: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 14,
    padding: 8,
    backgroundColor: NEUTRAL_50,
  },
  publicThumb: {
    width: 64,
    height: 64,
    borderRadius: 12,
    backgroundColor: '#E8EEEC',
  },
  publicCopy: {
    flex: 1,
    minWidth: 0,
  },
  publicName: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: TITLE,
  },
  publicMeta: {
    marginTop: 2,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
  },
  publicChip: {
    alignSelf: 'flex-start',
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: PAGE_BG,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(27, 138, 112, 0.2)',
  },
  publicChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: TEAL,
  },
  emptyPanel: {
    marginTop: 14,
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: NEUTRAL_50,
    paddingHorizontal: 16,
    paddingVertical: 26,
  },
  emptyGlyph: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E8F5F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 12,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#262626',
  },
  emptyBody: {
    marginTop: 4,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: MUTED,
    textAlign: 'center',
  },
  emptyCta: {
    marginTop: 16,
    borderRadius: 999,
    backgroundColor: TEAL,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  emptyCtaText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#ffffff',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxHeight: '82%',
    borderRadius: 20,
    backgroundColor: CARD_WHITE,
    padding: 18,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 17,
    color: TITLE,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: NEUTRAL_50,
  },
  modalScroll: {
    marginTop: 14,
  },
  reviewRow: {
    borderRadius: 14,
    backgroundColor: NEUTRAL_50,
    padding: 14,
    marginBottom: 10,
  },
  reviewHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  reviewCopy: {
    flex: 1,
    minWidth: 0,
  },
  reviewPlace: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: TITLE,
  },
  reviewDate: {
    marginTop: 3,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
  },
  reviewBody: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e5e5e5',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: BODY,
  },
  starRow: {
    flexDirection: 'row',
    gap: 1,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
  },
  visitCopy: {
    flex: 1,
    minWidth: 0,
  },
  visitPlace: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    color: TITLE,
  },
  visitMeta: {
    marginTop: 2,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: MUTED,
  },
  visitChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#F5F5F5',
  },
  visitChipOn: {
    backgroundColor: '#D4EFE8',
  },
  visitChipText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: '#525252',
  },
  visitChipTextOn: {
    color: TEAL,
  },
});

export default ProfileScreen;
