import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { JamIcon } from './JamIcon';

const TEAL = '#1B8A70';
const INK = '#16352E';
const WHITE = '#FFFFFF';

export type ToastTone = 'success' | 'error' | 'info';

export type ToastData = {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

export const Toast: React.FC<{ toast: ToastData | null; onDone: () => void }> = ({
  toast,
  onDone,
}) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(24)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!toast) return;
    translateY.setValue(24);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 24,
          duration: 180,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      ]).start(() => onDone());
    }, toast.durationMs ?? 2600);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast, translateY, opacity, onDone]);

  if (!toast) return null;

  const isError = toast.tone === 'error';
  const isInfo = toast.tone === 'info';
  const bg = isError ? '#B3402A' : isInfo ? INK : TEAL;
  const iconName = isError ? 'close-circle' : isInfo ? 'information-circle' : 'checkmark-circle';

  return (
    <Animated.View
      pointerEvents='none'
      style={[styles.wrap, { bottom: insets.bottom + 24, opacity, transform: [{ translateY }] }]}
      accessibilityLiveRegion='polite'
      accessibilityLabel={toast.message}
    >
      <View style={[styles.pill, { backgroundColor: bg }]}>
        <JamIcon ionicon={iconName} size={18} color={WHITE} />
        <Text style={styles.message} numberOfLines={2}>
          {toast.message}
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 100,
    elevation: 100,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '100%',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#16352E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },
  message: {
    flexShrink: 1,
    color: WHITE,
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
});
