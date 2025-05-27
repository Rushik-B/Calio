import { ClerkProvider } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { OnboardingProvider } from './components/OnboardingContext';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY

function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey}>
      <OnboardingProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
          <Stack.Screen name="(main)" options={{ headerShown: false }} />
          <Stack.Screen name="(home)" options={{ headerShown: false }} />
        </Stack>
      </OnboardingProvider>
    </ClerkProvider>
  )
}

export default RootLayout;