import { router } from 'expo-router';
import React, { useState } from 'react';
import {
    Dimensions,
    SafeAreaView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const { width, height } = Dimensions.get('window');

export default function CalendarConnectionScreen() {
  const [connectedCalendars, setConnectedCalendars] = useState<string[]>([]);

  const handleConnectGoogle = () => {
    // Implement Google Calendar connection
    setConnectedCalendars(prev => [...prev, 'google']);
  };

  const handleConnectMicrosoft = () => {
    // Implement Microsoft Outlook connection
    setConnectedCalendars(prev => [...prev, 'microsoft']);
  };

  const handleSkip = () => {
    router.push('/(onboarding)/notifications');
  };

  const handleNext = () => {
    router.push('/(onboarding)/notifications');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Connect your calendar(s)</Text>
          <Text style={styles.subtitle}>
            Calio works with your existing Google, Microsoft, or Apple calendar.
          </Text>
          <Text style={styles.subtext}>
            Connect them so your agent can start orchestrating.
          </Text>
        </View>

        {/* Calendar Connection Options */}
        <View style={styles.connectionsContainer}>
          {/* Google Calendar */}
          <TouchableOpacity
            style={[
              styles.connectionCard,
              connectedCalendars.includes('google') && styles.connectionCardConnected
            ]}
            onPress={handleConnectGoogle}
          >
            <View style={styles.connectionContent}>
              <View style={[styles.providerIcon, styles.googleIcon]}>
                <Text style={styles.iconText}>G</Text>
              </View>
              <View style={styles.connectionInfo}>
                <Text style={styles.providerName}>Google Calendar</Text>
                <Text style={styles.providerDescription}>
                  Connect your Google account
                </Text>
              </View>
              {connectedCalendars.includes('google') ? (
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedText}>✓</Text>
                </View>
              ) : (
                <View style={styles.connectButton}>
                  <Text style={styles.connectButtonText}>Connect</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Microsoft Outlook */}
          <TouchableOpacity
            style={[
              styles.connectionCard,
              connectedCalendars.includes('microsoft') && styles.connectionCardConnected
            ]}
            onPress={handleConnectMicrosoft}
          >
            <View style={styles.connectionContent}>
              <View style={[styles.providerIcon, styles.microsoftIcon]}>
                <Text style={styles.iconText}>M</Text>
              </View>
              <View style={styles.connectionInfo}>
                <Text style={styles.providerName}>Microsoft Outlook</Text>
                <Text style={styles.providerDescription}>
                  Connect your Microsoft account
                </Text>
              </View>
              {connectedCalendars.includes('microsoft') ? (
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedText}>✓</Text>
                </View>
              ) : (
                <View style={styles.connectButton}>
                  <Text style={styles.connectButtonText}>Connect</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>

          {/* Apple Calendar - Coming Soon */}
          <View style={[styles.connectionCard, styles.connectionCardDisabled]}>
            <View style={styles.connectionContent}>
              <View style={[styles.providerIcon, styles.appleIcon]}>
                <Text style={styles.iconText}>🍎</Text>
              </View>
              <View style={styles.connectionInfo}>
                <Text style={[styles.providerName, styles.disabledText]}>
                  Apple Calendar
                </Text>
                <Text style={[styles.providerDescription, styles.disabledText]}>
                  Coming soon
                </Text>
              </View>
              <View style={styles.comingSoonBadge}>
                <Text style={styles.comingSoonText}>Soon</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Visual Illustration */}
        <View style={styles.illustrationContainer}>
          <View style={styles.syncIllustration}>
            <View style={styles.deviceIcon}>
              <Text style={styles.deviceEmoji}>📱</Text>
            </View>
            <View style={styles.syncArrows}>
              <Text style={styles.syncArrow}>⟷</Text>
            </View>
            <View style={styles.cloudIcon}>
              <Text style={styles.cloudEmoji}>☁️</Text>
            </View>
          </View>
          <Text style={styles.illustrationText}>
            Your calendars sync seamlessly with Calio
          </Text>
        </View>

        {/* Progress Indicator */}
        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: '57%' }]} />
          </View>
          <Text style={styles.progressText}>4 of 7</Text>
        </View>

        {/* CTA Buttons */}
        <View style={styles.ctaContainer}>
          {connectedCalendars.length > 0 ? (
            <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
              <Text style={styles.nextButtonText}>Next</Text>
            </TouchableOpacity>
          ) : null}
          
          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    paddingTop: height * 0.06,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: '#666666',
    textAlign: 'center',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: '#999999',
    textAlign: 'center',
  },
  connectionsContainer: {
    marginBottom: 32,
  },
  connectionCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  connectionCardConnected: {
    backgroundColor: '#e8f4ff',
    borderColor: '#007AFF',
  },
  connectionCardDisabled: {
    backgroundColor: '#f0f0f0',
    opacity: 0.6,
  },
  connectionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  providerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  googleIcon: {
    backgroundColor: '#4285F4',
  },
  microsoftIcon: {
    backgroundColor: '#0078D4',
  },
  appleIcon: {
    backgroundColor: '#000000',
  },
  iconText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  connectionInfo: {
    flex: 1,
  },
  providerName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  providerDescription: {
    fontSize: 14,
    color: '#666666',
  },
  disabledText: {
    color: '#999999',
  },
  connectButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  connectButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  connectedBadge: {
    backgroundColor: '#34C759',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectedText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  comingSoonBadge: {
    backgroundColor: '#FF9500',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  comingSoonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  illustrationContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  syncIllustration: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  deviceIcon: {
    width: 60,
    height: 60,
    backgroundColor: '#f0f0f0',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceEmoji: {
    fontSize: 28,
  },
  syncArrows: {
    marginHorizontal: 20,
  },
  syncArrow: {
    fontSize: 24,
    color: '#007AFF',
  },
  cloudIcon: {
    width: 60,
    height: 60,
    backgroundColor: '#e8f4ff',
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cloudEmoji: {
    fontSize: 28,
  },
  illustrationText: {
    fontSize: 14,
    color: '#666666',
    textAlign: 'center',
  },
  progressContainer: {
    alignItems: 'center',
    marginVertical: 24,
  },
  progressBar: {
    width: '100%',
    height: 4,
    backgroundColor: '#e0e0e0',
    borderRadius: 2,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 12,
    color: '#666666',
  },
  ctaContainer: {
    marginBottom: 40,
  },
  nextButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  nextButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  skipButton: {
    paddingVertical: 16,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  skipButtonText: {
    color: '#666666',
    fontSize: 16,
    fontWeight: '500',
  },
}); 