/**
 * Traveler-facing announcement card and detail bottom sheet, mirroring the web
 * components/announcementCards.jsx.
 */
import React, { useMemo } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  announcementCardDateParts,
  announcementDisplayDateIso,
  announcementLocationLabel,
  announcementMapUrl,
  formatAnnouncementDateTimeRange,
} from 'cavitour-shared/announcements';

const MODAL_INK = '#16352E';
const MODAL_BODY = '#3D5C54';
const MODAL_LOCATION = '#4F7A70';
const CARD_INK = '#262626';
const CARD_MUTED = '#737373';
const CARD_FOOTER = '#1A2E28';

export type AnnouncementCardItem = {
  id: string;
  kind: string;
  title: string;
  place: string;
  body: string;
  imageUrl?: string | null;
  actionUrl?: string | null;
  publishedAt?: string | null;
  eventStartsAt?: string | null;
  eventEndsAt?: string | null;
  venueName?: string;
  latitude?: number | null;
  longitude?: number | null;
};

/** Map **bold** runs to nested Text segments (mobile stand-in for formatAnnouncementBodyHtml). */
export function tokenizeAnnouncementBody(text: string): Array<{ text: string; bold: boolean }> {
  const raw = String(text ?? '');
  const segments: Array<{ text: string; bold: boolean }> = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    if (match.index > cursor) segments.push({ text: raw.slice(cursor, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < raw.length) segments.push({ text: raw.slice(cursor), bold: false });
  return segments.length ? segments : [{ text: raw, bold: false }];
}

export function AnnouncementBodyText({ text, style }: { text: string; style?: TextStyle }) {
  const segments = useMemo(() => tokenizeAnnouncementBody(text), [text]);
  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.bold ? (
          <Text key={i} style={styles.bodyBold}>
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        )
      )}
    </Text>
  );
}

function AnnouncementCardDate({ iso }: { iso: string | null }) {
  const parts = announcementCardDateParts(iso);
  if (!parts) return <Text style={styles.cardDateTba}>Date TBA</Text>;
  return (
    <View style={styles.cardDateRow}>
      <Text style={styles.cardDateDay}>{parts.day}</Text>
      <View>
        <Text style={styles.cardDateMonth}>{parts.month}</Text>
        <Text style={styles.cardDateMonth}>{parts.year}</Text>
      </View>
    </View>
  );
}

function AnnouncementCover({ item }: { item: AnnouncementCardItem }) {
  if (item.imageUrl) {
    return (
      <Image
        source={{ uri: item.imageUrl }}
        style={styles.cardCoverImage}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
      />
    );
  }
  const isAdvisory = item.kind === 'advisory';
  return (
    <LinearGradient
      colors={isAdvisory ? ['#F4E8D4', '#C47B17'] : ['#D8EDE7', '#1B8A70']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.cardCoverFallback}
    >
      <Text style={styles.cardCoverFallbackText}>{isAdvisory ? 'Advisory' : 'Event'}</Text>
    </LinearGradient>
  );
}

/** Web parity: date block, location, title, 4:3 cover, dark Register / See more footer. */
export function AnnouncementCard({
  item,
  onSeeMore,
  onRegister,
}: {
  item: AnnouncementCardItem;
  onSeeMore: (item: AnnouncementCardItem) => void;
  onRegister?: (item: AnnouncementCardItem) => void;
}) {
  const location = announcementLocationLabel(item);
  const hasRegister = Boolean(item.actionUrl);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <AnnouncementCardDate iso={announcementDisplayDateIso(item)} />
        {location ? <Text style={styles.cardLocation}>{location}</Text> : null}
        <Text style={styles.cardTitle}>{item.title}</Text>
      </View>

      <View style={styles.cardCover}>
        <AnnouncementCover item={item} />
      </View>

      <View style={styles.cardFooter}>
        {hasRegister ? (
          <>
            <Pressable
              style={styles.cardFooterBtn}
              onPress={() => onRegister?.(item)}
              accessibilityRole="button"
              accessibilityLabel={`Register for ${item.title}`}
            >
              <Text style={styles.cardFooterText}>Register</Text>
            </Pressable>
            <View style={styles.cardFooterDivider} />
          </>
        ) : null}
        <Pressable
          style={styles.cardFooterBtn}
          onPress={() => onSeeMore(item)}
          accessibilityRole="button"
          accessibilityLabel={`See more about ${item.title}`}
        >
          <Text style={styles.cardFooterText}>See more</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function AnnouncementDetailModal({
  item,
  onClose,
  onRegister,
}: {
  item: AnnouncementCardItem | null;
  onClose: () => void;
  onRegister?: (item: AnnouncementCardItem) => void;
}) {
  const { height: windowHeight } = useWindowDimensions();

  if (!item) return null;

  const location = announcementLocationLabel(item);
  const eventRange = formatAnnouncementDateTimeRange(item.eventStartsAt, item.eventEndsAt);
  const mapUrl = announcementMapUrl(item);
  const isAdvisory = item.kind === 'advisory';
  const accent = isAdvisory
    ? {
        strip: ['#E8A23A', '#C47B17'] as const,
        badgeBg: '#FFF4E5',
        badgeText: '#9A5B0F',
        badgeRing: '#F0D2A0',
        dateBg: '#FFF8EF',
        dateText: '#8A4F0C',
        dateRing: '#F2D9B0',
        soft: '#FFFBF5',
        actionBg: '#C47B17',
        dot: '#C47B17',
      }
    : {
        strip: ['#3CB89A', '#1B8A70'] as const,
        badgeBg: '#E7F6F1',
        badgeText: '#146B57',
        badgeRing: '#B8E0D4',
        dateBg: '#F1F7F6',
        dateText: '#146B57',
        dateRing: '#C5E5DB',
        soft: '#F7FBFA',
        actionBg: '#1B8A70',
        dot: '#1B8A70',
      };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: accent.soft, maxHeight: windowHeight * 0.85 },
          ]}
        >
          <LinearGradient colors={accent.strip} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sheetStrip} />
          <Pressable
            style={styles.closeButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={6}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetContent}>
              <View style={styles.sheetHeadCol}>
                <View
                  style={[
                    styles.kindBadge,
                    { backgroundColor: accent.badgeBg, borderColor: accent.badgeRing },
                  ]}
                >
                  <Text style={[styles.kindBadgeText, { color: accent.badgeText }]}>
                    {isAdvisory ? 'Advisory' : 'Event'}
                  </Text>
                </View>
                <Text style={styles.sheetTitle}>{item.title}</Text>
                {location ? (
                  <View style={styles.locationRow}>
                    <View style={[styles.locationDot, { backgroundColor: accent.dot }]} />
                    <Text style={styles.locationText}>{location}</Text>
                  </View>
                ) : null}
                {eventRange ? (
                  <View style={styles.eventRow}>
                    <View style={[styles.locationDot, { backgroundColor: accent.dot }]} />
                    <Text style={[styles.eventText, { color: accent.dateText }]}>{eventRange}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.bodyBox}>
                <AnnouncementBodyText text={item.body} style={styles.bodyText} />
              </View>

              {item.actionUrl || mapUrl ? (
                <View style={styles.sheetActions}>
                  {item.actionUrl ? (
                    <Pressable
                      style={[styles.sheetAction, { backgroundColor: accent.actionBg }]}
                      onPress={() => onRegister?.(item)}
                      accessibilityRole="button"
                      accessibilityLabel="Register"
                    >
                      <Text style={styles.sheetActionText}>Register</Text>
                    </Pressable>
                  ) : null}
                  {mapUrl ? (
                    <Pressable
                      style={[styles.sheetAction, { backgroundColor: accent.actionBg }]}
                      onPress={() => {
                        void Linking.openURL(mapUrl);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel="Open map"
                    >
                      <Text style={styles.sheetActionText}>Open map</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(229, 229, 229, 0.85)',
  },
  cardHead: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
  },
  cardDateRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
  },
  cardDateDay: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 44,
    lineHeight: 48,
    color: '#171717',
  },
  cardDateMonth: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 12,
    lineHeight: 15,
    color: CARD_MUTED,
  },
  cardDateTba: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 14,
    color: '#A3A3A3',
  },
  cardLocation: {
    marginTop: 6,
    fontFamily: 'Poppins_400Regular',
    fontSize: 13,
    lineHeight: 18,
    color: CARD_MUTED,
  },
  cardTitle: {
    marginTop: 8,
    fontFamily: 'Poppins_700Bold',
    fontSize: 17,
    lineHeight: 24,
    color: CARD_INK,
  },
  cardCover: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: '#F5F5F5',
  },
  cardCoverImage: {
    width: '100%',
    height: '100%',
  },
  cardCoverFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCoverFallbackText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    letterSpacing: 2.8,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.9)',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: CARD_FOOTER,
  },
  cardFooterBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  cardFooterDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  cardFooterText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    color: '#FFFFFF',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,42,36,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  sheetStrip: {
    height: 6,
    width: '100%',
  },
  closeButton: {
    position: 'absolute',
    right: 12,
    top: 18,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  closeButtonText: {
    fontSize: 16,
    color: MODAL_INK,
    fontWeight: '600',
  },
  sheetContent: {
    padding: 20,
  },
  sheetHeadCol: {
    alignItems: 'center',
    width: '100%',
  },
  kindBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  kindBadgeText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sheetTitle: {
    marginTop: 8,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 20,
    lineHeight: 27,
    color: MODAL_INK,
    textAlign: 'center',
  },
  locationRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  locationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  locationText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    color: MODAL_LOCATION,
    flexShrink: 1,
    textAlign: 'center',
  },
  eventRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  eventText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    flexShrink: 1,
    textAlign: 'center',
  },
  bodyBox: {
    marginTop: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bodyText: {
    fontFamily: 'Poppins_400Regular',
    fontSize: 14,
    lineHeight: 22,
    color: MODAL_BODY,
  },
  bodyBold: {
    fontFamily: 'Poppins_600SemiBold',
    color: MODAL_INK,
  },
  sheetActions: {
    marginTop: 24,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  sheetAction: {
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  sheetActionText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
  },
});
