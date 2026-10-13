import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { setStatusBarStyle } from 'expo-status-bar';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Theme } from '../constants/theme';
import { JamIcon } from './JamIcon';
import { LogoWordmark } from './LogoWordmark';
import { HeaderIconCluster } from './HeaderIconCluster';

interface HeaderProps {
  title: string;
  showBack?: boolean;
  onBackPress?: () => void;
  showNotification?: boolean;
  showLogo?: boolean;
  /** Home wordmark: Tara, Cavite! in Bebas Neue */
  homeBranding?: boolean;
  onMenuPress?: () => void;
  showFilter?: boolean;
  onFilterPress?: () => void;
  darkBackground?: boolean;
  showProfile?: boolean;
  /** Overrides the default title size for screens that need a smaller heading. */
  titleFontSize?: number;
  /** Trailing slot on the title bar, e.g. a save button or the icon cluster. */
  right?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  showBack = false,
  onBackPress,
  showNotification = false,
  showLogo = false,
  homeBranding = false,
  onMenuPress,
  showFilter = false,
  onFilterPress,
  darkBackground = false,
  showProfile = false,
  titleFontSize,
  right,
}) => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  /** The header owns the status-bar inset, so its hosts never wrap it in a SafeAreaView. */
  const topInset = { paddingTop: insets.top + (homeBranding ? 14 : 6) };
  const hasTrailingContent = Boolean(right) || showFilter || showNotification;
  const headerStyle = darkBackground ? styles.darkHeader : styles.lightHeader;
  const textColor = darkBackground ? Colors.white : Colors.primary;
  const iconColor = darkBackground ? Colors.white : Colors.primary;

  /**
   * Android draws edge to edge, so the bar paints behind the status bar and its
   * clock has to invert with the header. Done on focus rather than declaratively
   * because tab screens stay mounted, and the last mount would otherwise win.
   */
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(darkBackground ? 'light' : 'dark');
    }, [darkBackground])
  );

  if (homeBranding) {
    return (
      <View style={[styles.container, styles.lightHeader, styles.homeHeader, topInset]}>
        <View style={styles.homeHeaderRow}>
          <View
            style={styles.wordmarkRow}
            accessible
            accessibilityRole="header"
            accessibilityLabel="Tara, Cavite!"
          >
            <Text style={styles.wordmark}>
              <Text style={styles.wordmarkAccent}>Tara</Text>
              <Text style={styles.wordmarkPrimary}>, Cavite!</Text>
            </Text>
          </View>
          {/* Announcements live beside the search filter on Home, not up here. */}
          <HeaderIconCluster showBell={showNotification} showProfile={showProfile} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, headerStyle, topInset]}>
      {showBack ? (
        <TouchableOpacity
          onPress={onBackPress ?? (() => navigation.goBack())}
          style={styles.iconButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <JamIcon
            ionicon="arrow-back"
            size={26}
            color={darkBackground ? '#FFFFFF' : iconColor}
          />
        </TouchableOpacity>
      ) : showLogo && onMenuPress ? (
        <TouchableOpacity
          onPress={onMenuPress}
          style={styles.iconButton}
          accessibilityLabel="Open menu"
          accessibilityRole="button"
        >
          <JamIcon ionicon="menu" size={29} color={iconColor} />
        </TouchableOpacity>
      ) : (
        <View style={styles.iconButton} />
      )}
      {showLogo ? (
        <View style={styles.headerBrand}>
          <LogoWordmark markSize={28} wordFontSize={22} />
        </View>
      ) : (
        <Text style={[styles.title, { color: textColor, fontSize: titleFontSize }]}>{title}</Text>
      )}
      {/* Empty trailing slot still needs the back button's width so the title stays centred. */}
      <View style={styles.rightGroup}>
        {hasTrailingContent ? null : <View style={styles.iconButton} />}
        {showFilter ? (
          <TouchableOpacity
            onPress={onFilterPress}
            style={styles.iconButton}
            accessibilityLabel="Open filters"
            accessibilityRole="button"
          >
            <JamIcon ionicon="filter" size={24} color={iconColor} />
          </TouchableOpacity>
        ) : null}
        {showNotification ? (
          <HeaderIconCluster showProfile={false} tint={iconColor} />
        ) : null}
        {right}
      </View>
    </View>
  );
};

/** Trailing header button, sized to mirror the back chevron's tap target. */
export const HeaderAction: React.FC<{
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onPress, accessibilityLabel, disabled = false, children }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled}
    style={styles.iconButton}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
  >
    {children}
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
    paddingHorizontal: Theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lightHeader: {
    backgroundColor: Colors.white,
  },
  darkHeader: {
    backgroundColor: Colors.primary,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: 'Poppins_700Bold',
    flex: 1,
    textAlign: 'center',
  },
  headerBrand: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  rightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  homeHeader: {
    paddingBottom: 8,
  },
  homeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 1,
  },
  wordmark: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: 0.6,
  },
  wordmarkAccent: {
    color: Colors.cta,
  },
  wordmarkPrimary: {
    color: Colors.primary,
  },
});
