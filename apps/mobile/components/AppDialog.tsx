import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

const INK = '#16352E';
const BODY = '#3D5C54';
const MUTED = '#737373';
const TEAL = '#1B8A70';
const DANGER = '#B3402A';
const WHITE = '#FFFFFF';

export type AppDialogButton = {
  label: string;
  onPress: () => void;
  /** 'primary' = filled teal, 'danger' = filled red, 'text' = plain text button */
  variant?: 'primary' | 'danger' | 'text';
};

export type AppDialogData = {
  title: string;
  message?: string;
  buttons: AppDialogButton[];
};

const BG_BY_VARIANT: Record<NonNullable<AppDialogButton['variant']>, { bg: string; fg: string }> = {
  primary: { bg: TEAL, fg: WHITE },
  danger: { bg: DANGER, fg: WHITE },
  text: { bg: 'transparent', fg: TEAL },
};

/** In-app replacement for the system Alert dialog, matching the app design system. */
export const AppDialog: React.FC<{ dialog: AppDialogData | null; onClose: () => void }> = ({
  dialog,
  onClose,
}) => {
  if (!dialog) return null;

  return (
    <Modal visible transparent animationType='fade' statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel='Dismiss' />
        <View style={styles.card}>
          <Text style={styles.title}>{dialog.title}</Text>
          {dialog.message ? <Text style={styles.message}>{dialog.message}</Text> : null}
          <View style={styles.buttonRow}>
            {dialog.buttons.map((btn) => {
              const v = BG_BY_VARIANT[btn.variant ?? 'primary'];
              return (
                <Pressable
                  key={btn.label}
                  style={[
                    styles.button,
                    btn.variant === 'text' ? styles.textButton : styles.filledButton,
                    { backgroundColor: v.bg },
                  ]}
                  onPress={() => {
                    onClose();
                    btn.onPress();
                  }}
                  accessibilityRole='button'
                  accessibilityLabel={btn.label}
                >
                  <Text style={[styles.buttonText, { color: v.fg }]}>{btn.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    backgroundColor: WHITE,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(22,53,46,0.12)',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    shadowColor: '#16352E',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 6,
  },
  title: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 18,
    lineHeight: 24,
    color: INK,
  },
  message: {
    marginTop: 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    color: BODY,
  },
  buttonRow: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 10,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  textButton: {
    paddingHorizontal: 8,
  },
  filledButton: {},
  buttonText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
  },
});

/** Reusable tone presets */
export const dialogTones = { INK, BODY, MUTED, TEAL, DANGER };
