import { useAuth, useOAuth } from '@clerk/clerk-expo';
import { router } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

export default function Page() {
  const { startOAuthFlow } = useOAuth({ strategy: "oauth_google" });
  const { getToken, isSignedIn } = useAuth();

  // This function is called AFTER sign-in, when you want to sync the user
  const syncUser = async (token: string) => {
    try {
      const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}/api/auth/sync-user`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });
      const data = await res.json();
      // You can handle the user object here (save to state, etc.)
      console.log('Synced user:', data.user);
    } catch (error) {
      console.error('Error syncing user:', error);
    }
  };

  const handleSignInWithGoogle = async () => {
    try {
      const { createdSessionId, setActive } = await startOAuthFlow();
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        // Wait a moment to ensure session is active, then get token and sync
        setTimeout(async () => {
          const token = await getToken(); // JWT for the backend
          if (token) {
            await syncUser(token);
          }
          // Redirect to onboarding after successful sign-in
          router.replace('/(onboarding)/welcome');
        }, 1000); // Small delay for safety
      }
    } catch (err) {
      console.error("OAuth error", err);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ fontSize: 24, marginBottom: 32 }}>Sign in</Text>
      <TouchableOpacity
        onPress={handleSignInWithGoogle}
        style={{
          backgroundColor: '#4285F4',
          paddingVertical: 14,
          paddingHorizontal: 30,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
          Sign in with Google
        </Text>
      </TouchableOpacity>
    </View>
  );
}
