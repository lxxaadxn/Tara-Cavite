import AsyncStorage from '@react-native-async-storage/async-storage';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { getFocusedRouteNameFromRoute, NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { BebasNeue_400Regular } from '@expo-google-fonts/bebas-neue';
import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, Alert, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { createNavigationContainerRef } from '@react-navigation/native';

import { JamIcon } from './components/JamIcon';
import { AuthRecoveryProvider } from './context/AuthRecoveryContext';
import { Colors } from './constants/Colors';
import {
  extractCheckinCodeFromText,
} from 'cavitour-shared/placeCheckin';
import { applyOAuthCallbackFromUrl, isOAuthCallbackUrl } from './lib/authOAuth';
import { applyPasswordRecoveryFromUrl, isPasswordRecoveryUrl } from './lib/authRecoveryDeepLink';
import { isStoredSessionInvalidError } from './lib/authHelpers';
import { isSupabaseConfigured, supabase, clearBrokenAuthSession } from './lib/supabase';
import { TRAVELER_ACCOUNT_DISABLED_MESSAGE } from 'cavitour-shared/accountStatus';
import { rejectDisabledTraveler } from './lib/rejectDisabledTraveler';
import {
  consumePendingCheckinCode,
  isCheckinUrl,
  savePendingCheckinCode,
} from './lib/checkinDeepLink';
import { confirmCheckinFromCode } from './lib/confirmCheckin';

// Keep native splash (brand mark) visible until fonts are ready
SplashScreen.preventAutoHideAsync();

// Screens
import DirectionsScreen from './screens/DirectionsScreen';
import HistoryScreen from './screens/HistoryScreen';
import HomeScreen from './screens/HomeScreen';
import ItinerariesScreen from './screens/ItinerariesScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import MapScreen from './screens/MapScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import PlaceDetailScreen from './screens/PlaceDetailScreen';
import AboutEstablishmentScreen from './screens/AboutEstablishmentScreen';
import CheckinScreen from './screens/CheckinScreen';
import PreferencesScreen from './screens/PreferencesScreen';
import ProfileScreen from './screens/ProfileScreen';
import SavedListScreen from './screens/SavedListScreen';
import SavedListDetailScreen from './screens/SavedListDetailScreen';
import PublicListsScreen from './screens/PublicListsScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import SignInScreen from './screens/SignInScreen';
import SignUpScreen from './screens/SignUpScreen';
import UserDetailsScreen from './screens/UserDetailsScreen';
import TravelHistoryScreen from './screens/TravelHistoryScreen';
import PrivacyScreen from './screens/PrivacyScreen';
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen';
import TermsScreen from './screens/TermsScreen';
import NewListScreen from './screens/NewListScreen';
import CreateItineraryScreen from './screens/CreateItineraryScreen';
import CategoriesScreen from './screens/CategoriesScreen';
import ItineraryDetailScreen from './screens/ItineraryDetailScreen';
import FullRouteMapScreen from './screens/FullRouteMapScreen';
import { LocationPermissionModal, markMobileLocationPromptPending, clearMobileLocationPromptDismissed } from './components/LocationPermissionModal';
import { LogoWordmark } from './components/LogoWordmark';
import { CheckinScannerModal } from './components/CheckinScannerModal';
import { ScanTabButton } from './components/ScanTabButton';
import {
  getMainFloatingTabBarStyle,
  getMainTabBarItemStyle,
  tabBarShowsLabels,
  TAB_BAR_LABEL_FONT_SIZE,
  TAB_BAR_LABEL_LINE_HEIGHT,
} from './lib/mainTabBarStyle';
import AnnouncementsScreen from './screens/AnnouncementsScreen';

const Stack = createStackNavigator();
const Tab = createBottomTabNavigator();
/** Keep false so Google/email sessions persist and OAuth callbacks are not cleared on launch. */
const REQUIRE_SIGN_IN_ON_EACH_LAUNCH = false;

const navigationRef = createNavigationContainerRef();

// Auth Stack
const AuthStack = () => (
  <Stack.Navigator
    screenOptions={{
      headerShown: false,
      cardStyle: { flex: 1, backgroundColor: Colors.white },
    }}
  >
    <Stack.Screen name="SignIn" component={SignInScreen} />
    <Stack.Screen name="SignUp" component={SignUpScreen} />
    <Stack.Screen name="Terms" component={TermsScreen} />
    <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
  </Stack.Navigator>
);

/**
 * Post-bundle startup (landing) → then sign-in. `stackKey` remounts this navigator so we never
 * resume straight on Auth after sign-out or a stale navigation state.
 */
function UnauthedFlow({ stackKey }: { stackKey: number }) {
  return (
    <Stack.Navigator
      key={stackKey}
      screenOptions={{ headerShown: false }}
      initialRouteName="Landing"
    >
      <Stack.Screen name="Landing" component={OnboardingScreen} />
      <Stack.Screen name="Auth" component={AuthStack} />
    </Stack.Navigator>
  );
}

// Home Stack
const DashboardStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="HomeMain" component={HomeScreen} />
    <Stack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
    <Stack.Screen name="AboutEstablishment" component={AboutEstablishmentScreen} />
    <Stack.Screen name="Checkin" component={CheckinScreen} />
    <Stack.Screen name="Directions" component={DirectionsScreen} />
    <Stack.Screen name="FullRouteMap" component={FullRouteMapScreen} />
    <Stack.Screen name="Categories" component={CategoriesScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
  </Stack.Navigator>
);

// Itineraries Stack
const ItinerariesStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="ItinerariesMain" component={ItinerariesScreen} />
    <Stack.Screen name="ItineraryDetail" component={ItineraryDetailScreen} />
    <Stack.Screen name="History" component={HistoryScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
    <Stack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
    <Stack.Screen name="AboutEstablishment" component={AboutEstablishmentScreen} />
    <Stack.Screen name="Checkin" component={CheckinScreen} />
    <Stack.Screen name="Directions" component={DirectionsScreen} />
    <Stack.Screen name="FullRouteMap" component={FullRouteMapScreen} />
    <Stack.Screen name="NewList" component={NewListScreen} />
    <Stack.Screen name="CreateItinerary" component={CreateItineraryScreen} />
  </Stack.Navigator>
);

// Profile Stack
const ProfileStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="ProfileMain" component={ProfileScreen} />
    <Stack.Screen name="PublicLists" component={PublicListsScreen} />
    <Stack.Screen name="UserDetails" component={UserDetailsScreen} />
    <Stack.Screen name="Preferences" component={PreferencesScreen} />
    <Stack.Screen name="History" component={HistoryScreen} />
    <Stack.Screen name="TravelHistory" component={TravelHistoryScreen} />
    <Stack.Screen name="Privacy" component={PrivacyScreen} />
    <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicyScreen} />
    <Stack.Screen name="Terms" component={TermsScreen} />
    <Stack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
    <Stack.Screen name="AboutEstablishment" component={AboutEstablishmentScreen} />
    <Stack.Screen name="Checkin" component={CheckinScreen} />
    <Stack.Screen name="Directions" component={DirectionsScreen} />
    <Stack.Screen name="FullRouteMap" component={FullRouteMapScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
  </Stack.Navigator>
);

// Saved Stack
const SavedStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="SavedList" component={SavedListScreen} />
    <Stack.Screen name="SavedListDetail" component={SavedListDetailScreen} />
    <Stack.Screen name="NewList" component={NewListScreen} />
    <Stack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
    <Stack.Screen name="AboutEstablishment" component={AboutEstablishmentScreen} />
    <Stack.Screen name="Checkin" component={CheckinScreen} />
    <Stack.Screen name="Directions" component={DirectionsScreen} />
    <Stack.Screen name="FullRouteMap" component={FullRouteMapScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
  </Stack.Navigator>
);

// Map Stack
const MapStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="MapMain" component={MapScreen} />
    <Stack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
    <Stack.Screen name="AboutEstablishment" component={AboutEstablishmentScreen} />
    <Stack.Screen name="Checkin" component={CheckinScreen} />
    <Stack.Screen name="Directions" component={DirectionsScreen} />
    <Stack.Screen name="FullRouteMap" component={FullRouteMapScreen} />
    <Stack.Screen name="Notifications" component={NotificationsScreen} />
  </Stack.Navigator>
);

const AnnouncementsStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="AnnouncementsMain" component={AnnouncementsScreen} />
  </Stack.Navigator>
);

function ScanPlaceholder() {
  return <View style={{ flex: 1, backgroundColor: Colors.background }} />;
}

const HIDE_TAB_ROUTES = new Set([
  // Roots that carry the solid teal app bar and navigate back instead of via tabs.
  'ItinerariesMain',
  'SavedList',
  'ProfileMain',
  'AnnouncementsMain',
  'Notifications',
  'Directions',
  'FullRouteMap',
  'AboutEstablishment',
  'PlaceDetail',
  'NewList',
  'CreateItinerary',
  'SavedListDetail',
  'PublicLists',
  'ItineraryDetail',
  'UserDetails',
  'TravelHistory',
  'Privacy',
  'PrivacyPolicy',
  'Terms',
]);

function shouldHideTabBar(route: object, fallback: string) {
  const focused = getFocusedRouteNameFromRoute(route) ?? fallback;
  return HIDE_TAB_ROUTES.has(focused);
}

function tabIconName(routeName: string) {
  if (routeName === 'Dashboard') return 'home-outline';
  if (routeName === 'Itineraries') return 'document-text-outline';
  if (routeName === 'Map') return 'map-outline';
  if (routeName === 'Saved') return 'bookmark-outline';
  if (routeName === 'Announcements') return 'notifications-outline';
  return 'circle';
}

const TAB_BAR_ICON_SIZE = 26;

/**
 * Announcements and Profile are reached from header buttons, not the pill.
 * `tabBarButton` alone only blanks the item — BottomTabItem still renders a
 * `flex: 1` wrapper, which would leave two empty slots on the right.
 */
const HIDDEN_TAB_ITEM = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: 'none' as const },
};

// Main Tabs: Home · Itineraries · Scan · Map · Saved · Alerts · Profile
function MainTabs() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [scanOpen, setScanOpen] = useState(false);
  const showTabLabels = tabBarShowsLabels(windowWidth);
  const mainTabBarStyle = getMainFloatingTabBarStyle(insets.bottom, showTabLabels);
  const mainTabBarItemStyle = getMainTabBarItemStyle(showTabLabels);

  const tabOpts = (fallback: string) =>
    ({ route }: { route: object }) => ({
      tabBarStyle: shouldHideTabBar(route, fallback) ? { display: 'none' as const } : mainTabBarStyle,
    });

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarIcon: ({ color }) => (
            <JamIcon ionicon={tabIconName(route.name)} size={TAB_BAR_ICON_SIZE} color={color} />
          ),
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: Colors.primary,
          headerShown: false,
          tabBarShowLabel: showTabLabels,
          tabBarLabelStyle: {
            fontSize: TAB_BAR_LABEL_FONT_SIZE,
            lineHeight: TAB_BAR_LABEL_LINE_HEIGHT,
            fontFamily: 'Poppins_500Medium',
            marginBottom: 0,
          },
          tabBarStyle: mainTabBarStyle,
          tabBarItemStyle: mainTabBarItemStyle,
        })}
      >
        <Tab.Screen
          name="Dashboard"
          component={DashboardStack}
          options={(args) => ({ ...tabOpts('HomeMain')(args), tabBarLabel: 'Home' })}
        />
        <Tab.Screen
          name="Itineraries"
          component={ItinerariesStack}
          options={(args) => ({ ...tabOpts('ItinerariesMain')(args), tabBarLabel: 'Itineraries' })}
        />
        <Tab.Screen
          name="Scan"
          component={ScanPlaceholder}
          options={{
            tabBarLabel: () => null,
            tabBarIcon: () => null,
            tabBarButton: (props) => <ScanTabButton {...props} showLabel={showTabLabels} />,
          }}
          listeners={{
            tabPress: (e) => {
              e.preventDefault();
              setScanOpen(true);
            },
          }}
        />
        <Tab.Screen
          name="Map"
          component={MapStack}
          options={(args) => ({ ...tabOpts('MapMain')(args), tabBarLabel: 'Map' })}
        />
        <Tab.Screen
          name="Saved"
          component={SavedStack}
          options={(args) => ({ ...tabOpts('SavedList')(args), tabBarLabel: 'Saved' })}
        />
        <Tab.Screen
          name="Announcements"
          component={AnnouncementsStack}
          options={(args) => ({
            ...tabOpts('AnnouncementsMain')(args),
            tabBarLabel: 'Alerts',
            ...HIDDEN_TAB_ITEM,
          })}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileStack}
          options={(args) => ({
            ...tabOpts('ProfileMain')(args),
            tabBarLabel: 'Profile',
            ...HIDDEN_TAB_ITEM,
          })}
        />
      </Tab.Navigator>
      <CheckinScannerModal visible={scanOpen} onClose={() => setScanOpen(false)} />
    </View>
  );
}

// Session hydrate: cream + mark + wordmark (never the old CaviTour splash art)
const bundlingPageStyle = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
});

export default function App() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    BebasNeue_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
  });
  const [authHydrated, setAuthHydrated] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [unauthedStackKey, setUnauthedStackKey] = useState(0);
  const [blockMainForRecovery, setBlockMainForRecovery] = useState(false);
  const didClearAuthRef = useRef(false);
  const pendingRecoveryNavRef = useRef(false);
  const pendingCheckinNavRef = useRef(false);

  const navigateToRecoveryScreen = useCallback(() => {
    requestAnimationFrame(() => {
      if (navigationRef.isReady()) {
        (
          navigationRef as unknown as {
            navigate: (name: string, params: object) => void;
          }
        ).navigate('Unauthed', {
          screen: 'Auth',
          params: { screen: 'ResetPassword' },
        });
      }
    });
  }, []);

  const endPasswordRecoveryFlow = useCallback(() => {
    setBlockMainForRecovery(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const safety = setTimeout(() => {
      if (!cancelled) setAuthHydrated(true);
    }, 8000);

    const init = async () => {
      let skipStartupSignOut = false;
      try {
        if (isSupabaseConfigured) {
          await Promise.race([
            clearBrokenAuthSession(),
            new Promise<void>((resolve) => setTimeout(resolve, 4000)),
          ]);
        }
        if (cancelled) return;
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl && isPasswordRecoveryUrl(initialUrl)) {
          setBlockMainForRecovery(true);
          const ok = await applyPasswordRecoveryFromUrl(supabase, initialUrl);
          if (ok) {
            skipStartupSignOut = true;
            pendingRecoveryNavRef.current = true;
          }
        } else if (initialUrl && isOAuthCallbackUrl(initialUrl)) {
          const ok = await applyOAuthCallbackFromUrl(supabase, initialUrl);
          if (ok) {
            skipStartupSignOut = true;
            await AsyncStorage.setItem('isAuthenticated', 'true');
            setIsAuthenticated(true);
          }
        } else if (initialUrl && isCheckinUrl(initialUrl)) {
          const code = extractCheckinCodeFromText(initialUrl);
          if (code) {
            await savePendingCheckinCode(code);
            pendingCheckinNavRef.current = true;
          }
        } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const webUrl = window.location.href;
          if (isOAuthCallbackUrl(webUrl)) {
            const ok = await applyOAuthCallbackFromUrl(supabase, webUrl);
            if (ok) {
              skipStartupSignOut = true;
              await AsyncStorage.setItem('isAuthenticated', 'true');
              setIsAuthenticated(true);
              window.history.replaceState({}, '', window.location.pathname || '/');
            }
          }
        }
      } catch {
        // Ignore invalid recovery URLs on cold start.
      }

      if (cancelled) return;

      if (REQUIRE_SIGN_IN_ON_EACH_LAUNCH && isSupabaseConfigured && !skipStartupSignOut) {
        try {
          await supabase.auth.signOut();
        } catch {
          // Ignore startup cleanup errors; app will still route to auth flow.
        }
        await AsyncStorage.setItem('isAuthenticated', 'false');
        setIsAuthenticated(false);
        setUnauthedStackKey((k) => k + 1);
      }
      try {
        await Promise.race([
          checkAuthStatus(),
          new Promise<void>((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch {
        /* ignore */
      }
      if (!cancelled) setAuthHydrated(true);
    };

    void init();
    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, []);

  useEffect(() => {
    const openCheckinIfNeeded = (url: string) => {
      const code = extractCheckinCodeFromText(url);
      if (!code || !isCheckinUrl(url)) return false;
      // Stay on the current screen — only confirm + count the visit.
      void confirmCheckinFromCode(code, 'qr');
      return true;
    };

    const sub = Linking.addEventListener('url', ({ url }) => {
      if (openCheckinIfNeeded(url)) return;
      if (isOAuthCallbackUrl(url)) {
        void (async () => {
          const ok = await applyOAuthCallbackFromUrl(supabase, url);
          if (ok) {
            await AsyncStorage.setItem('isAuthenticated', 'true');
            // Force Main tabs on both iOS and Android as soon as the session exists.
            setIsAuthenticated(true);
            await markMobileLocationPromptPending();
            try {
              const { data } = await supabase.auth.getSession();
              setSessionUserId(data.session?.user?.id ?? null);
            } catch {
              /* ignore */
            }
          }
        })();
        return;
      }
      if (!isPasswordRecoveryUrl(url)) {
        return;
      }
      void (async () => {
        setBlockMainForRecovery(true);
        const ok = await applyPasswordRecoveryFromUrl(supabase, url);
        if (ok) {
          navigateToRecoveryScreen();
        }
      })();
    });
    return () => sub.remove();
  }, [navigateToRecoveryScreen]);

  // After sign-in, finish any QR check-in that was waiting — popup only, no page change.
  useEffect(() => {
    if (!isAuthenticated || blockMainForRecovery) return;
    let cancelled = false;
    void (async () => {
      const code = await consumePendingCheckinCode();
      if (cancelled || !code) {
        pendingCheckinNavRef.current = false;
        return;
      }
      pendingCheckinNavRef.current = false;
      setTimeout(() => {
        if (!cancelled) void confirmCheckinFromCode(code, 'qr');
      }, 400);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, blockMainForRecovery]);

  // Sync auth state with Supabase session (persisted across app restarts)
  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    const updateAuthFromSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session) {
          const allowed = await rejectDisabledTraveler(session);
          if (!allowed) {
            await AsyncStorage.setItem('isAuthenticated', 'false');
            setIsAuthenticated(false);
            setSessionUserId(null);
            Alert.alert('Account deactivated', TRAVELER_ACCOUNT_DISABLED_MESSAGE);
            return;
          }
          didClearAuthRef.current = false;
          await AsyncStorage.setItem('isAuthenticated', 'true');
          setIsAuthenticated(true);
          setSessionUserId(session.user?.id ?? null);
          return;
        }
        if (error && isStoredSessionInvalidError(error) && !didClearAuthRef.current) {
          didClearAuthRef.current = true;
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // Best-effort; SDK may have already cleared storage.
          }
        }
        await AsyncStorage.setItem('isAuthenticated', 'false');
        setIsAuthenticated(false);
        setSessionUserId(null);
      } catch {
        if (!didClearAuthRef.current) {
          didClearAuthRef.current = true;
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // Ignore; we only want to clear local auth state best-effort.
          }
        }
        setIsAuthenticated(false);
        setSessionUserId(null);
      }
    };

    updateAuthFromSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setBlockMainForRecovery(true);
        navigateToRecoveryScreen();
      }
      const isSignedIn = !!session;
      setIsAuthenticated(isSignedIn);
      setSessionUserId(session?.user?.id ?? null);
      void AsyncStorage.setItem('isAuthenticated', isSignedIn ? 'true' : 'false');
      if (event === 'SIGNED_IN' && session?.user?.id) {
        void markMobileLocationPromptPending();
      }
      if (event === 'SIGNED_OUT') {
        void clearMobileLocationPromptDismissed();
        setUnauthedStackKey((k) => k + 1);
      }
      // Never await Supabase calls inside this callback — it can deadlock email login.
      if (session) {
        const signedInEvent = event;
        setTimeout(() => {
          void rejectDisabledTraveler(session).then((allowed) => {
            if (allowed) return;
            void AsyncStorage.setItem('isAuthenticated', 'false');
            setIsAuthenticated(false);
            setSessionUserId(null);
            if (signedInEvent === 'SIGNED_IN') {
              Alert.alert('Account deactivated', TRAVELER_ACCOUNT_DISABLED_MESSAGE);
            }
          });
        }, 0);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigateToRecoveryScreen]);

  const checkAuthStatus = async () => {
    if (!isSupabaseConfigured) {
      await AsyncStorage.setItem('isAuthenticated', 'false');
      setIsAuthenticated(false);
      return;
    }
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (session) {
        didClearAuthRef.current = false;
        setIsAuthenticated(true);
        setSessionUserId(session.user?.id ?? null);
        return;
      }
      if (error && isStoredSessionInvalidError(error)) {
        if (!didClearAuthRef.current) {
          didClearAuthRef.current = true;
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch {
            // Best-effort cleanup only.
          }
        }
        await AsyncStorage.setItem('isAuthenticated', 'false');
        setIsAuthenticated(false);
        setSessionUserId(null);
        return;
      }
      if (error) {
        // Transient refresh failure: keep optimistic flag until auth state settles.
        const value = await AsyncStorage.getItem('isAuthenticated');
        setIsAuthenticated(value === 'true');
        return;
      }
      await AsyncStorage.setItem('isAuthenticated', 'false');
      setIsAuthenticated(false);
    } catch {
      if (!didClearAuthRef.current) {
        didClearAuthRef.current = true;
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {
          // Best-effort cleanup only.
        }
      }
      setIsAuthenticated(false);
    }
  };

  // Hide native splash once fonts are ready (don't wait forever on auth)
  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  // Brief logo while session is read — capped by init safety timeout
  if (!authHydrated) {
    return (
      <SafeAreaProvider>
        <View style={bundlingPageStyle.container}>
          <LogoWordmark markSize={48} wordFontSize={36} />
        </View>
      </SafeAreaProvider>
    );
  }

  const showMainTabs = isAuthenticated && !blockMainForRecovery;

  // Logged out: Unauthed stack always starts on Landing, then Sign In. Logged in: main tabs.
  return (
    <SafeAreaProvider>
      <AuthRecoveryProvider endPasswordRecoveryFlow={endPasswordRecoveryFlow}>
        <NavigationContainer
          ref={navigationRef}
          onReady={() => {
            if (pendingRecoveryNavRef.current) {
              navigateToRecoveryScreen();
              pendingRecoveryNavRef.current = false;
            }
          }}
        >
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {!showMainTabs ? (
              <Stack.Screen name="Unauthed" options={{ headerShown: false }}>
                {() => <UnauthedFlow stackKey={unauthedStackKey} />}
              </Stack.Screen>
            ) : (
              <Stack.Screen name="Main" component={MainTabs} />
            )}
          </Stack.Navigator>
        </NavigationContainer>
        <LocationPermissionModal
          isAuthenticated={showMainTabs}
          userId={sessionUserId}
        />
      </AuthRecoveryProvider>
    </SafeAreaProvider>
  );
}
