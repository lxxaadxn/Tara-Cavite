import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';

const PAGE_BG = '#f4f7f9';
const TITLE = '#171717';
const MUTED = '#737373';
const TEAL = '#1B8A70';

export default function PrivacyScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Header title="Privacy" showBack darkBackground />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.heading}>Full privacy policy</Text>
          <Text style={styles.body}>
            The complete Privacy Policy — what we collect, how we use it, and your rights — lives on its own page.
          </Text>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => (navigation as { navigate: (name: string) => void }).navigate('PrivacyPolicy')}
            accessibilityRole="button"
          >
            <Text style={styles.linkBtnText}>Read the full Privacy Policy</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Saved list visibility</Text>
          <Text style={styles.body}>
            Each saved list can be private or public. You choose that when you create or edit a list — there is no
            separate account-wide privacy switch yet.
          </Text>
          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => (navigation as { navigate: (name: string) => void }).navigate('SavedList')}
            accessibilityRole="button"
          >
            <Text style={styles.linkBtnText}>Manage saved lists</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.heading}>Public profile</Text>
          <Text style={styles.body}>
            A public traveler profile is not available yet. Your name, photo, and travel interests stay on your account
            until that option is added.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 28,
    padding: 20,
    marginBottom: 12,
  },
  heading: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: TITLE,
  },
  body: {
    marginTop: 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
    color: MUTED,
  },
  linkBtn: {
    alignSelf: 'flex-start',
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: '#D4EFE8',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  linkBtnText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: TEAL,
  },
});
