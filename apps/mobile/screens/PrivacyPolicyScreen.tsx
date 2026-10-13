import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '../components/Header';
import { Colors } from '../constants/Colors';

/**
 * PrivacyPolicyScreen — the full legal document from PRIVACY_POLICY.md, styled as
 * the app's travel route: numbered waypoints (real section numbers) joined by a
 * dashed line, ending at the contact card ("destination").
 */

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'bullets'; items: string[] };

interface SubSection {
  label: string;
  title: string;
  blocks: Block[];
}

interface Section {
  title: string;
  blocks?: Block[];
  subs?: SubSection[];
}

const POLICY: Section[] = [
  {
    title: 'Information we collect',
    subs: [
      {
        label: 'a',
        title: 'Account information',
        blocks: [
          {
            kind: 'p',
            text: 'When you create an account, we collect your email address, name, and unique user ID. If you sign in with Google, we receive your Google account name and email address as authorized by you. Authentication is handled through our backend provider, Supabase (Supabase, Inc.).',
          },
        ],
      },
      {
        label: 'b',
        title: 'Location information',
        blocks: [
          {
            kind: 'p',
            text: 'With your permission, the App collects device location (precise, foreground only). We use your location solely to:',
          },
          {
            kind: 'bullets',
            items: [
              'Show your position on in-app maps;',
              'Calculate distances and directions to tourist destinations and establishments;',
              'Help you navigate using Google Maps directions.',
            ],
          },
          {
            kind: 'p',
            text: 'We do not track your location in the background, and we do not store your location history on our servers. Location data is processed on your device and is not used to build advertising or behavioral profiles.',
          },
        ],
      },
      {
        label: 'c',
        title: 'Camera access',
        blocks: [
          {
            kind: 'p',
            text: 'With your permission, the App uses your device camera solely to scan QR codes for establishment check-ins. The App does not take, store, or upload photographs of you or your surroundings through camera use.',
          },
        ],
      },
      {
        label: 'd',
        title: 'Photos you choose to submit',
        blocks: [
          {
            kind: 'p',
            text: 'If you write a review for an establishment, you may optionally attach up to four (4) photos from your device. These photos are uploaded to and stored in secure Supabase Storage and may be displayed publicly on the App alongside your review (with your display name).',
          },
        ],
      },
      {
        label: 'e',
        title: 'User content and activity',
        blocks: [
          {
            kind: 'bullets',
            items: [
              'Reviews and ratings you submit (text, rating, photos, display name, timestamp);',
              'Check-in records confirming visits to establishments;',
              'Saved lists and preferences (saved places, filters, itineraries).',
            ],
          },
        ],
      },
      {
        label: 'f',
        title: 'Locally stored information',
        blocks: [
          {
            kind: 'p',
            text: 'The App stores certain preferences and activity data on your device only using local storage (AsyncStorage), such as your sign-in state, saved places, filters, and recent visit activity. This data stays on your device unless the features above explicitly sync it to our servers.',
          },
        ],
      },
      {
        label: 'g',
        title: 'Automatic data',
        blocks: [
          {
            kind: 'p',
            text: 'When you use the App, our backend may process standard technical information such as IP addresses and device/session identifiers necessary to deliver the service, secure accounts, and prevent abuse.',
          },
        ],
      },
    ],
  },
  {
    title: 'How we use information',
    blocks: [
      { kind: 'p', text: 'We use the information we collect to:' },
      {
        kind: 'bullets',
        items: [
          'Create and manage your account and authenticate you (including Google sign-in);',
          'Provide core App features: browsing destinations, maps, directions, itineraries, check-ins, and reviews;',
          'Display your reviews, photos, and check-in activity within the App;',
          'Maintain the security, integrity, and safety of the App, including detecting fraud and abuse;',
          'Respond to support requests and account issues, including account deletion requests;',
          'Comply with legal obligations.',
        ],
      },
      {
        kind: 'p',
        text: 'We do not sell your personal information. We do not use your data for third-party advertising, and the App contains no ads and no third-party analytics or tracking SDKs.',
      },
    ],
  },
  {
    title: 'Legal bases (for EEA/UK users)',
    blocks: [
      { kind: 'p', text: 'Where the GDPR applies, we process your data on the following bases:' },
      {
        kind: 'bullets',
        items: [
          'Contract: to provide the App\u2019s features you request (account, reviews, check-ins);',
          'Consent: for location access and camera access, which you may withdraw at any time via your device settings;',
          'Legitimate interests: to secure the service and prevent abuse.',
        ],
      },
    ],
  },
  {
    title: 'Data sharing',
    blocks: [
      { kind: 'p', text: 'We share data only with the following:' },
      {
        kind: 'bullets',
        items: [
          'Supabase (Supabase, Inc.) \u2014 our backend and hosting provider (database, authentication, and file storage). Supabase processes account data, reviews, photos, and check-in data on our behalf. Supabase\u2019s privacy policy: supabase.com/privacy',
          'Google Maps / Google Play services \u2014 when you open directions, coordinates are passed to Google Maps on your device, governed by Google\u2019s privacy policy.',
          'Google OAuth \u2014 if you sign in with Google, authentication is governed by Google\u2019s privacy policy (policies.google.com/privacy).',
        ],
      },
      {
        kind: 'p',
        text: 'We may also disclose information if required by law, regulation, or valid legal process, or to protect the rights, property, or safety of our users or others.',
      },
    ],
  },
  {
    title: 'Data retention',
    blocks: [
      {
        kind: 'bullets',
        items: [
          'Account data is retained for as long as your account is active.',
          'Reviews, review photos, and check-in records are retained until you delete them or request deletion.',
          'Location data is used transiently on your device and is not retained on our servers.',
          'Data may be retained longer where required for legal compliance, dispute resolution, or security purposes.',
        ],
      },
    ],
  },
  {
    title: 'Data deletion',
    blocks: [
      {
        kind: 'p',
        text: 'You may delete your account directly from within the App at any time. Go to Profile \u2192 Edit profile (User details) \u2192 Delete account and confirm the prompt. Deleting your account permanently removes your account, profile information, reviews, check-in records, and cloud saved lists. This cannot be undone. Locally stored data (preferences, saved-item caches, visit activity on your device) is removed when you delete your account and can also be cleared by uninstalling the App or clearing its storage. If you cannot access your account or have trouble deleting it, you may alternatively request deletion by emailing us at taracavite.app@gmail.com, and we will verify your identity and complete the request.',
      },
    ],
  },
  {
    title: 'Security',
    blocks: [
      {
        kind: 'p',
        text: 'We use HTTPS/TLS encryption for all data transmitted between the App and our servers. Data is stored in Supabase infrastructure with encryption at rest and access controlled by row-level security policies and authenticated access. Review photo storage is access-controlled, and photos are only served publicly as part of published reviews. However, no method of transmission or storage is 100% secure, and we cannot guarantee absolute security.',
      },
    ],
  },
  {
    title: 'Children\u2019s privacy',
    blocks: [
      {
        kind: 'p',
        text: 'The App is a general-audience tourism app and is not directed to children under 13 (or the equivalent minimum age in your jurisdiction). We do not knowingly collect personal information from children. If you believe a child has provided us with personal information, contact us at taracavite.app@gmail.com and we will delete it promptly.',
      },
    ],
  },
  {
    title: 'Your rights',
    blocks: [
      {
        kind: 'p',
        text: 'Depending on your jurisdiction (e.g., EEA/UK under GDPR, California under CCPA/CPRA, Philippines under the Data Privacy Act of 2012), you may have the right to:',
      },
      {
        kind: 'bullets',
        items: [
          'Access the personal data we hold about you;',
          'Request correction or deletion of your data;',
          'Withdraw consent (e.g., revoke location or camera permission via device settings);',
          'Object to or restrict processing;',
          'Lodge a complaint with your local data protection authority.',
        ],
      },
      { kind: 'p', text: 'To exercise any of these rights, contact us at taracavite.app@gmail.com.' },
    ],
  },
  {
    title: 'Changes to this policy',
    blocks: [
      {
        kind: 'p',
        text: 'We may update this Privacy Policy from time to time. When we make changes, we will update the \u201cEffective date\u201d above and, for material changes, provide notice within the App or on our store listing. Continued use of the App after changes take effect constitutes acceptance of the updated policy.',
      },
    ],
  },
];

const CONTACT_EMAIL = 'taracavite.app@gmail.com';

function Blocks({ blocks, accent }: { blocks: Block[]; accent: string }) {
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === 'bullets') {
          return (
            <View key={i} style={styles.bullets}>
              {block.items.map((item, j) => (
                <View key={j} style={styles.bulletRow}>
                  <View style={[styles.bulletDot, { backgroundColor: accent }]} />
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={styles.body}>
            {block.text}
          </Text>
        );
      })}
    </>
  );
}

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();

  const openEmail = () => {
    void Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=Privacy%20Policy%20request%20\u2014%20Tara,%20Cavite!`).catch(
      () => undefined
    );
  };

  return (
    <View style={styles.root}>
      <Header title="Privacy Policy" showBack darkBackground />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Document head — the trailhead */}
        <View style={[styles.card, styles.headCard]}>
          <Text style={styles.brandTitle}>Tara, Cavite!</Text>
          <Text style={styles.headTitle}>Privacy Policy</Text>
          <View style={styles.effectiveChip}>
            <Text style={styles.effectiveText}>Effective date September 17, 2026</Text>
          </View>
          <Text style={styles.headBody}>
            This policy describes how Tara, Cavite! handles information when you use our mobile
            application available on Google Play. By using the App, you agree to the practices described here.
          </Text>
        </View>

        {/* Sections as waypoints on a route */}
        {POLICY.map((section, index) => {
          const number = index + 1;
          const isLast = index === POLICY.length - 1;
          return (
            <View key={section.title} style={styles.routeRow}>
              <View style={styles.rail}>
                <View style={styles.waypoint}>
                  <Text style={styles.waypointNumber}>{number}</Text>
                </View>
                {!isLast ? <View style={styles.railLine} /> : null}
              </View>
              <View style={[styles.card, styles.sectionCard, isLast && styles.sectionCardLast]}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.blocks ? <Blocks blocks={section.blocks} accent={Colors.primary} /> : null}
                {section.subs
                  ? section.subs.map((sub) => (
                      <View key={sub.label} style={styles.sub}>
                        <Text style={styles.subTitle}>
                          <Text style={styles.subBadge}>{sub.label}</Text>{'  '}
                          {sub.title}
                        </Text>
                        <Blocks blocks={sub.blocks} accent={Colors.accent} />
                      </View>
                    ))
                  : null}
              </View>
            </View>
          );
        })}

        {/* Destination: contact card */}
        <View style={styles.contactCard}>
          <Text style={styles.contactTitle}>11 · Contact us</Text>
          <Text style={styles.contactBody}>
            Reach us for any privacy question, concern, or request.
          </Text>
          <TouchableOpacity style={styles.contactBtn} onPress={openEmail} accessibilityRole="button">
            <Text style={styles.contactBtnText}>{CONTACT_EMAIL}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footnote}>
          Intended to comply with Google Play\u2019s User Data policy and Data safety requirements.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F1F7F6',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  headCard: {
    marginBottom: 20,
  },
  brandTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 22,
    letterSpacing: 1.5,
    color: Colors.primary,
  },
  headTitle: {
    marginTop: 2,
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: Colors.text.primary,
  },
  effectiveChip: {
    alignSelf: 'flex-start',
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#D4EFE8',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  effectiveText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11,
    color: Colors.primary,
  },
  headBody: {
    marginTop: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: Colors.text.secondary,
  },
  routeRow: {
    flexDirection: 'row',
  },
  rail: {
    width: 32,
    alignItems: 'center',
  },
  waypoint: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  waypointNumber: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  railLine: {
    flex: 1,
    width: 2,
    marginVertical: 4,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#BFDCD3',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 20,
  },
  sectionCard: {
    flex: 1,
    marginLeft: 10,
    marginBottom: 16,
  },
  sectionCardLast: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: Colors.text.primary,
  },
  body: {
    marginTop: 8,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: Colors.text.secondary,
  },
  bullets: {
    marginTop: 8,
  },
  bulletRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    marginRight: 8,
  },
  bulletText: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 20,
    color: Colors.text.secondary,
  },
  sub: {
    marginTop: 14,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#DCEBE7',
  },
  subTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13.5,
    color: Colors.text.primary,
  },
  subBadge: {
    color: Colors.primary,
  },
  contactCard: {
    borderRadius: 28,
    padding: 22,
    backgroundColor: Colors.primary,
  },
  contactTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  contactBody: {
    marginTop: 6,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#DCF2EC',
  },
  contactBtn: {
    alignSelf: 'flex-start',
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  contactBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13,
    color: Colors.primary,
  },
  footnote: {
    marginTop: 16,
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    color: '#8FA5A0',
  },
});
