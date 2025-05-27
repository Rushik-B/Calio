import { useAuth } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useOnboarding } from './components/OnboardingContext';

// Hook to warm up browser for better UX during OAuth flows
export const useWarmUpBrowser = () => {
  React.useEffect(() => {
    WebBrowser.warmUpAsync();
    return () => {
      WebBrowser.coolDownAsync();
    };
  }, []);
};

export default function Page() {
  useWarmUpBrowser();
  const { isSignedIn, isLoaded } = useAuth();
  const { isOnboardingCompleted } = useOnboarding();
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  console.log('🔍 Index Page Debug:', { isLoaded, isSignedIn, onboardingComplete });

  useEffect(() => {
    const checkOnboarding = async () => {
      if (isSignedIn) {
        const completed = await isOnboardingCompleted();
        console.log('🔍 Onboarding check result:', completed);
        setOnboardingComplete(completed);
      }
    };
    checkOnboarding();
  }, [isOnboardingCompleted, isSignedIn]);

  // Show loading while Clerk is loading
  if (!isLoaded) {
    console.log('🔍 Clerk not loaded yet');
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 10 }}>Loading Clerk...</Text>
      </View>
    );
  }

  // Show loading while checking onboarding status
  if (isSignedIn && onboardingComplete === null) {
    console.log('🔍 Checking onboarding status');
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={{ marginTop: 10 }}>Checking onboarding...</Text>
      </View>
    );
  }

  console.log('🔍 Rendering redirects');

  if (isSignedIn) {
    if (onboardingComplete) {
      console.log('🔍 Redirecting to main');
      return <Redirect href="/(main)" />;
    } else {
      console.log('🔍 Redirecting to onboarding');
      return <Redirect href="/(onboarding)/welcome" />;
    }
  } else {
    console.log('🔍 Redirecting to sign-in');
    return <Redirect href="/(auth)/sign-in" />;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f5f5f5' },
});
